import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../lib/db';
import { success, error, created } from '../../lib/response';
import { isValidTransition, getAllowedTransitions, getTransitionError } from '../../lib/state-machine';
import { getAdmin } from '../../middleware/auth';
import { sendOrderStatusNotification } from '../../lib/notifications';
import type { OrderStatus, Prisma } from '@prisma/client';

const adminOrders = new Hono();

// A12: GET /api/v1/admin/orders — Order list with filters
adminOrders.get('/', async (c) => {
  const db = getDb();
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
  const perPage = Math.min(50, Math.max(1, parseInt(c.req.query('per_page') ?? '20', 10)));
  const statusFilter = c.req.query('status') as OrderStatus | undefined;
  const dateFrom = c.req.query('date_from');
  const dateTo = c.req.query('date_to');
  const search = c.req.query('search');
  const searchSku = c.req.query('search_sku');
  const searchProductName = c.req.query('search_product_name');
  const searchTrackingNumber = c.req.query('search_tracking');
  const searchOrderNumber = c.req.query('search_order_number');
  const searchCustomerName = c.req.query('search_customer_name');
  const searchCustomerPhone = c.req.query('search_customer_phone');

  const where: Prisma.OrderWhereInput = {};

  if (statusFilter) {
    where.status = statusFilter;
  }

  if (dateFrom) {
    where.createdAt = { ...((where.createdAt as Prisma.DateTimeFilter) ?? {}), gte: new Date(dateFrom) };
  }
  if (dateTo) {
    where.createdAt = { ...((where.createdAt as Prisma.DateTimeFilter) ?? {}), lte: new Date(dateTo + 'T23:59:59.999Z') };
  }

  if (search) {
    where.OR = [
      { orderNumber: { contains: search, mode: 'insensitive' } },
      { customer: { phone: { contains: search } } },
      { customer: { email: { contains: search, mode: 'insensitive' } } },
      { customer: { firstName: { contains: search, mode: 'insensitive' } } },
      { customer: { lastName: { contains: search, mode: 'insensitive' } } },
    ];
  }

  // Individual field filters
  const andConditions: Prisma.OrderWhereInput[] = [];
  if (searchOrderNumber) {
    andConditions.push({ orderNumber: { contains: searchOrderNumber, mode: 'insensitive' } });
  }
  if (searchCustomerName) {
    andConditions.push({
      OR: [
        { customer: { firstName: { contains: searchCustomerName, mode: 'insensitive' } } },
        { customer: { lastName: { contains: searchCustomerName, mode: 'insensitive' } } },
      ],
    });
  }
  if (searchCustomerPhone) {
    andConditions.push({ customer: { phone: { contains: searchCustomerPhone } } });
  }
  if (searchSku) {
    andConditions.push({ items: { some: { product: { sku: { contains: searchSku, mode: 'insensitive' } } } } });
  }
  if (searchProductName) {
    andConditions.push({ items: { some: { productName: { contains: searchProductName, mode: 'insensitive' } } } });
  }
  if (searchTrackingNumber) {
    andConditions.push({ shippingSnapshot: { path: ['tracking_number'], string_contains: searchTrackingNumber } });
  }
  if (andConditions.length > 0) {
    where.AND = andConditions;
  }

  const [orders, total] = await Promise.all([
    db.order.findMany({
      where,
      include: {
        customer: {
          select: { firstName: true, lastName: true, email: true, phone: true },
        },
        items: {
          select: {
            id: true,
            productName: true,
            size: true,
            quantity: true,
            status: true,
            subtotal: true,
            lateFee: true,
            damageFee: true,
            product: { select: { sku: true, thumbnailUrl: true } },
          },
        },
        paymentSlips: {
          select: { verificationStatus: true },
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy: { createdAt: 'desc' },
    }),
    db.order.count({ where }),
  ]);

  const data = orders.map((o) => ({
    id: o.id,
    order_number: o.orderNumber,
    status: o.status,
    customer: {
      name: `${o.customer.firstName} ${o.customer.lastName}`,
      email: o.customer.email,
      phone: o.customer.phone,
    },
    items: o.items.map((item) => ({
      id: item.id,
      product_name: item.productName,
      sku: item.product?.sku ?? '',
      size: item.size,
      quantity: item.quantity,
      subtotal: item.subtotal,
      late_fee: item.lateFee,
      damage_fee: item.damageFee,
      item_status: item.status,
      thumbnail: item.product?.thumbnailUrl ?? null,
    })),
    tracking_number: ((o.shippingSnapshot as Record<string, unknown>)?.tracking_number as string) ?? null,
    total_amount: o.totalAmount,
    credit_applied: o.creditApplied ?? 0,
    payment_status: o.paymentSlips[0]?.verificationStatus ?? 'no_slip',
    rental_period: {
      start: o.rentalStartDate.toISOString().split('T')[0],
      end: o.rentalEndDate.toISOString().split('T')[0],
    },
    created_at: o.createdAt.toISOString(),
  }));

  return success(c, data, {
    page,
    per_page: perPage,
    total,
    total_pages: Math.ceil(total / perPage),
  });
});

// GET /api/v1/admin/orders/:id — Order detail
adminOrders.get('/:id', async (c) => {
  const db = getDb();
  const orderId = c.req.param('id');

  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      customer: true,
      items: {
        include: {
          product: {
            select: {
              sku: true,
              thumbnailUrl: true,
              images: { select: { id: true, url: true, altText: true, sortOrder: true } },
            },
          },
        },
      },
      paymentSlips: {
        orderBy: { createdAt: 'desc' },
      },
      statusLogs: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!order) {
    return error(c, 404, 'NOT_FOUND', 'Order not found');
  }

  // Fetch audit logs separately so a missing/misconfigured table doesn't break the detail endpoint
  let auditLogEntries: Array<{ id: string; action: string; resource: string | null; details: unknown; adminId: string; createdAt: Date; admin?: { name: string | null; email: string } | null }> = [];
  try {
    auditLogEntries = await db.auditLog.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      include: {
        admin: { select: { id: true, name: true, email: true } },
      },
    });
  } catch (e) {
    console.error('Failed to fetch audit logs:', e instanceof Error ? e.message : e);
  }

  const data = {
    id: order.id,
    order_number: order.orderNumber,
    status: order.status,
    total_amount: order.totalAmount,
    deposit_total: order.deposit,
    delivery_fee: order.deliveryFee,
    credit_applied: order.creditApplied,
    customer: {
      id: order.customer.id,
      name: `${order.customer.firstName} ${order.customer.lastName}`,
      first_name: order.customer.firstName,
      last_name: order.customer.lastName,
      phone: order.customer.phone,
      email: order.customer.email,
      address: order.customer.address,
    },
    items: order.items.map((item) => {
      const rentalDays = Math.ceil(
        (order.rentalEndDate.getTime() - order.rentalStartDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      return {
        id: item.id,
        product_name: item.productName,
        sku: item.product?.sku ?? '',
        size: item.size,
        quantity: item.quantity,
        rental_days: rentalDays,
        price_per_day: item.rentalPricePerDay,
        subtotal: item.subtotal,
        late_fee: item.lateFee,
        damage_fee: item.damageFee,
        status: item.status,
        thumbnail: item.product?.thumbnailUrl ?? null,
        images: item.product?.images ?? [],
      };
    }),
    status_log: order.statusLogs.map((log) => ({
      from_status: log.fromStatus,
      to_status: log.toStatus,
      changed_by: log.changedBy,
      note: log.note ?? '',
      created_at: log.createdAt.toISOString(),
    })),
    payment_slips: order.paymentSlips.map((slip) => ({
      id: slip.id,
      storage_key: slip.storageKey,
      declared_amount: slip.declaredAmount,
      bank_name: slip.bankName,
      verification_status: slip.verificationStatus,
      created_at: slip.createdAt.toISOString(),
    })),
    shipping: order.shippingSnapshot ?? {},
    rental_period: {
      start: order.rentalStartDate.toISOString().split('T')[0],
      end: order.rentalEndDate.toISOString().split('T')[0],
    },
    audit_logs: auditLogEntries.map((log) => ({
      id: log.id,
      action: log.action,
      resource: log.resource,
      details: log.details,
      admin_name: log.admin?.name ?? log.admin?.email ?? log.adminId,
      created_at: log.createdAt.toISOString(),
    })),
    created_at: order.createdAt.toISOString(),
  };

  return success(c, data);
});

// PATCH /api/v1/admin/orders/:id/edit — Inline edit order
const editOrderSchema = z.object({
  customer_name: z.string().optional(),
  customer_address: z.record(z.unknown()).optional(),
  items: z.array(z.object({
    id: z.string().uuid(),
    subtotal: z.number().int().min(0).optional(),
    late_fee: z.number().int().min(0).optional(),
    damage_fee: z.number().int().min(0).optional(),
  })).optional(),
  status: z.enum(['unpaid', 'paid_locked', 'shipped', 'returned', 'cleaning', 'repair', 'finished', 'cancelled']).optional(),
});

adminOrders.patch('/:id/edit', async (c) => {
  const db = getDb();
  const orderId = c.req.param('id');
  const admin = getAdmin(c);

  const body = await c.req.json().catch(() => null);
  const parsed = editOrderSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid edit data', parsed.error.flatten());
  }

  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { customer: true, items: true },
  });
  if (!order) {
    return error(c, 404, 'NOT_FOUND', 'Order not found');
  }

  const changes: string[] = [];

  // Update customer name
  if (parsed.data.customer_name) {
    const parts = parsed.data.customer_name.trim().split(/\s+/);
    const firstName = parts[0] || '';
    const lastName = parts.slice(1).join(' ') || '';
    await db.customer.update({
      where: { id: order.customerId },
      data: { firstName, lastName },
    });
    changes.push(`customer_name: "${order.customer.firstName} ${order.customer.lastName}" -> "${parsed.data.customer_name}"`);
  }

  // Update customer address
  if (parsed.data.customer_address) {
    await db.customer.update({
      where: { id: order.customerId },
      data: { address: parsed.data.customer_address as Record<string, string> },
    });
    changes.push('customer_address updated');
  }

  // Update order items
  if (parsed.data.items && parsed.data.items.length > 0) {
    for (const itemUpdate of parsed.data.items) {
      const existingItem = order.items.find((i) => i.id === itemUpdate.id);
      if (!existingItem) continue;
      const data: Record<string, number> = {};
      if (itemUpdate.subtotal !== undefined) data.subtotal = itemUpdate.subtotal;
      if (itemUpdate.late_fee !== undefined) data.lateFee = itemUpdate.late_fee;
      if (itemUpdate.damage_fee !== undefined) data.damageFee = itemUpdate.damage_fee;
      if (Object.keys(data).length > 0) {
        await db.orderItem.update({ where: { id: itemUpdate.id }, data });
        changes.push(`item ${itemUpdate.id}: ${JSON.stringify(data)}`);
      }
    }
    // Recalculate order total
    const updatedItems = await db.orderItem.findMany({ where: { orderId } });
    const newSubtotal = updatedItems.reduce((sum, i) => sum + i.subtotal, 0);
    const newTotal = newSubtotal + order.deposit + order.deliveryFee - order.discount - order.creditApplied;
    await db.order.update({
      where: { id: orderId },
      data: { subtotal: newSubtotal, totalAmount: newTotal },
    });
  }

  // Update order status
  if (parsed.data.status && parsed.data.status !== order.status) {
    const toStatus = parsed.data.status as OrderStatus;
    if (!isValidTransition(order.status, toStatus)) {
      return error(c, 422, 'INVALID_TRANSITION', getTransitionError(order.status, toStatus));
    }
    await db.order.update({ where: { id: orderId }, data: { status: toStatus } });
    await db.orderStatusLog.create({
      data: { orderId, fromStatus: order.status, toStatus, note: 'Edited via admin panel', changedBy: admin.sub },
    });
    changes.push(`status: ${order.status} -> ${toStatus}`);
  }

  // Audit log
  try {
    if (db.auditLog?.create) {
      await db.auditLog.create({
        data: {
          orderId,
          adminId: admin.sub,
          action: 'EDIT',
          resource: 'order',
          resourceId: orderId,
          details: { changes },
        },
      });
    }
  } catch { /* audit failure should not block */ }

  return success(c, { id: orderId, changes });
});

