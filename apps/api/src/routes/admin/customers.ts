import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../lib/db';
import { success, error } from '../../lib/response';
import type { Prisma } from '@prisma/client';

const adminCustomers = new Hono();

// A10: GET /api/v1/admin/customers — Customer list
adminCustomers.get('/', async (c) => {
  const db = getDb();
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
  const perPage = Math.min(50, Math.max(1, parseInt(c.req.query('per_page') ?? '20', 10)));
  const search = c.req.query('search');
  const tier = c.req.query('tier');

  const where: Prisma.CustomerWhereInput = {
    // Exclude soft-deleted customers (email prefixed with "deleted_")
    NOT: { email: { startsWith: 'deleted_' } },
  };

  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search } },
    ];
  }

  if (tier) {
    where.tier = tier as Prisma.EnumCustomerTierFilter;
  }

  const [customers, total] = await Promise.all([
    db.customer.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        tier: true,
        rentalCount: true,
        totalPayment: true,
        creditBalance: true,
        createdAt: true,
      },
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy: { createdAt: 'desc' },
    }),
    db.customer.count({ where }),
  ]);

  const data = customers.map((c) => ({
    id: c.id,
    name: `${c.firstName} ${c.lastName}`,
    email: c.email,
    phone: c.phone,
    tier: c.tier,
    rental_count: c.rentalCount,
    total_payment: c.totalPayment,
    credit_balance: c.creditBalance,
    created_at: c.createdAt.toISOString(),
  }));

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

  return success(c, {
    id: customer.id,
    name: `${customer.firstName} ${customer.lastName}`,
    first_name: customer.firstName,
    last_name: customer.lastName,
    email: customer.email,
    phone: customer.phone,
    avatar_url: customer.avatarUrl,
    tier: customer.tier,
    rental_count: customer.rentalCount,
    total_payment: customer.totalPayment,
    credit_balance: customer.creditBalance,
    tags: customer.tags,
    address: customer.address,
    locale: customer.locale,
    documents: customer.documents.map((d) => ({
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
        note: `Credit adjustment for customer ${customer.firstName} ${customer.lastName}: ${reason} (${customer.creditBalance} → ${newBalance} THB)`,
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
  if (parsed.data.phone !== undefined) updateData.phone = parsed.data.phone;
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

export default adminCustomers;
