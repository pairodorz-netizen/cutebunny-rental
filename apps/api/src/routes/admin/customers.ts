import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../lib/db';
import { success, error } from '../../lib/response';
import type { Prisma } from '@prisma/client';
import { isCustomerDeleted, customerDisplayName, customerDisplayEmail, customerDisplayPhone } from '@cutebunny/shared/customer-pii';
import { normalizePhone, normalizePhoneSearch } from '@cutebunny/shared/phone-normalize';
import { normalizeAddresses } from '@cutebunny/shared/normalize-addresses';

const adminCustomers = new Hono();

// A10: GET /api/v1/admin/customers — Customer list
adminCustomers.get('/', async (c) => {
  const db = getDb();
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
  const perPage = Math.min(50, Math.max(1, parseInt(c.req.query('per_page') ?? '20', 10)));
  const search = c.req.query('search');
  const tier = c.req.query('tier');

  // BUG-540: Raw SQL with $queryRaw tagged template for explicit control.
  // Soft-delete pattern: customers have no deleted_at column — soft-deleted
  // records are identified by email prefix 'deleted_'.
  // Dynamic filters use "IS NULL OR" pattern to stay in tagged template.
  // BUG-234: Normalize phone search to match regardless of formatting
  const normalizedSearchPhone = search ? normalizePhoneSearch(search) : null;
  const searchPattern = search ? `%${search}%` : null;
  const phoneSearchPattern = normalizedSearchPhone ? `%${normalizedSearchPhone}%` : null;
  const tierFilter = tier ?? null;
  const offset = (page - 1) * perPage;

  interface CustomerRow {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    tier: string;
    creditBalance: number;
    createdAt: Date;
    rentalCount: number;
    totalPayment: number;
    avatarUrl: string | null;
    displayName: string | null;
    lineUserId: string | null;
    lineDisplayName: string | null;
    linePictureUrl: string | null;
    lastLoginAt: Date | null;
    status: string;
  }

  // Run sequentially to reduce concurrent connection pressure on Neon.
  const customers = await db.$queryRaw<CustomerRow[]>`
    SELECT
      c.id,
      c.first_name AS "firstName",
      c.last_name AS "lastName",
      c.email,
      c.phone,
      c.tier,
      c.credit_balance AS "creditBalance",
      c.created_at AS "createdAt",
      COALESCE(stats.rental_count, 0)::int AS "rentalCount",
      COALESCE(stats.total_payment, 0)::int AS "totalPayment",
      c.avatar_url AS "avatarUrl",
      c.display_name AS "displayName",
      c.line_user_id AS "lineUserId",
      c.line_display_name AS "lineDisplayName",
      c.line_picture_url AS "linePictureUrl",
      c.last_login_at AS "lastLoginAt",
      c.status
    FROM customers c
    LEFT JOIN (
      SELECT
        o.customer_id,
        COALESCE(SUM(ic.cnt), 0)::int AS rental_count,
        COALESCE(SUM(o.total_amount), 0)::int AS total_payment
      FROM orders o
      LEFT JOIN (
        SELECT order_id, COUNT(*)::int AS cnt
        FROM order_items
        GROUP BY order_id
      ) ic ON ic.order_id = o.id
      WHERE o.status IN ('paid_locked', 'shipped', 'returned', 'repair', 'finished')
      GROUP BY o.customer_id
    ) stats ON stats.customer_id = c.id
    WHERE c.email NOT LIKE 'deleted_%'
      AND COALESCE(c.status, 'active') != 'merged'
      AND (${searchPattern}::text IS NULL OR (
        c.first_name ILIKE ${searchPattern}
        OR c.last_name ILIKE ${searchPattern}
        OR c.email ILIKE ${searchPattern}
        OR c.phone LIKE ${searchPattern}
        OR c.line_display_name ILIKE ${searchPattern}
        OR (${phoneSearchPattern}::text IS NOT NULL AND REGEXP_REPLACE(c.phone, '[^0-9]', '', 'g') LIKE ${phoneSearchPattern})
      ))
      AND (${tierFilter}::text IS NULL OR c.tier::text = ${tierFilter})
    ORDER BY c.created_at DESC
    LIMIT ${perPage} OFFSET ${offset}
  `;

  const countResult = await db.$queryRaw<[{ total: number }]>`
    SELECT COUNT(*)::int AS total
    FROM customers c
    WHERE c.email NOT LIKE 'deleted_%'
      AND COALESCE(c.status, 'active') != 'merged'
      AND (${searchPattern}::text IS NULL OR (
        c.first_name ILIKE ${searchPattern}
        OR c.last_name ILIKE ${searchPattern}
        OR c.email ILIKE ${searchPattern}
        OR c.phone LIKE ${searchPattern}
        OR c.line_display_name ILIKE ${searchPattern}
        OR (${phoneSearchPattern}::text IS NOT NULL AND REGEXP_REPLACE(c.phone, '[^0-9]', '', 'g') LIKE ${phoneSearchPattern})
      ))
      AND (${tierFilter}::text IS NULL OR c.tier::text = ${tierFilter})
  `;

  const total = countResult[0]?.total ?? 0;

  const data = customers.map((cust: CustomerRow) => {
    const isPlaceholderEmail = cust.email.endsWith('@placeholder.local');
    const loginMethods: string[] = [];
    if (cust.email && !isPlaceholderEmail) loginMethods.push('email');
    if (cust.lineUserId) loginMethods.push('line');

    return {
      id: cust.id,
      name: cust.displayName || `${cust.firstName} ${cust.lastName}`.trim() || cust.lineDisplayName || 'Unknown',
      email: isPlaceholderEmail ? null : cust.email,
      email_raw: cust.email,
      phone: cust.phone,
      tier: cust.tier,
      rental_count: cust.rentalCount,
      total_payment: cust.totalPayment,
      credit_balance: cust.creditBalance,
      created_at: new Date(cust.createdAt).toISOString(),
      avatar_url: cust.linePictureUrl || cust.avatarUrl || null,
      line_user_id: cust.lineUserId,
      line_display_name: cust.lineDisplayName,
      login_methods: loginMethods,
      last_login_at: cust.lastLoginAt ? new Date(cust.lastLoginAt).toISOString() : null,
    };
  });

  return success(c, data, {
    page,
    per_page: perPage,
    total,
    total_pages: Math.ceil(total / perPage),
  });
});