// POST /api/v1/admin/orders/:id/items — Add item to order
const addItemSchema = z.object({
  product_id: z.string().uuid(),
  size: z.string(),
  quantity: z.number().int().min(1).default(1),
  subtotal: z.number().int().min(0),
});

adminOrders.post('/:id/items', async (c) => {
  const db = getDb();
  const orderId = c.req.param('id');
  const admin = getAdmin(c);

  const body = await c.req.json().catch(() => null);
  const parsed = addItemSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid item data', parsed.error.flatten());
  }

  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) {
    return error(c, 404, 'NOT_FOUND', 'Order not found');
  }

  const product = await db.product.findUnique({
    where: { id: parsed.data.product_id },
    select: { id: true, name: true, sku: true, rentalPrice1Day: true, thumbnailUrl: true },
  });
  if (!product) {
    return error(c, 404, 'NOT_FOUND', 'Product not found');
  }

  const newItem = await db.orderItem.create({
    data: {
      orderId,
      productId: product.id,
      productName: product.name,
      size: parsed.data.size,
      quantity: parsed.data.quantity,
      rentalPricePerDay: product.rentalPrice1Day,
      subtotal: parsed.data.subtotal,
    },
  });

  // Recalculate order totals
  const allItems = await db.orderItem.findMany({ where: { orderId } });
  const newSubtotal = allItems.reduce((sum, i) => sum + i.subtotal, 0);
  const newTotal = newSubtotal + order.deposit + order.deliveryFee - order.discount - order.creditApplied;
  await db.order.update({
    where: { id: orderId },
    data: { subtotal: newSubtotal, totalAmount: newTotal },
  });

  // Audit log
  try {
    await db.auditLog.create({
      data: {
        orderId,
        adminId: admin.sub,
        action: 'ADD_ITEM',
        resource: 'order_item',
        resourceId: newItem.id,
        details: { product_name: product.name, sku: product.sku, size: parsed.data.size, subtotal: parsed.data.subtotal },
      },
    });
  } catch { /* audit failure should not block */ }

  return created(c, {
    item: {
      id: newItem.id,
      product_name: newItem.productName,
      sku: product.sku,
      size: newItem.size,
      quantity: newItem.quantity,
      subtotal: newItem.subtotal,
      thumbnail: product.thumbnailUrl,
    },
    order_total: newTotal,
    additional_charge: parsed.data.subtotal,
  });
});

