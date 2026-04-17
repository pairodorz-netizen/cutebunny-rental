import { Hono } from 'hono';
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

  const where: Prisma.CustomerWhereInput = {};

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

export default adminCustomers;
