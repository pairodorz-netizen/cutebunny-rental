import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../lib/db';
import { success, error, created } from '../../lib/response';
import { isValidTransition, getAllowedTransitions, getTransitionError } from '../../lib/state-machine';
import { getAdmin } from '../../middleware/auth';
import { sendOrderStatusNotification } from '../../lib/notifications';
import { confirmHolds, createLifecycleBlocks } from '../../lib/availability';
import { computePagination } from '@cutebunny/shared/orders-archive-window';
import { isDateWithinBookingWindow } from '@cutebunny/shared/date-bounds';
import { buildOrdersWhere, buildOrdersCountsWhere } from '../../lib/orders-query';
import { computeDerivedFlags, backfillStaleOrders } from '../../scheduled';
import { safeAuditLogCreate, safeAuditLogQuery } from '../../lib/safe-audit-log';
import type { OrderStatus, Prisma } from '@prisma/client';
import { customerDisplayName, customerDisplayEmail, customerDisplayPhone, isCustomerDeleted } from '@cutebunny/shared/customer-pii';

const adminOrders = new Hono();

// BUG-405-A01 — structured JSON envelope for uncaught admin-order errors.
//
// Prior to this handler the order-status route fell back to Hono's
// default crash behavior (plain-text "Internal Server Error") when any
// uncaught throw escaped the per-route try/catch. On Cloudflare Workers
// that surfaced to the admin UI as `TypeError: Failed to fetch` because
// the Worker terminated before flushing a response. This catch-all
// mirrors `apps/api/src/routes/admin/products.ts` (BUG-404-A01) and
// guarantees every error path returns `application/json` with a
// redacted envelope: no stack, no raw DB text, no PII.
adminOrders.onError((err, c) => {
  console.error('[admin-orders] unhandled error:', err);
  return c.json(
    { error: { code: 'internal_error', message: 'Unexpected server error' } },
    500,
  );
});