// DELETE /api/v1/admin/orders/:id/items/:itemId — Remove item from order
adminOrders.delete('/:id/items/:itemId', async (c) => {
  const db = getDb();
  const orderId = c.req.param('id');
  const itemId = c.req.param('itemId');
  const admin = getAdmin(c);

  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) {
    return error(c, 404, 'NOT_FOUND', 'Order not found');
  }

  const item = await db.orderItem.findFirst({
    where: { id: itemId, orderId },
  });
  if (!item) {
    return error(c, 404, 'NOT_FOUND', 'Order item not found');
  }

  const refundAmount = item.subtotal;

  await db.orderItem.delete({ where: { id: itemId } });

  // Recalculate order totals
  const remainingItems = await db.orderItem.findMany({ where: { orderId } });
  const newSubtotal = remainingItems.reduce((sum, i) => sum + i.subtotal, 0);
  const newTotal = newSubtotal + order.deposit + order.deliveryFee - order.discount - order.creditApplied;
  await db.order.update({
    where: { id: orderId },
    data: { subtotal: newSubtotal, totalAmount: newTotal },
  });

  // Audit log
  try {
    await db.auditLog.create({
      data: {
        orderId,
        adminId: admin.sub,
        action: 'REMOVE_ITEM',
        resource: 'order_item',
        resourceId: itemId,
        details: { product_name: item.productName, size: item.size, subtotal: item.subtotal, refund: refundAmount },
      },
    });
  } catch { /* audit failure should not block */ }

  return success(c, {
    deleted: true,
    item_id: itemId,
    product_name: item.productName,
    refund_amount: refundAmount,
    order_total: newTotal,
  });
});