// A10: GET /api/v1/admin/customers/:id — Customer detail
adminCustomers.get('/:id', async (c) => {
  const db = getDb();
  const id = c.req.param('id');

  const customer = await db.customer.findUnique({
    where: { id },
    include: {
      documents: {
        select: {
          id: true,
          docType: true,
          verified: true,
          createdAt: true,
        },
      },
      identities: {
        select: {
          id: true,
          provider: true,
          providerSubject: true,
          verificationMethod: true,
          verifiedAt: true,
          lastUsedAt: true,
          createdAt: true,
        },
      },
      orders: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          totalAmount: true,
          rentalStartDate: true,
          rentalEndDate: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
    },
  });

  if (!customer) {
    return error(c, 404, 'NOT_FOUND', 'Customer not found');
  }

  // BUG-541: mask PII for soft-deleted customers (right-to-be-forgotten)
  const deleted = isCustomerDeleted(customer.email);
  const isPlaceholderEmail = customer.email.endsWith('@placeholder.local');

  const loginMethods: string[] = [];
  if (!deleted) {
    if (customer.email && !isPlaceholderEmail) loginMethods.push('email');
    if (customer.lineUserId) loginMethods.push('line');
  }

  return success(c, {
    id: customer.id,
    name: customerDisplayName(customer.firstName, customer.lastName, customer.email),
    display_name: deleted ? null : (customer.displayName || null),
    first_name: deleted ? '[Deleted' : customer.firstName,
    last_name: deleted ? 'customer]' : customer.lastName,
    email: deleted ? customerDisplayEmail(customer.email) : (isPlaceholderEmail ? null : customer.email),
    email_raw: customerDisplayEmail(customer.email),
    phone: customerDisplayPhone(customer.phone, customer.email),
    avatar_url: deleted ? null : (customer.linePictureUrl || customer.avatarUrl || null),
    tier: customer.tier,
    rental_count: customer.rentalCount,
    total_payment: customer.totalPayment,
    credit_balance: customer.creditBalance,
    tags: deleted ? [] : customer.tags,
    address: deleted ? {} : customer.address,
    addresses: deleted ? [] : normalizeAddresses(customer.address),
    locale: customer.locale,
    _deleted: deleted,
    line_user_id: deleted ? null : (customer.lineUserId ?? null),
    line_display_name: deleted ? null : (customer.lineDisplayName ?? null),
    line_picture_url: deleted ? null : (customer.linePictureUrl ?? null),
    login_methods: loginMethods,
    last_login_at: customer.lastLoginAt?.toISOString() ?? null,
    status: customer.status,
    merged_into: customer.mergedInto ?? null,
    identities: deleted ? [] : customer.identities.map((i) => ({
      id: i.id,
      provider: i.provider,
      provider_subject: i.providerSubject,
      verification_method: i.verificationMethod,
      verified_at: i.verifiedAt?.toISOString() ?? null,
      last_used_at: i.lastUsedAt?.toISOString() ?? null,
      created_at: i.createdAt.toISOString(),
    })),
    documents: deleted ? [] : customer.documents.map((d) => ({
      id: d.id,
      type: d.docType,
      verified: d.verified,
      uploaded_at: d.createdAt.toISOString(),
    })),
    rental_history: customer.orders.map((o) => ({
      id: o.id,
      order_number: o.orderNumber,
      status: o.status,
      total_amount: o.totalAmount,
      rental_period: {
        start: o.rentalStartDate.toISOString().split('T')[0],
        end: o.rentalEndDate.toISOString().split('T')[0],
      },
      created_at: o.createdAt.toISOString(),
    })),
    created_at: customer.createdAt.toISOString(),
  });
});