// A12: GET /api/v1/admin/orders — Order list with filters
//
// BUG-ORDERS-ARCHIVE-01 — default 30-day window for historical statuses.
// New query params (`from` / `to` / `include_stale` / `page_size`)
// complement the legacy ones (`date_from` / `date_to` / `per_page`) so
// callers don't have to migrate in lockstep.
adminOrders.get('/', async (c) => {
  const db = getDb();
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
  const pageSizeParam = c.req.query('page_size') ?? c.req.query('per_page') ?? '50';
  const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeParam, 10)));
  const includeStaleParam = c.req.query('include_stale');
  const includeStale = includeStaleParam === 'true' || includeStaleParam === '1';

  // BUG-ORDERS-ARCHIVE-01-COUNT-PARITY — single source of truth for
  // the WHERE clause. Shared with the /counts endpoint below so tab
  // badges always match filtered rows. include_stale=true bypasses
  // BOTH createdAt bounds and the archive cutoff (owner's contract
  // preserved from BUG-ORDERS-ARCHIVE-01-HOTFIX).
  const where = buildOrdersWhere({
    status: c.req.query('status'),
    from: c.req.query('from'),
    to: c.req.query('to'),
    date_from: c.req.query('date_from'),
    date_to: c.req.query('date_to'),
    include_stale: includeStaleParam,
    search: c.req.query('search'),
    search_sku: c.req.query('search_sku'),
    search_product_name: c.req.query('search_product_name'),
    search_tracking: c.req.query('search_tracking'),
    search_order_number: c.req.query('search_order_number'),
    search_customer_name: c.req.query('search_customer_name'),
    search_customer_phone: c.req.query('search_customer_phone'),
  });

  try {
    const [orders, total] = await Promise.all([
      // BUG-520: fetch items without product include to avoid FK failures
      // when a product has been hard-deleted. Product data is enriched
      // separately below using snapshot fields as fallback.
      db.order.findMany({
        where,
        include: {
          customer: {
            select: { firstName: true, lastName: true, email: true, phone: true },
          },
          items: {
            select: {
              id: true,
              productId: true,
              productName: true,
              size: true,
              quantity: true,
              status: true,
              subtotal: true,
              lateFee: true,
              damageFee: true,
            },
          },
          paymentSlips: {
            select: { verificationStatus: true },
            take: 1,
            orderBy: { createdAt: 'desc' },
          },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      db.order.count({ where }),
    ]);

    // BUG-520: batch-fetch product data (sku, thumbnail) separately.
    // If a product was hard-deleted, we gracefully fall back to snapshot fields.
    const allProductIds = [...new Set(orders.flatMap((o) => o.items.map((i) => i.productId)))];
    // BUG-538: include images relation — thumbnailUrl is often null while
    // product has images in product_images table (same pattern as products list).
    const products = allProductIds.length > 0
      ? await db.product.findMany({
          where: { id: { in: allProductIds } },
          select: { id: true, sku: true, thumbnailUrl: true, images: { select: { url: true }, orderBy: { sortOrder: 'asc' }, take: 1 } },
        }).catch(() => [] as Array<{ id: string; sku: string; thumbnailUrl: string | null; images: Array<{ url: string }> }>)
      : [];
    const productMap = new Map(products.map((p) => [p.id, p]));

    const data = orders.map((o) => ({
      id: o.id,
      order_number: o.orderNumber,
      status: o.status,
      customer: {
        name: customerDisplayName(o.customer.firstName, o.customer.lastName, o.customer.email),
        email: customerDisplayEmail(o.customer.email),
        phone: customerDisplayPhone(o.customer.phone, o.customer.email),
        _deleted: isCustomerDeleted(o.customer.email),
      },
      items: o.items.map((item) => {
        const product = productMap.get(item.productId);
        return {
          id: item.id,
          product_name: item.productName,
          sku: product?.sku ?? '',
          size: item.size,
          quantity: item.quantity,
          subtotal: item.subtotal,
          late_fee: item.lateFee,
          damage_fee: item.damageFee,
          item_status: item.status,
          thumbnail: product?.images[0]?.url ?? product?.thumbnailUrl ?? null,
        };
      }),
      tracking_number: ((o.shippingSnapshot as Record<string, unknown>)?.tracking_number as string) ?? null,
      total_amount: o.totalAmount,
      late_fee: o.lateFee,
      damage_fee: o.damageFee,
      credit_applied: o.creditApplied ?? 0,
      delivery_method: o.deliveryMethod,
      return_method: o.returnMethod,
      payment_status: o.paymentSlips[0]?.verificationStatus ?? 'no_slip',
      rental_period: {
        start: o.rentalStartDate.toISOString().split('T')[0],
        end: o.rentalEndDate.toISOString().split('T')[0],
      },
      created_at: o.createdAt.toISOString(),
      // BUG-505: derived UI flags (computed, not stored)
      flags: computeDerivedFlags(o.status, o.rentalStartDate, o.rentalEndDate),
    }));

    const pagination = computePagination({ total, page, pageSize });
    return success(c, data, {
      page,
      per_page: pageSize,
      page_size: pageSize,
      total,
      total_pages: pagination.totalPages,
      has_more: pagination.hasMore,
      include_stale: includeStale,
    });
  } catch (err) {
    console.error('[admin-orders] list query failed:', err);
    return error(c, 500, 'query_failed', 'Failed to fetch orders');
  }
});

// GET /api/v1/admin/orders/counts — Tab-badge counts.
//
// BUG-ORDERS-ARCHIVE-01-COUNT-PARITY — returns `{ total, by_status }`
// in a single `groupBy` pass using the EXACT same WHERE clause the
// list route applies (minus the caller's `status` filter, so every
// bucket's count is always available to the tab bar). This replaces
// the old frontend pattern of firing N list queries with `page_size=1`
// per status, which was fragile under React-Query cache interactions
// and caused tab badges to read 0 whenever a parallel list call
// missed its cache or raced with the data query.
adminOrders.get('/counts', async (c) => {
  const db = getDb();
  const includeStaleParam = c.req.query('include_stale');

  const where = buildOrdersCountsWhere({
    from: c.req.query('from'),
    to: c.req.query('to'),
    date_from: c.req.query('date_from'),
    date_to: c.req.query('date_to'),
    include_stale: includeStaleParam,
    search: c.req.query('search'),
    search_sku: c.req.query('search_sku'),
    search_product_name: c.req.query('search_product_name'),
    search_tracking: c.req.query('search_tracking'),
    search_order_number: c.req.query('search_order_number'),
    search_customer_name: c.req.query('search_customer_name'),
    search_customer_phone: c.req.query('search_customer_phone'),
  });

  try {
    const [groups, total] = await Promise.all([
      db.order.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      db.order.count({ where }),
    ]);

    const byStatus: Record<string, number> = {};
    for (const g of groups) {
      byStatus[g.status] = g._count._all;
    }

    return success(c, { total, by_status: byStatus });
  } catch (err) {
    console.error('[admin-orders] counts query failed:', err);
    return error(c, 500, 'query_failed', 'Failed to fetch order counts');
  }
});

// GET /api/v1/admin/orders/:id — Order detail
adminOrders.get('/:id', async (c) => {
  const db = getDb();
  const orderId = c.req.param('id');

  // BUG-520: fetch items without product include to avoid FK failures
  // when a product has been hard-deleted. Product data is enriched separately.
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      customer: {
        include: {
          documents: true,
        },
      },
      items: true,
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

  // BUG-520: batch-fetch product data separately for resilience.
  const itemProductIds = [...new Set(order.items.map((i) => i.productId))];
  const itemProducts = itemProductIds.length > 0
    ? await db.product.findMany({
        where: { id: { in: itemProductIds } },
        select: {
          id: true,
          sku: true,
          thumbnailUrl: true,
          images: { select: { id: true, url: true, altText: true, sortOrder: true } },
        },
      }).catch(() => [] as Array<{ id: string; sku: string; thumbnailUrl: string | null; images: Array<{ id: string; url: string; altText: string | null; sortOrder: number }> }>)
    : [];
  const detailProductMap = new Map(itemProducts.map((p) => [p.id, p]));

  // Fetch audit logs with BUG-508 resilience wrapper
  const auditResult = await safeAuditLogQuery<{ id: string; action: string; resource: string | null; details: unknown; adminId: string; createdAt: Date; admin?: { name: string | null; email: string } | null }>(
    db,
    {
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      include: {
        admin: { select: { id: true, name: true, email: true } },
      },
    },
  );
  const auditLogEntries = auditResult.data;
  const auditLogsDegraded = auditResult.degraded;

  const data = {
    id: order.id,
    order_number: order.orderNumber,
    status: order.status,
    total_amount: order.totalAmount,
    late_fee: order.lateFee,
    damage_fee: order.damageFee,
    deposit_total: order.deposit,
    delivery_fee: order.deliveryFee,
    credit_applied: order.creditApplied,
    delivery_method: order.deliveryMethod,
    return_method: order.returnMethod,
    messenger_fee_send: order.messengerFeeSend,
    messenger_fee_return: order.messengerFeeReturn,
    messenger_distance_km: order.messengerDistanceKm,
    messenger_payment_mode: order.messengerPaymentMode,
    customer: (() => {
      const deleted = isCustomerDeleted(order.customer.email);
      return {
        id: order.customer.id,
        name: customerDisplayName(order.customer.firstName, order.customer.lastName, order.customer.email),
        first_name: deleted ? '[Deleted' : order.customer.firstName,
        last_name: deleted ? 'customer]' : order.customer.lastName,
        phone: customerDisplayPhone(order.customer.phone, order.customer.email),
        email: customerDisplayEmail(order.customer.email),
        address: deleted ? {} : order.customer.address,
        _deleted: deleted,
        // BUG-519: deduplicate customer documents by doc_type (keep latest).
        documents: deleted ? [] : [...order.customer.documents]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .filter((doc, _i, arr) => arr.findIndex((d) => d.docType === doc.docType) === arr.indexOf(doc))
        .map((doc) => ({
          id: doc.id,
          doc_type: doc.docType,
          storage_key: doc.storageKey,
          verified: doc.verified,
          created_at: doc.createdAt.toISOString(),
        })),
      };
    })(),
    items: order.items.map((item) => {
      const rentalDays = Math.ceil(
        (order.rentalEndDate.getTime() - order.rentalStartDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      const product = detailProductMap.get(item.productId);
      return {
        id: item.id,
        product_name: item.productName,
        sku: product?.sku ?? '',
        size: item.size,
        quantity: item.quantity,
        rental_days: rentalDays,
        price_per_day: item.rentalPricePerDay,
        subtotal: item.subtotal,
        late_fee: item.lateFee,
        damage_fee: item.damageFee,
        status: item.status,
        // BUG-538: prefer first image from images relation over thumbnailUrl
        thumbnail: product?.images[0]?.url ?? product?.thumbnailUrl ?? null,
        images: product?.images ?? [],
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
    // BUG-505: derived UI flags (computed, not stored)
    flags: computeDerivedFlags(order.status, order.rentalStartDate, order.rentalEndDate),
    _meta: auditLogsDegraded ? { warning: 'audit_logs_unavailable' } : undefined,
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

  // Update customer name (skip for soft-deleted customers — PII is masked)
  if (parsed.data.customer_name) {
    if (isCustomerDeleted(order.customer.email)) {
      return error(c, 400, 'VALIDATION_ERROR', 'Cannot edit name of a deleted customer');
    }
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

  // Audit log (BUG-508 resilient)
  await safeAuditLogCreate(db, {
    orderId,
    adminId: admin.sub,
    action: 'EDIT',
    resource: 'order',
    resourceId: orderId,
    details: { changes },
  });

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
  // BUG-508 resilient
  await safeAuditLogCreate(db, {
    orderId,
    adminId: admin.sub,
    action: 'ADD_ITEM',
    resource: 'order_item',
    resourceId: newItem.id,
    details: { product_name: product.name, sku: product.sku, size: parsed.data.size, subtotal: parsed.data.subtotal },
  });

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
  // BUG-508 resilient
  await safeAuditLogCreate(db, {
    orderId,
    adminId: admin.sub,
    action: 'REMOVE_ITEM',
    resource: 'order_item',
    resourceId: itemId,
    details: { product_name: item.productName, size: item.size, subtotal: item.subtotal, refund: refundAmount },
  });

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
    late_fee: z.number().int().min(0).optional(),
    damage_fee: z.number().int().min(0).optional(),
    fee_note: z.string().optional(),
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

  // BUG-405-A01 — atomic CORE writes.
  //
  // The order.update and orderStatusLog.create are the only writes
  // that define whether the transition "really happened". They MUST
  // be atomic: either both land or neither lands. A half-commit (the
  // order flips status but the audit log is missing, or vice versa)
  // would silently corrupt downstream reports.
  //
  // Running them inside a single Prisma `$transaction` batch gives
  // us that atomicity at the DB level. If either throws, the whole
  // tx rolls back and the error bubbles to `adminOrders.onError()`,
  // which returns an HTTP 500 + JSON envelope to the client.
  // FEAT-512: Persist manual late_fee / damage_fee on final status transitions
  const isFinalStatus = toStatus === 'returned' || toStatus === 'finished';
  const enteredLateFee = isFinalStatus ? (parsed.data.late_fee ?? 0) : 0;
  const enteredDamageFee = isFinalStatus ? (parsed.data.damage_fee ?? 0) : 0;

  // FEAT-512 Hard Fix 1: Max value guard — combined fees must not exceed 3× subtotal
  if (isFinalStatus) {
    const feeSum = enteredLateFee + enteredDamageFee;
    const feeGuardLimit = order.subtotal * 3;
    if (feeSum > feeGuardLimit) {
      return error(c, 400, 'FEE_EXCEEDS_GUARD', `Combined fees (${feeSum}) exceed 3× subtotal guard (${feeGuardLimit})`, {
        entered_late_fee: enteredLateFee,
        entered_damage_fee: enteredDamageFee,
        fee_sum: feeSum,
        subtotal: order.subtotal,
        guard_limit: feeGuardLimit,
      });
    }
  }

  const updateData: Prisma.OrderUpdateInput = {
    status: toStatus,
    ...(parsed.data.tracking_number && {
      shippingSnapshot: {
        ...(order.shippingSnapshot as Record<string, unknown> ?? {}),
        tracking_number: parsed.data.tracking_number,
      },
    }),
    ...(isFinalStatus && {
      lateFee: enteredLateFee,
      damageFee: enteredDamageFee,
      totalAmount: order.subtotal + order.deposit + order.deliveryFee + enteredLateFee + enteredDamageFee - order.discount - order.creditApplied,
    }),
  };

  const updateArgs: Prisma.OrderUpdateArgs = {
    where: { id: orderId },
    data: updateData,
  };
  const statusLogArgs: Prisma.OrderStatusLogCreateArgs = {
    data: {
      orderId,
      fromStatus: order.status,
      toStatus,
      note: parsed.data.note ?? null,
      changedBy: admin.sub,
    },
  };
  const [updatedOrder] = await db.$transaction([
    db.order.update(updateArgs),
    db.orderStatusLog.create(statusLogArgs),
  ]);

  // BUG-405-A01 — SIDE-EFFECT writes.
  //
  // Every side effect below is individually isolated in its own
  // try/catch so one failure cannot contaminate another. A Neon
  // cold-start stall in `orderItem.aggregate`, a Prisma validation
  // error in `financeTransaction.create`, a notification provider
  // outage — none of these should reach the client. The response
  // envelope is committed regardless.
  //
  // Root-cause note: pre-A01 these were wrapped in a single coarse
  // try/catch, so a stall in one op could drain the Worker's
  // wall-clock budget before `success()` was reached. Empty catches
  // are intentional here: we are trading observability inside this
  // handler for guaranteed response delivery, matching the spec's
  // "fail quiet" side-effect rule. Upstream telemetry (BUG-401) and
  // NotificationLog rows already capture the signals we need.

  // BUG-219: Sync calendar availability when order transitions to paid_locked.
  // This ensures orders that go from unpaid → paid_locked via admin panel
  // also block dates on the calendar.
  if (toStatus === 'paid_locked') {
    try {
      const orderItems = await db.orderItem.findMany({ where: { orderId } });
      const rentalDays = Math.max(1, Math.ceil(
        (order.rentalEndDate.getTime() - order.rentalStartDate.getTime()) / (1000 * 60 * 60 * 24),
      ));
      for (const item of orderItems) {
        await confirmHolds(db, item.productId, order.rentalStartDate, rentalDays, orderId);
      }
    } catch { /* calendar sync failure is non-blocking */ }
  }

  // FEAT-512: Use the manually-entered order-level fees (not auto-calc from items)
  const totalLateFee = enteredLateFee;
  const totalDamageFee = enteredDamageFee;

  if (toStatus === 'finished' && db.financeTransaction?.create) {
    const totalDeductions = totalLateFee + totalDamageFee;
    const depositReturn = Math.max(0, (order.deposit ?? 0) - totalDeductions);

    if (depositReturn > 0) {
      try {
        await db.financeTransaction.create({
          data: {
            orderId,
            txType: 'deposit_returned',
            amount: depositReturn,
            note: `Auto deposit return for ${order.orderNumber} (deposit: ${order.deposit}, deductions: ${totalDeductions})`,
            createdBy: admin.sub,
          },
        });
      } catch { /* deposit_returned failure is non-blocking */ }
    }

    if (totalDeductions > 0) {
      try {
        await db.financeTransaction.create({
          data: {
            orderId,
            txType: 'deposit_forfeited',
            amount: totalDeductions,
            note: `Deposit deduction for ${order.orderNumber} (late: ${totalLateFee}, damage: ${totalDamageFee})`,
            createdBy: admin.sub,
          },
        });
      } catch { /* deposit_forfeited failure is non-blocking */ }
    }
  }

  // BUG-517: Guard against double-counting rental_revenue.
  // Revenue may already exist from payment verification flow.
  // For manual/cash payments (mark_as_paid, admin edit) there's no verification,
  // so this fallback ensures revenue is recorded exactly once.
  if (toStatus === 'returned' && db.financeTransaction?.create) {
    try {
      const existingRevenue = await db.financeTransaction.findFirst({
        where: { orderId, txType: 'rental_revenue', amount: { gt: 0 } },
      });
      if (!existingRevenue) {
        await db.financeTransaction.create({
          data: {
            orderId,
            txType: 'rental_revenue',
            amount: order.subtotal,
            note: `Rental revenue for ${order.orderNumber} (no prior payment verification)`,
            createdBy: admin.sub,
          },
        });
      }
    } catch { /* returned-revenue guard failure is non-blocking */ }
  }

  // FEAT-512: Record finance transactions for manually-entered fees
  if (isFinalStatus && db.financeTransaction?.create) {
    if (enteredLateFee > 0) {
      try {
        await db.financeTransaction.create({
          data: {
            orderId,
            txType: 'late_fee',
            amount: enteredLateFee,
            note: parsed.data.fee_note || `Late fee for ${order.orderNumber}`,
            createdBy: admin.sub,
          },
        });
      } catch { /* late_fee tx failure is non-blocking */ }
    }
    if (enteredDamageFee > 0) {
      try {
        await db.financeTransaction.create({
          data: {
            orderId,
            txType: 'damage_fee',
            amount: enteredDamageFee,
            note: parsed.data.fee_note || `Damage fee for ${order.orderNumber}`,
            createdBy: admin.sub,
          },
        });
      } catch { /* damage_fee tx failure is non-blocking */ }
    }
  }

  if (toStatus === 'cancelled' && db.financeTransaction?.create) {
    try {
      await db.financeTransaction.create({
        data: {
          orderId,
          txType: 'rental_revenue',
          amount: -order.subtotal,
          note: `Order cancelled - revenue reversed for ${order.orderNumber}`,
          createdBy: admin.sub,
        },
      });
    } catch { /* cancelled-revenue failure is non-blocking */ }
  }

  // Customer notification (individually isolated, including the
  // customer lookup itself — a Neon stall on findUnique should not
  // hang the response).
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
  } catch { /* notification failure is non-blocking */ }

  // Admin audit log (individually isolated).
  // BUG-508 resilient
  await safeAuditLogCreate(db, {
    orderId,
    adminId: admin.sub,
    action: 'STATUS_CHANGE',
    resource: 'order',
    resourceId: orderId,
    details: {
      from: order.status,
      to: toStatus,
      tracking_number: parsed.data.tracking_number,
      late_fee: enteredLateFee,
      damage_fee: enteredDamageFee,
      ...(parsed.data.fee_note && { fee_note: parsed.data.fee_note }),
    },
  });

  return success(c, {
    id: updatedOrder.id,
    order_number: updatedOrder.orderNumber,
    previous_status: order.status,
    current_status: updatedOrder.status,
    late_fee: updatedOrder.lateFee,
    damage_fee: updatedOrder.damageFee,
    total_amount: updatedOrder.totalAmount,
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

        // BUG-517: Record rental_revenue as subtotal (pure rental price),
        // not totalAmount which includes refundable deposit + delivery fees.
        try {
          await db.financeTransaction.create({
            data: {
              orderId,
              txType: 'rental_revenue',
              amount: order.subtotal,
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

  // BUG-508 resilient
  await safeAuditLogCreate(db, {
    orderId,
    adminId: admin.sub,
    action: parsed.data.verified ? 'VERIFY' : 'REJECT',
    resource: 'payment_slip',
    resourceId: slip.id,
    details: { order_id: orderId, slip_id: slip.id, verified: parsed.data.verified, note: parsed.data.note, credit_added: creditAdded },
  });

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
  // BUG-508 resilient
  await safeAuditLogCreate(db, {
    orderId,
    adminId: admin.sub,
    action: 'EDIT',
    resource: 'payment_slip',
    resourceId: slipId,
    details: { old_amount: slip.declaredAmount, new_amount: parsed.data.declared_amount },
  });

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
        select: { firstName: true, lastName: true, phone: true, email: true },
      },
    },
    orderBy: { rentalEndDate: 'asc' },
  });

  const data = overdueOrders.map((o) => {
    const daysLate = Math.ceil((now.getTime() - new Date(o.rentalEndDate).getTime()) / (1000 * 60 * 60 * 24));
    return {
      id: o.id,
      order_number: o.orderNumber,
      customer_name: customerDisplayName(o.customer.firstName, o.customer.lastName, o.customer.email),
      customer_phone: customerDisplayPhone(o.customer.phone, o.customer.email),
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
    // BUG-231: reason is required (min 10 chars) for audit trail
    reason: z.string().min(10, 'Reason must be at least 10 characters'),
    note: z.string().optional(), // backward compat: old callers may still send note
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

  // BUG-231: Use reason as primary note field (required, min 10 chars)
  const reasonText = parsed.data.reason;

  // Create after-sales event
  const event = await db.afterSalesEvent.create({
    data: {
      orderId,
      eventType: parsed.data.event_type,
      amount: parsed.data.amount,
      note: reasonText,
      createdBy: admin.sub,
    },
  });

  // BUG-231: Write audit log with reason text (uses BUG-222 infrastructure)
  await safeAuditLogCreate(db, {
    orderId,
    adminId: admin.sub,
    action: 'AFTER_SALES',
    resource: 'after_sales_event',
    resourceId: event.id,
    details: { event_type: parsed.data.event_type, amount: parsed.data.amount, reason: reasonText },
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
      note: `After-sales: ${parsed.data.event_type} - ${reasonText}`,
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
      customer: { select: { firstName: true, lastName: true, email: true } },
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
    customer_name: customerDisplayName(order.customer.firstName, order.customer.lastName, order.customer.email),
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

  // BUG-229: Reject dates beyond the booking window (today + 2 years)
  if (!isDateWithinBookingWindow(rental_start_date)) {
    return error(c, 400, 'DATE_OUT_OF_RANGE', 'Rental start date is too far in the future (max 2 years ahead)');
  }
  if (!isDateWithinBookingWindow(rental_end_date)) {
    return error(c, 400, 'DATE_OUT_OF_RANGE', 'Rental end date is too far in the future (max 2 years ahead)');
  }

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

  // BUG-219: Sync calendar availability for admin-created orders.
  // When mark_as_paid is true, the order goes directly to paid_locked and
  // calendar slots must be booked immediately (matching customer flow).
  if (mark_as_paid) {
    for (const item of items) {
      try {
        await confirmHolds(db, item.product_id, startDate, totalDays, order.id);
      } catch {
        // Non-blocking: calendar sync failure should not break order creation
      }
    }
  }

  // Audit log
  // BUG-508 resilient
  await safeAuditLogCreate(db, {
    orderId: order.id,
    adminId: admin.sub,
    action: 'CREATE_ORDER',
    resource: 'order',
    resourceId: order.id,
    details: { order_number: orderNumber, customer_name, items_count: items.length, total: totalAmount },
  });

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

// FEAT-402: Backfill lifecycle blocks for pre-existing orders
adminOrders.post('/backfill-lifecycle-blocks', async (c) => {
  const db = getDb();

  // Get wash_duration_days from SystemConfig
  const washConfig = await db.systemConfig.findUnique({
    where: { key: 'wash_duration_days' },
  });
  const washDurationDays = washConfig ? parseInt(String(washConfig.value), 10) || 1 : 1;

  // Get all orders that don't already have shipping/washing blocks
  const orders = await db.order.findMany({
    include: {
      items: true,
      availabilitySlots: {
        where: { slotStatus: { in: ['shipping', 'washing'] } },
        take: 1,
      },
    },
  });

  // Filter to orders without existing lifecycle blocks
  const ordersToBackfill = orders.filter((o) => o.availabilitySlots.length === 0);

  let totalShipping = 0;
  let totalWashing = 0;
  let ordersProcessed = 0;
  const errors: string[] = [];

  for (const order of ordersToBackfill) {
    try {
      // Extract province code from shipping snapshot
      const snapshot = order.shippingSnapshot as Record<string, unknown> | null;
      const address = snapshot?.address as Record<string, unknown> | null;
      const provinceCode = (address?.province_code as string) ?? null;

      // Look up shipping days for province (with fallback if migration 007 not yet applied)
      let shippingDays = 2; // default
      if (provinceCode) {
        try {
          const provinceConfig = await db.shippingProvinceConfig.findFirst({
            where: { provinceCode },
          });
          if (provinceConfig) {
            shippingDays = provinceConfig.shippingDays;
          }
        } catch {
          // shipping_days column may not exist yet — use zone-based defaults
          if (['BKK', 'NBI', 'PTH', 'SMK'].includes(provinceCode)) shippingDays = 1;
          else if (['CMI', 'PKT'].includes(provinceCode)) shippingDays = 3;
          else shippingDays = 2;
        }
      }

      // Create lifecycle blocks for each order item
      for (const item of order.items) {
        const rentalStart = order.rentalStartDate;
        const rentalEnd = order.rentalEndDate;

        const result = await createLifecycleBlocks(
          db,
          item.productId,
          rentalStart,
          rentalEnd,
          shippingDays,
          washDurationDays,
          order.id
        );

        totalShipping += result.shippingBlocked;
        totalWashing += result.washingBlocked;
      }

      ordersProcessed++;
    } catch (e) {
      errors.push(`Order ${order.orderNumber}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return success(c, {
    orders_scanned: orders.length,
    orders_already_had_blocks: orders.length - ordersToBackfill.length,
    orders_backfilled: ordersProcessed,
    shipping_blocks_created: totalShipping,
    washing_blocks_created: totalWashing,
    wash_duration_days: washDurationDays,
    errors,
  });
});

// ─── BUG-505: Backfill stale orders (one-shot, idempotent) ─────────────
//
// POST /api/v1/admin/orders/backfill-auto-advance
// Body: { dry_run?: boolean }
// Targets stale orders (e.g. ORD-26050507: paid_locked with rental already ended)
// and advances them per the auto-advance rules.
adminOrders.post('/backfill-auto-advance', async (c) => {
  const db = getDb();

  const bodySchema = z.object({
    dry_run: z.boolean().optional().default(true),
  });

  const body = await c.req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid backfill request', parsed.error.flatten());
  }

  const result = await backfillStaleOrders(db, parsed.data.dry_run);

  return success(c, result);
});

export default adminOrders;