// A14: PATCH /api/v1/admin/orders/:id/status — Status transition
adminOrders.patch('/:id/status', async (c) => {
  const db = getDb();
  const orderId = c.req.param('id');
  const admin = getAdmin(c);

  const bodySchema = z.object({
    to_status: z.enum(['unpaid', 'paid_locked', 'shipped', 'returned', 'cleaning', 'repair', 'finished', 'cancelled']),
    tracking_number: z.string().optional(),
    note: z.string().optional(),
  });

  const body = await c.req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid status transition data', parsed.error.flatten());
  }

  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) {
    return error(c, 404, 'NOT_FOUND', 'Order not found');
  }

  const toStatus = parsed.data.to_status as OrderStatus;

  if (!isValidTransition(order.status, toStatus)) {
    return error(c, 422, 'INVALID_TRANSITION', getTransitionError(order.status, toStatus), {
      current_status: order.status,
      requested_status: toStatus,
      allowed_transitions: getAllowedTransitions(order.status),
    });
  }

  // Update order status
  const updatedOrder = await db.order.update({
    where: { id: orderId },
    data: {
      status: toStatus,
      ...(parsed.data.tracking_number && {
        shippingSnapshot: {
          ...(order.shippingSnapshot as Record<string, unknown> ?? {}),
          tracking_number: parsed.data.tracking_number,
        },
      }),
    },
  });

  // Create audit log
  await db.orderStatusLog.create({
    data: {
      orderId,
      fromStatus: order.status,
      toStatus,
      note: parsed.data.note ?? null,
      changedBy: admin.sub,
    },
  });

  // Auto-create finance transactions for key status transitions (non-blocking)
  try {
    if (toStatus === 'finished' && db.orderItem?.aggregate) {
      const totalLateFee = await db.orderItem.aggregate({
        where: { orderId },
        _sum: { lateFee: true, damageFee: true },
      });
      const totalDeductions = (totalLateFee._sum.lateFee ?? 0) + (totalLateFee._sum.damageFee ?? 0);
      const depositReturn = Math.max(0, order.deposit - totalDeductions);

      if (depositReturn > 0 && db.financeTransaction?.create) {
        await db.financeTransaction.create({
          data: {
            orderId,
            txType: 'deposit_returned',
            amount: depositReturn,
            note: `Auto deposit return for ${order.orderNumber} (deposit: ${order.deposit}, deductions: ${totalDeductions})`,
            createdBy: admin.sub,
          },
        });
      }

      if (totalDeductions > 0 && db.financeTransaction?.create) {
        await db.financeTransaction.create({
          data: {
            orderId,
            txType: 'deposit_forfeited',
            amount: totalDeductions,
            note: `Deposit deduction for ${order.orderNumber} (late: ${totalLateFee._sum.lateFee ?? 0}, damage: ${totalLateFee._sum.damageFee ?? 0})`,
            createdBy: admin.sub,
          },
        });
      }
    }

    if (toStatus === 'returned' && db.financeTransaction?.create) {
      await db.financeTransaction.create({
        data: {
          orderId,
          txType: 'rental_revenue',
          amount: order.subtotal,
          note: `Rental revenue for ${order.orderNumber}`,
          createdBy: admin.sub,
        },
      });
    }

    if (toStatus === 'cancelled' && db.financeTransaction?.create) {
      await db.financeTransaction.create({
        data: {
          orderId,
          txType: 'rental_revenue',
          amount: -order.subtotal,
          note: `Order cancelled - revenue reversed for ${order.orderNumber}`,
          createdBy: admin.sub,
        },
      });
    }
  } catch { /* finance tx failure should not block status transition */ }

  // Send notification to customer (non-blocking)
  try {
    const customer = await db.customer.findUnique({ where: { id: order.customerId } });
    if (customer) {
      await sendOrderStatusNotification(
        orderId,
        order.orderNumber,
        toStatus,
        customer.email,
        customer.id,
        parsed.data.tracking_number,
      );
    }
  } catch { /* notification failure should not block status transition */ }

  // Create audit log entry (non-blocking)
  try {
    if (db.auditLog?.create) {
      await db.auditLog.create({
        data: {
          orderId,
          adminId: admin.sub,
          action: 'STATUS_CHANGE',
          resource: 'order',
          resourceId: orderId,
          details: { from: order.status, to: toStatus, tracking_number: parsed.data.tracking_number },
        },
      });
    }
  } catch { /* audit failure should not block */ }

  return success(c, {
    id: updatedOrder.id,
    order_number: updatedOrder.orderNumber,
    previous_status: order.status,
    current_status: updatedOrder.status,
    allowed_transitions: getAllowedTransitions(updatedOrder.status),
  });
});