// POST /api/v1/admin/customers/:id/adjust-credit — Adjust customer credit balance
adminCustomers.post('/:id/adjust-credit', async (c) => {
  const db = getDb();
  const id = c.req.param('id');

  const bodySchema = z.object({
    amount: z.number().int(),
    reason: z.string().min(1),
  });

  const body = await c.req.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', parsed.error.issues.map((i) => i.message).join(', '));
  }

  const { amount, reason } = parsed.data;

  const customer = await db.customer.findUnique({ where: { id } });
  if (!customer) {
    return error(c, 404, 'NOT_FOUND', 'Customer not found');
  }

  const newBalance = customer.creditBalance + amount;
  if (newBalance < 0) {
    return error(c, 400, 'VALIDATION_ERROR', `Cannot deduct ${Math.abs(amount)} THB. Current balance is ${customer.creditBalance} THB.`);
  }

  const updated = await db.customer.update({
    where: { id },
    data: { creditBalance: newBalance },
  });

  // Log the credit adjustment as a finance transaction for tracking
  try {
    await db.financeTransaction.create({
      data: {
        txType: amount > 0 ? 'deposit_received' : 'deposit_returned',
        amount: Math.abs(amount),
        note: `Credit adjustment for customer ${customerDisplayName(customer.firstName, customer.lastName, customer.email)}: ${reason} (${customer.creditBalance} → ${newBalance} THB)`,
      },
    });
  } catch {
    // Finance transaction creation is non-critical
  }

  return success(c, {
    customer_id: id,
    previous_balance: customer.creditBalance,
    adjustment: amount,
    new_balance: updated.creditBalance,
    reason,
  });
});

// PATCH /api/v1/admin/customers/:id — Edit customer details (#4)
adminCustomers.patch('/:id', async (c) => {
  const db = getDb();
  const id = c.req.param('id');

  const bodySchema = z.object({
    first_name: z.string().min(1).optional(),
    last_name: z.string().min(1).optional(),
    phone: z.string().optional(),
    email: z.string().email().optional(),
    address: z.record(z.unknown()).optional(),
    line_id: z.string().optional(),
    birthday: z.string().optional(),
    tags: z.array(z.string()).optional(),
    locale: z.string().optional(),
  });

  const body = await c.req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten());
  }

  const customer = await db.customer.findUnique({ where: { id } });
  if (!customer) {
    return error(c, 404, 'NOT_FOUND', 'Customer not found');
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.first_name) updateData.firstName = parsed.data.first_name;
  if (parsed.data.last_name) updateData.lastName = parsed.data.last_name;
  // BUG-234: Normalize phone on save for consistent search
  if (parsed.data.phone !== undefined) updateData.phone = normalizePhone(parsed.data.phone) || parsed.data.phone;
  if (parsed.data.email) updateData.email = parsed.data.email;
  if (parsed.data.address) updateData.address = parsed.data.address;
  if (parsed.data.tags) updateData.tags = parsed.data.tags;
  if (parsed.data.locale) updateData.locale = parsed.data.locale;

  // Store LINE ID and birthday in address JSON
  if (parsed.data.line_id !== undefined || parsed.data.birthday !== undefined) {
    const currentAddr = (customer.address as Record<string, unknown>) ?? {};
    if (parsed.data.line_id !== undefined) currentAddr.line_id = parsed.data.line_id;
    if (parsed.data.birthday !== undefined) currentAddr.birthday = parsed.data.birthday;
    updateData.address = currentAddr;
  }

  const updated = await db.customer.update({
    where: { id },
    data: updateData as Prisma.CustomerUpdateInput,
  });

  return success(c, {
    id: updated.id,
    name: `${updated.firstName} ${updated.lastName}`,
    first_name: updated.firstName,
    last_name: updated.lastName,
    email: updated.email,
    phone: updated.phone,
    tags: updated.tags,
    address: updated.address,
  });
});

