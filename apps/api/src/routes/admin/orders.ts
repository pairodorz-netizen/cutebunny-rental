import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../lib/db';
import { success, error } from '../../lib/response';
import { isValidTransition, getAllowedTransitions, getTransitionError } from '../../lib/state-machine';
import { getAdmin } from '../../middleware/auth';
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

  const [orders, total] = await Promise.all([
    db.order.findMany({
      where,
      include: {
        customer: {
          select: { firstName: true, lastName: true, email: true, phone: true },
        },
        items: {
          select: { productName: true, size: true, quantity: true, status: true },
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
      product_name: item.productName,
      size: item.size,
      quantity: item.quantity,
      item_status: item.status,
    })),
    total_amount: o.totalAmount,
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

// A14: PATCH /api/v1/admin/orders/:id/status — Status transition
adminOrders.patch('/:id/status', async (c) => {
  const db = getDb();
  const orderId = c.req.param('id');
  const admin = getAdmin(c);

  const bodySchema = z.object({
    to_status: z.enum(['unpaid', 'paid_locked', 'shipped', 'returned', 'cleaning', 'repair', 'ready']),
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

  // If verified, transition order to paid_locked
  if (parsed.data.verified) {
    const order = await db.order.findUnique({ where: { id: orderId } });
    if (order && order.status === 'unpaid') {
      await db.order.update({
        where: { id: orderId },
        data: { status: 'paid_locked' },
      });

      await db.orderStatusLog.create({
        data: {
          orderId,
          fromStatus: 'unpaid',
          toStatus: 'paid_locked',
          note: `Payment slip verified by admin`,
          changedBy: admin.sub,
        },
      });
    }
  }

  return success(c, {
    slip_id: slip.id,
    verification_status: newStatus,
    order_status: parsed.data.verified ? 'paid_locked' : undefined,
  });
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
  });

  const body = await c.req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid after-sales data', parsed.error.flatten());
  }

  const order = await db.order.findUnique({ where: { id: orderId } });
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

  return success(c, {
    event_id: event.id,
    event_type: event.eventType,
    amount: event.amount,
    order_id: orderId,
  });
});

export default adminOrders;