// A15: POST /api/v1/admin/orders/:id/payment-slip/verify
adminOrders.post('/:id/payment-slip/verify', async (c) => {
  const db = getDb();
  const orderId = c.req.param('id');
  const admin = getAdmin(c);

  const bodySchema = z.object({
    slip_id: z.string().uuid(),
    verified: z.boolean(),
    note: z.string().optional(),
  });

  const body = await c.req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid verification data', parsed.error.flatten());
  }

  const slip = await db.paymentSlip.findFirst({
    where: { id: parsed.data.slip_id, orderId },
  });

  if (!slip) {
    return error(c, 404, 'NOT_FOUND', 'Payment slip not found');
  }

  const newStatus = parsed.data.verified ? 'verified' as const : 'rejected' as const;

  await db.paymentSlip.update({
    where: { id: slip.id },
    data: {
      verificationStatus: newStatus,
      verifiedBy: admin.sub,
      verifiedAt: new Date(),
      note: parsed.data.note ?? null,
    },
  });

  let orderStatusChanged: string | undefined;
  let paymentMessage: string | undefined;
  let creditAdded = 0;

  if (parsed.data.verified) {
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { customer: true },
    });

    if (order) {
      // Sum all verified slip amounts (including this one just verified)
      const allSlips = await db.paymentSlip.findMany({
        where: { orderId, verificationStatus: 'verified' },
      });
      const totalVerified = allSlips.reduce((sum, s) => sum + s.declaredAmount, 0);

      if (totalVerified >= order.totalAmount) {
        // Sufficient payment — mark as paid
        if (order.status === 'unpaid') {
          await db.order.update({
            where: { id: orderId },
            data: { status: 'paid_locked' },
          });
          await db.orderStatusLog.create({
            data: {
              orderId,
              fromStatus: 'unpaid',
              toStatus: 'paid_locked',
              note: `Payment verified. Total verified: ${totalVerified} THB`,
              changedBy: admin.sub,
            },
          });
          orderStatusChanged = 'paid_locked';
        }

        // Create rental_revenue finance transaction
        try {
          await db.financeTransaction.create({
            data: {
              orderId,
              txType: 'rental_revenue',
              amount: order.totalAmount,
              note: `Payment verified for order ${order.orderNumber}`,
              createdBy: admin.sub,
            },
          });
        } catch { /* non-blocking */ }

        // Handle overpayment — add excess to customer credit
        const excess = totalVerified - order.totalAmount;
        if (excess > 0 && order.customerId) {
          creditAdded = excess;
          try {
            await db.customer.update({
              where: { id: order.customerId },
              data: { creditBalance: { increment: excess } },
            });
            await db.financeTransaction.create({
              data: {
                orderId,
                txType: 'deposit_received',
                amount: excess,
                note: `Overpayment credit: ${excess} THB added to customer balance`,
                createdBy: admin.sub,
              },
            });
          } catch { /* non-blocking */ }
        }
      } else {
        paymentMessage = `Insufficient payment. Total verified: ${totalVerified} THB / Required: ${order.totalAmount} THB`;
      }
    }
  }

  // Audit log for payment verification (non-blocking)
  try {
    if (db.auditLog?.create) {
      await db.auditLog.create({
        data: {
          orderId,
          adminId: admin.sub,
          action: parsed.data.verified ? 'VERIFY' : 'REJECT',
          resource: 'payment_slip',
          resourceId: slip.id,
          details: { order_id: orderId, slip_id: slip.id, verified: parsed.data.verified, note: parsed.data.note, credit_added: creditAdded },
        },
      });
    }
  } catch { /* audit failure should not block */ }

  return success(c, {
    slip_id: slip.id,
    verification_status: newStatus,
    order_status: orderStatusChanged,
    payment_message: paymentMessage,
    credit_added: creditAdded,
  });
});