// DELETE /api/v1/admin/customers/:id — Soft delete customer (#4)
adminCustomers.delete('/:id', async (c) => {
  const db = getDb();
  const id = c.req.param('id');

  const customer = await db.customer.findUnique({ where: { id } });
  if (!customer) {
    return error(c, 404, 'NOT_FOUND', 'Customer not found');
  }

  // Soft delete by updating email to mark as deleted and adding deleted timestamp to address
  const addr = (customer.address as Record<string, unknown>) ?? {};
  addr._deleted_at = new Date().toISOString();
  addr._original_email = customer.email;

  await db.customer.update({
    where: { id },
    data: {
      email: `deleted_${Date.now()}_${customer.email}`,
      address: addr as Prisma.InputJsonValue,
    },
  });

  return success(c, { deleted: true, customer_id: id });
});

// PATCH /api/v1/admin/customers/:id/tags — Update customer tags (#5)
adminCustomers.patch('/:id/tags', async (c) => {
  const db = getDb();
  const id = c.req.param('id');

  const bodySchema = z.object({
    tags: z.array(z.string()),
  });

  const body = await c.req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid input');
  }

  const customer = await db.customer.findUnique({ where: { id } });
  if (!customer) {
    return error(c, 404, 'NOT_FOUND', 'Customer not found');
  }

  const updated = await db.customer.update({
    where: { id },
    data: { tags: parsed.data.tags },
  });

  return success(c, { id: updated.id, tags: updated.tags });
});

// GET /api/v1/admin/customers/:id/notes — Get customer shop notes (#5)
adminCustomers.get('/:id/notes', async (c) => {
  const db = getDb();
  const id = c.req.param('id');

  const customer = await db.customer.findUnique({ where: { id } });
  if (!customer) {
    return error(c, 404, 'NOT_FOUND', 'Customer not found');
  }

  const addr = (customer.address as Record<string, unknown>) ?? {};
  const notes: Array<{ text: string; created_at: string; updated_at?: string }> = Array.isArray(addr._shop_notes) ? addr._shop_notes as Array<{ text: string; created_at: string; updated_at?: string }> : [];

  return success(c, notes);
});

// POST /api/v1/admin/customers/:id/notes — Add shop note (#5)
adminCustomers.post('/:id/notes', async (c) => {
  const db = getDb();
  const id = c.req.param('id');

  const bodySchema = z.object({
    text: z.string().min(1),
  });

  const body = await c.req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Note text is required');
  }

  const customer = await db.customer.findUnique({ where: { id } });
  if (!customer) {
    return error(c, 404, 'NOT_FOUND', 'Customer not found');
  }

  const addr = (customer.address as Record<string, unknown>) ?? {};
  const notes: Array<{ text: string; created_at: string }> = Array.isArray(addr._shop_notes) ? addr._shop_notes as Array<{ text: string; created_at: string }> : [];
  notes.unshift({ text: parsed.data.text, created_at: new Date().toISOString() });
  addr._shop_notes = notes;

  await db.customer.update({
    where: { id },
    data: { address: addr as Prisma.InputJsonValue },
  });

  return success(c, notes);
});