// PATCH /api/v1/admin/orders/:id/payment-slips/:slipId — Edit slip declared amount
adminOrders.patch('/:id/payment-slips/:slipId', async (c) => {
  const db = getDb();
  const orderId = c.req.param('id');
  const slipId = c.req.param('slipId');
  const admin = getAdmin(c);

  const bodySchema = z.object({
    declared_amount: z.number().int().min(0),
  });

  const body = await c.req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid data', parsed.error.flatten());
  }

  const slip = await db.paymentSlip.findFirst({
    where: { id: slipId, orderId },
  });

  if (!slip) {
    return error(c, 404, 'NOT_FOUND', 'Payment slip not found');
  }

  await db.paymentSlip.update({
    where: { id: slipId },
    data: { declaredAmount: parsed.data.declared_amount },
  });

  // Audit log
  try {
    await db.auditLog.create({
      data: {
        orderId,
        adminId: admin.sub,
        action: 'EDIT',
        resource: 'payment_slip',
        resourceId: slipId,
        details: { old_amount: slip.declaredAmount, new_amount: parsed.data.declared_amount },
      },
    });
  } catch { /* non-blocking */ }

  return success(c, { slip_id: slipId, declared_amount: parsed.data.declared_amount });
});

// Late fee configuration (THB per day)
const LATE_FEE_PER_DAY_THB = 200;

// GET /api/v1/admin/orders/:id/late-fee — Calculate late fee
adminOrders.get('/:id/late-fee', async (c) => {
  const db = getDb();
  const orderId = c.req.param('id');

  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });

  if (!order) {
    return error(c, 404, 'NOT_FOUND', 'Order not found');
  }

  const now = new Date();
  const rentalEnd = new Date(order.rentalEndDate);
  const daysLate = Math.max(0, Math.ceil((now.getTime() - rentalEnd.getTime()) / (1000 * 60 * 60 * 24)));
  const feePerDay = LATE_FEE_PER_DAY_THB;
  const totalLateFee = daysLate * feePerDay;

  return success(c, {
    order_id: orderId,
    rental_end_date: order.rentalEndDate.toISOString().split('T')[0],
    current_date: now.toISOString().split('T')[0],
    days_late: daysLate,
    fee_per_day: feePerDay,
    total_late_fee: totalLateFee,
    is_overdue: daysLate > 0,
    deposit_total: order.deposit,
    deposit_remaining: Math.max(0, order.deposit - totalLateFee),
  });
});

// GET /api/v1/admin/orders/overdue — List overdue orders
adminOrders.get('/overdue/list', async (c) => {
  const db = getDb();
  const now = new Date();

  const overdueOrders = await db.order.findMany({
    where: {
      status: { in: ['shipped'] },
      rentalEndDate: { lt: now },
    },
    include: {
      customer: {
        select: { firstName: true, lastName: true, phone: true },
      },
    },
    orderBy: { rentalEndDate: 'asc' },
  });

  const data = overdueOrders.map((o) => {
    const daysLate = Math.ceil((now.getTime() - new Date(o.rentalEndDate).getTime()) / (1000 * 60 * 60 * 24));
    return {
      id: o.id,
      order_number: o.orderNumber,
      customer_name: `${o.customer.firstName} ${o.customer.lastName}`,
      customer_phone: o.customer.phone,
      rental_end_date: o.rentalEndDate.toISOString().split('T')[0],
      days_late: daysLate,
      estimated_late_fee: daysLate * LATE_FEE_PER_DAY_THB,
      deposit: o.deposit,
    };
  });

  return success(c, data);
});