// PUT /api/v1/admin/customers/:id/notes/:index — Edit shop note (#5)
adminCustomers.put('/:id/notes/:index', async (c) => {
  const db = getDb();
  const id = c.req.param('id');
  const index = parseInt(c.req.param('index'), 10);

  const bodySchema = z.object({
    text: z.string().min(1),
  });

  const body = await c.req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Note text is required');
  }

  const customer = await db.customer.findUnique({ where: { id } });
  if (!customer) {
    return error(c, 404, 'NOT_FOUND', 'Customer not found');
  }

  const addr = (customer.address as Record<string, unknown>) ?? {};
  const notes: Array<{ text: string; created_at: string; updated_at?: string }> = Array.isArray(addr._shop_notes) ? addr._shop_notes as Array<{ text: string; created_at: string; updated_at?: string }> : [];

  if (index < 0 || index >= notes.length) {
    return error(c, 404, 'NOT_FOUND', 'Note not found');
  }

  notes[index] = { ...notes[index], text: parsed.data.text, updated_at: new Date().toISOString() };
  addr._shop_notes = notes;

  await db.customer.update({
    where: { id },
    data: { address: addr as Prisma.InputJsonValue },
  });

  return success(c, notes);
});

// POST /api/v1/admin/customers/merge — Merge two customer records
const mergeSchema = z.object({
  source_id: z.string().uuid(),
  target_id: z.string().uuid(),
});

adminCustomers.post('/merge', async (c) => {
  const db = getDb();

  const body = await c.req.json().catch(() => null);
  const parsed = mergeSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'source_id and target_id (UUIDs) are required', parsed.error.flatten());
  }

  const { source_id, target_id } = parsed.data;

  if (source_id === target_id) {
    return error(c, 400, 'VALIDATION_ERROR', 'Cannot merge a customer into themselves');
  }

  const [source, target] = await Promise.all([
    db.customer.findUnique({
      where: { id: source_id },
      include: { identities: true, orders: true },
    }),
    db.customer.findUnique({
      where: { id: target_id },
      include: { identities: true },
    }),
  ]);

  if (!source) return error(c, 404, 'NOT_FOUND', 'Source customer not found');
  if (!target) return error(c, 404, 'NOT_FOUND', 'Target customer not found');
  if (source.status === 'merged') return error(c, 400, 'VALIDATION_ERROR', 'Source customer is already merged');
  if (target.status === 'merged') return error(c, 400, 'VALIDATION_ERROR', 'Target customer is already merged');

  // Build transaction operations
  const ops: Prisma.PrismaPromise<unknown>[] = [];

  // 1. Move identities from source to target (skip duplicates by provider)
  const targetProviders = new Set(target.identities.map((i) => i.provider));
  for (const identity of source.identities) {
    if (targetProviders.has(identity.provider)) {
      // Delete source identity if target already has one for this provider
      ops.push(db.customerIdentity.delete({ where: { id: identity.id } }));
    } else {
      // Move to target
      ops.push(db.customerIdentity.update({
        where: { id: identity.id },
        data: { customerId: target_id },
      }));
    }
  }

  // 2. Move orders from source to target
  if (source.orders.length > 0) {
    ops.push(db.order.updateMany({
      where: { customerId: source_id },
      data: { customerId: target_id },
    }));
  }

  // 3. Sum credit balances
  if (source.creditBalance > 0) {
    ops.push(db.customer.update({
      where: { id: target_id },
      data: { creditBalance: target.creditBalance + source.creditBalance },
    }));
  }

  // 4. Copy LINE cache from source to target if target doesn't have it
  if (source.lineUserId && !target.lineUserId) {
    ops.push(db.customer.update({
      where: { id: target_id },
      data: {
        lineUserId: source.lineUserId,
        lineDisplayName: source.lineDisplayName,
        linePictureUrl: source.linePictureUrl,
      },
    }));
  }

  // 5. Soft-delete source: set status=merged, mergedInto=target, rename email
  ops.push(db.customer.update({
    where: { id: source_id },
    data: {
      status: 'merged',
      mergedInto: target_id,
      email: `merged_${source_id}@placeholder.local`,
      lineUserId: null,
      lineDisplayName: null,
      linePictureUrl: null,
    },
  }));

  // 6. Audit log
  ops.push(db.systemLog.create({
    data: {
      job: 'customer_merge',
      status: 'success',
      details: {
        sourceId: source_id,
        targetId: target_id,
        movedOrders: source.orders.length,
        movedCredits: source.creditBalance,
        movedIdentities: source.identities.length,
      },
    },
  }));

  await db.$transaction(ops);

  return success(c, {
    merged: true,
    source_id,
    target_id,
    moved_orders: source.orders.length,
    moved_credits: source.creditBalance,
  });
});

export default adminCustomers;