// A17: POST /api/v1/admin/orders/:id/after-sales
adminOrders.post('/:id/after-sales', async (c) => {
  const db = getDb();
  const orderId = c.req.param('id');
  const admin = getAdmin(c);

  const bodySchema = z.object({
    event_type: z.enum(['cancel', 'late_fee', 'damage_fee', 'force_buy', 'partial_refund']),
    amount: z.number().int().min(0),
    note: z.string().optional(),
    item_ids: z.array(z.string().uuid()).optional(),
  });

  const body = await c.req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid after-sales data', parsed.error.flatten());
  }

  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) {
    return error(c, 404, 'NOT_FOUND', 'Order not found');
  }

  // Create after-sales event
  const event = await db.afterSalesEvent.create({
    data: {
      orderId,
      eventType: parsed.data.event_type,
      amount: parsed.data.amount,
      note: parsed.data.note ?? null,
      createdBy: admin.sub,
    },
  });

  // Create corresponding finance transaction
  const txTypeMap: Record<string, 'late_fee' | 'damage_fee' | 'force_buy' | 'deposit_returned' | 'rental_revenue'> = {
    late_fee: 'late_fee',
    damage_fee: 'damage_fee',
    force_buy: 'force_buy',
    partial_refund: 'deposit_returned',
    cancel: 'rental_revenue',
  };

  const txType = txTypeMap[parsed.data.event_type];
  const isRefund = parsed.data.event_type === 'partial_refund' || parsed.data.event_type === 'cancel';

  await db.financeTransaction.create({
    data: {
      orderId,
      txType,
      amount: isRefund ? -parsed.data.amount : parsed.data.amount,
      note: `After-sales: ${parsed.data.event_type} - ${parsed.data.note ?? ''}`,
      createdBy: admin.sub,
    },
  });

  // Handle specific event types
  if (parsed.data.event_type === 'late_fee') {
    // Apply late fee to order items
    const itemIds = parsed.data.item_ids ?? order.items.map((i) => i.id);
    const perItemFee = Math.ceil(parsed.data.amount / itemIds.length);
    for (const itemId of itemIds) {
      const item = order.items.find((i) => i.id === itemId);
      if (item) {
        await db.orderItem.update({
          where: { id: itemId },
          data: { lateFee: item.lateFee + perItemFee },
        });
      }
    }
  }

  if (parsed.data.event_type === 'damage_fee') {
    // Apply damage fee to order items
    const itemIds = parsed.data.item_ids ?? order.items.map((i) => i.id);
    const perItemFee = Math.ceil(parsed.data.amount / itemIds.length);
    for (const itemId of itemIds) {
      const item = order.items.find((i) => i.id === itemId);
      if (item) {
        await db.orderItem.update({
          where: { id: itemId },
          data: { damageFee: item.damageFee + perItemFee },
        });
      }
    }
  }

  if (parsed.data.event_type === 'force_buy') {
    // Decommission the product — mark it unavailable and set stock to 0
    const itemIds = parsed.data.item_ids ?? order.items.map((i) => i.id);
    for (const itemId of itemIds) {
      const item = order.items.find((i) => i.id === itemId);
      if (item) {
        await db.product.update({
          where: { id: item.productId },
          data: { available: false, stockQuantity: 0 },
        });
        await db.orderItem.update({
          where: { id: itemId },
          data: { status: 'force_bought' as never },
        });
      }
    }

    // Create deposit deduction finance transaction
    const depositToDeduct = Math.min(order.deposit, parsed.data.amount);
    if (depositToDeduct > 0) {
      await db.financeTransaction.create({
        data: {
          orderId,
          txType: 'deposit_returned',
          amount: -depositToDeduct,
          note: `Deposit deducted for force-buy (${depositToDeduct} THB from ${order.deposit} THB deposit)`,
          createdBy: admin.sub,
        },
      });
    }
  }

  if (parsed.data.event_type === 'partial_refund' || parsed.data.event_type === 'cancel') {
    // Deposit deduction/refund: record the remaining deposit return
    const totalFees = order.items.reduce((sum, i) => sum + i.lateFee + i.damageFee, 0) + parsed.data.amount;
    const depositRefund = Math.max(0, order.deposit - totalFees);
    if (depositRefund > 0 && parsed.data.event_type !== 'cancel') {
      await db.financeTransaction.create({
        data: {
          orderId,
          txType: 'deposit_returned',
          amount: -depositRefund,
          note: `Deposit refund: ${depositRefund} THB (after ${totalFees} THB in fees)`,
          createdBy: admin.sub,
        },
      });
    }
  }

  return success(c, {
    event_id: event.id,
    event_type: event.eventType,
    amount: event.amount,
    order_id: orderId,
  });
});

// ─── M06: Per-Rental Profit Breakdown ────────────────────────────────────

// GET /api/v1/admin/orders/:id/profit
adminOrders.get('/:id/profit', async (c) => {
  const db = getDb();
  const orderId = c.req.param('id');

  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      customer: { select: { firstName: true, lastName: true } },
      items: {
        include: {
          product: { select: { name: true, sku: true } },
        },
      },
      financeTransactions: true,
    },
  });

  if (!order) {
    return error(c, 404, 'NOT_FOUND', 'Order not found');
  }

  const rentalPrice = order.subtotal;
  const totalLateFee = order.items.reduce((sum, i) => sum + i.lateFee, 0);
  const totalDamageFee = order.items.reduce((sum, i) => sum + i.damageFee, 0);
  const grossRevenue = rentalPrice + totalLateFee + totalDamageFee;

  const expenseTypes = ['shipping', 'cogs', 'cleaning', 'repair', 'marketing', 'platform_fee'];
  const expenses: Array<{ category: string; amount: number }> = [];
  let totalExpenses = 0;

  for (const tx of order.financeTransactions) {
    if (expenseTypes.includes(tx.txType)) {
      expenses.push({ category: tx.txType, amount: Math.abs(tx.amount) });
      totalExpenses += Math.abs(tx.amount);
    }
  }

  // Add delivery fee as shipping expense if no explicit shipping transaction
  if (!expenses.some((e) => e.category === 'shipping') && order.deliveryFee > 0) {
    expenses.push({ category: 'shipping', amount: order.deliveryFee });
    totalExpenses += order.deliveryFee;
  }

  const netProfit = grossRevenue - totalExpenses;
  const profitMargin = grossRevenue > 0 ? Math.round((netProfit / grossRevenue) * 10000) / 100 : 0;

  return success(c, {
    order_id: order.id,
    order_number: order.orderNumber,
    customer_name: `${order.customer.firstName} ${order.customer.lastName}`,
    items: order.items.map((i) => ({
      product_name: i.product.name,
      sku: i.product.sku,
      size: i.size,
      subtotal: i.subtotal,
      late_fee: i.lateFee,
      damage_fee: i.damageFee,
    })),
    rental_price: rentalPrice,
    late_fee: totalLateFee,
    damage_fee: totalDamageFee,
    gross_revenue: grossRevenue,
    expenses,
    total_expenses: totalExpenses,
    net_profit: netProfit,
    profit_margin: profitMargin,
    deposit: order.deposit,
    delivery_fee: order.deliveryFee,
  });
});

// POST /api/v1/admin/orders — Create a new order (admin)
const createOrderSchema = z.object({
  customer_name: z.string().min(1),
  customer_phone: z.string().min(1),
  customer_email: z.string().email().optional(),
  rental_start_date: z.string().min(1),
  rental_end_date: z.string().min(1),
  items: z.array(z.object({
    product_id: z.string().uuid(),
    size: z.string(),
    quantity: z.number().int().min(1).default(1),
    subtotal: z.number().int().min(0),
  })).min(1),
  deposit: z.number().int().min(0).default(0),
  delivery_fee: z.number().int().min(0).default(0),
  note: z.string().optional(),
  mark_as_paid: z.boolean().default(false),
});

adminOrders.post('/', async (c) => {
  const db = getDb();
  const admin = getAdmin(c);

  const body = await c.req.json().catch(() => null);
  const parsed = createOrderSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid order data', parsed.error.flatten());
  }

  const { customer_name, customer_phone, customer_email, rental_start_date, rental_end_date, items, deposit, delivery_fee, note, mark_as_paid } = parsed.data;

  // Find or create customer by phone
  let customer = await db.customer.findFirst({ where: { phone: customer_phone } });
  if (!customer) {
    const nameParts = customer_name.trim().split(/\s+/);
    customer = await db.customer.create({
      data: {
        firstName: nameParts[0] || '',
        lastName: nameParts.slice(1).join(' ') || '',
        phone: customer_phone,
        email: customer_email ?? `${customer_phone}@placeholder.local`,
        locale: 'th',
      },
    });
  }

  // Generate order number: ORD-YYYYNNN
  const year = new Date().getFullYear();
  const yearPrefix = `ORD-${year}`;
  const lastOrder = await db.order.findFirst({
    where: { orderNumber: { startsWith: yearPrefix } },
    orderBy: { orderNumber: 'desc' },
  });
  let nextNum = 1;
  if (lastOrder) {
    const numPart = lastOrder.orderNumber.replace(yearPrefix, '');
    nextNum = (parseInt(numPart, 10) || 0) + 1;
  }
  const orderNumber = `${yearPrefix}${String(nextNum).padStart(3, '0')}`;

  // Calculate totals
  const startDate = new Date(rental_start_date);
  const endDate = new Date(rental_end_date);
  const totalDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
  const subtotal = items.reduce((sum, i) => sum + i.subtotal, 0);
  const totalAmount = subtotal + deposit + delivery_fee;

  // Look up products for item details
  const productIds = [...new Set(items.map((i) => i.product_id))];
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, sku: true, rentalPrice1Day: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  // Create order with items
  const order = await db.order.create({
    data: {
      orderNumber,
      customerId: customer.id,
      status: mark_as_paid ? 'paid_locked' : 'unpaid',
      rentalStartDate: startDate,
      rentalEndDate: endDate,
      totalDays,
      subtotal,
      deposit,
      deliveryFee: delivery_fee,
      totalAmount,
      notes: note ?? '',
      items: {
        create: items.map((item) => {
          const product = productMap.get(item.product_id);
          return {
            productId: item.product_id,
            productName: product?.name ?? 'Unknown',
            size: item.size,
            quantity: item.quantity,
            rentalPricePerDay: product?.rentalPrice1Day ?? 0,
            subtotal: item.subtotal,
          };
        }),
      },
    },
    include: { items: true, customer: true },
  });

  // Create status log
  await db.orderStatusLog.create({
    data: {
      orderId: order.id,
      fromStatus: 'unpaid',
      toStatus: mark_as_paid ? 'paid_locked' : 'unpaid',
      note: 'Created by admin',
      changedBy: admin.sub,
    },
  });

  // Audit log
  try {
    await db.auditLog.create({
      data: {
        orderId: order.id,
        adminId: admin.sub,
        action: 'CREATE_ORDER',
        resource: 'order',
        resourceId: order.id,
        details: { order_number: orderNumber, customer_name, items_count: items.length, total: totalAmount },
      },
    });
  } catch { /* audit failure should not block */ }

  return created(c, {
    id: order.id,
    order_number: order.orderNumber,
    status: order.status,
    customer: {
      id: customer.id,
      name: `${customer.firstName} ${customer.lastName}`,
      phone: customer.phone,
    },
    items: order.items.map((i) => ({
      id: i.id,
      product_name: i.productName,
      size: i.size,
      quantity: i.quantity,
      subtotal: i.subtotal,
    })),
    total_amount: order.totalAmount,
    created_at: order.createdAt.toISOString(),
  });
});

export default adminOrders;
