import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../lib/db';
import { success, error } from '../../lib/response';
import { getAdmin } from '../../middleware/auth';

const adminFinance = new Hono();

// ─── M02: Finance Categories ─────────────────────────────────────────────

// GET /api/v1/admin/finance/categories
adminFinance.get('/categories', async (c) => {
  const db = getDb();
  const categories = await db.financeCategory.findMany({
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
  });
  return success(c, categories.map((cat) => ({
    id: cat.id,
    name: cat.name,
    type: cat.type,
    description: cat.description,
    created_at: cat.createdAt.toISOString(),
  })));
});

// POST /api/v1/admin/finance/categories
adminFinance.post('/categories', async (c) => {
  const db = getDb();
  const schema = z.object({
    name: z.string().min(1).max(100),
    type: z.enum(['REVENUE', 'EXPENSE']),
    description: z.string().optional(),
  });
  const body = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid category data', parsed.error.flatten());
  }
  const cat = await db.financeCategory.create({ data: parsed.data });
  return success(c, { id: cat.id, name: cat.name, type: cat.type, description: cat.description }, undefined, 201);
});

// PATCH /api/v1/admin/finance/categories/:id
adminFinance.patch('/categories/:id', async (c) => {
  const db = getDb();
  const id = c.req.param('id');
  const schema = z.object({
    name: z.string().min(1).max(100).optional(),
    type: z.enum(['REVENUE', 'EXPENSE']).optional(),
    description: z.string().optional(),
  });
  const body = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid category data', parsed.error.flatten());
  }
  const existing = await db.financeCategory.findUnique({ where: { id } });
  if (!existing) {
    return error(c, 404, 'NOT_FOUND', 'Category not found');
  }
  const updated = await db.financeCategory.update({ where: { id }, data: parsed.data });
  return success(c, { id: updated.id, name: updated.name, type: updated.type, description: updated.description });
});

// ─── M02: Finance Transactions ───────────────────────────────────────────

// GET /api/v1/admin/finance/transactions
adminFinance.get('/transactions', async (c) => {
  const db = getDb();
  const schema = z.object({
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    category_id: z.string().uuid().optional(),
    type: z.enum(['REVENUE', 'EXPENSE']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    per_page: z.coerce.number().int().min(1).max(100).default(20),
  });
  const parsed = schema.safeParse({
    start_date: c.req.query('start_date'),
    end_date: c.req.query('end_date'),
    category_id: c.req.query('category_id'),
    type: c.req.query('type'),
    page: c.req.query('page'),
    per_page: c.req.query('per_page'),
  });
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid parameters', parsed.error.flatten());
  }

  const revenueTypes = ['rental_revenue', 'late_fee', 'damage_fee', 'force_buy', 'deposit_forfeited'];
  const expenseTypes = ['shipping', 'cogs', 'cleaning', 'repair', 'marketing', 'platform_fee', 'deposit_received', 'deposit_returned'];

  const where: Record<string, unknown> = {};
  if (parsed.data.start_date) {
    where.createdAt = { ...(where.createdAt as Record<string, unknown> ?? {}), gte: new Date(parsed.data.start_date) };
  }
  if (parsed.data.end_date) {
    where.createdAt = { ...(where.createdAt as Record<string, unknown> ?? {}), lte: new Date(parsed.data.end_date + 'T23:59:59.999Z') };
  }
  if (parsed.data.category_id) {
    where.categoryId = parsed.data.category_id;
  }
  if (parsed.data.type === 'REVENUE') {
    where.txType = { in: revenueTypes };
  } else if (parsed.data.type === 'EXPENSE') {
    where.txType = { in: expenseTypes };
  }

  const [transactions, total] = await Promise.all([
    db.financeTransaction.findMany({
      where,
      include: {
        order: { select: { orderNumber: true } },
        product: { select: { name: true, sku: true } },
        category: { select: { name: true, type: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (parsed.data.page - 1) * parsed.data.per_page,
      take: parsed.data.per_page,
    }),
    db.financeTransaction.count({ where }),
  ]);

  return success(c, {
    data: transactions.map((tx) => ({
      id: tx.id,
      order_id: tx.orderId,
      order_number: tx.order?.orderNumber ?? null,
      product_id: tx.productId,
      product_name: tx.product?.name ?? null,
      product_sku: tx.product?.sku ?? null,
      category_id: tx.categoryId,
      category_name: tx.category?.name ?? null,
      category_type: tx.category?.type ?? null,
      tx_type: tx.txType,
      amount: tx.amount,
      note: tx.note,
      created_by: tx.createdBy,
      created_at: tx.createdAt.toISOString(),
    })),
    meta: {
      page: parsed.data.page,
      per_page: parsed.data.per_page,
      total,
      total_pages: Math.ceil(total / parsed.data.per_page),
    },
  });
});

// POST /api/v1/admin/finance/transactions
adminFinance.post('/transactions', async (c) => {
  const db = getDb();
  const admin = getAdmin(c);
  const schema = z.object({
    order_id: z.string().uuid().optional(),
    product_id: z.string().uuid().optional(),
    category_id: z.string().uuid().optional(),
    tx_type: z.enum([
      'rental_revenue', 'deposit_received', 'deposit_returned', 'deposit_forfeited',
      'late_fee', 'damage_fee', 'force_buy', 'shipping', 'cogs', 'cleaning', 'repair',
      'marketing', 'platform_fee',
    ]),
    amount: z.number().int(),
    note: z.string().optional(),
  });
  const body = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid transaction data', parsed.error.flatten());
  }

  const tx = await db.financeTransaction.create({
    data: {
      orderId: parsed.data.order_id ?? null,
      productId: parsed.data.product_id ?? null,
      categoryId: parsed.data.category_id ?? null,
      txType: parsed.data.tx_type,
      amount: parsed.data.amount,
      note: parsed.data.note ?? null,
      createdBy: admin.sub,
    },
  });

  return success(c, {
    id: tx.id,
    tx_type: tx.txType,
    amount: tx.amount,
    order_id: tx.orderId,
    product_id: tx.productId,
    category_id: tx.categoryId,
  }, undefined, 201);
});

// ─── M01 (existing): GET /api/v1/admin/finance/report ────────────────────

adminFinance.get('/report', async (c) => {
  const db = getDb();

  const schema = z.object({
    year: z.coerce.number().int().min(2024).max(2030),
    month: z.coerce.number().int().min(1).max(12).optional(),
    group_by: z.enum(['category', 'product', 'month']).optional().default('month'),
  });

  const parsed = schema.safeParse({
    year: c.req.query('year'),
    month: c.req.query('month'),
    group_by: c.req.query('group_by'),
  });

  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid report parameters', parsed.error.flatten());
  }

  const { year, month, group_by } = parsed.data;

  const startDate = month
    ? new Date(year, month - 1, 1)
    : new Date(year, 0, 1);
  const endDate = month
    ? new Date(year, month, 0, 23, 59, 59, 999)
    : new Date(year, 11, 31, 23, 59, 59, 999);

  const transactions = await db.financeTransaction.findMany({
    where: {
      createdAt: { gte: startDate, lte: endDate },
    },
    include: {
      order: {
        select: {
          items: {
            select: {
              product: {
                select: { category: true, name: true, sku: true },
              },
              subtotal: true,
            },
          },
          createdAt: true,
        },
      },
    },
  });

  const revenueTypes = ['rental_revenue', 'late_fee', 'damage_fee', 'force_buy', 'deposit_forfeited'];
  const expenseTypes = ['shipping', 'cogs', 'cleaning', 'repair', 'marketing', 'platform_fee'];

  const revenueBreakdown: Record<string, number> = {};
  const expenseBreakdown: Record<string, number> = {};
  let totalRevenue = 0;
  let totalExpenses = 0;

  for (const tx of transactions) {
    if (revenueTypes.includes(tx.txType)) {
      revenueBreakdown[tx.txType] = (revenueBreakdown[tx.txType] ?? 0) + tx.amount;
      totalRevenue += tx.amount;
    } else if (expenseTypes.includes(tx.txType)) {
      expenseBreakdown[tx.txType] = (expenseBreakdown[tx.txType] ?? 0) + Math.abs(tx.amount);
      totalExpenses += Math.abs(tx.amount);
    }
  }

  const grouped: Record<string, { revenue: number; expenses: number; orders: number }> = {};

  if (group_by === 'category') {
    for (const tx of transactions) {
      if (!revenueTypes.includes(tx.txType)) continue;
      const category = tx.order?.items[0]?.product.category ?? 'unknown';
      if (!grouped[category]) grouped[category] = { revenue: 0, expenses: 0, orders: 0 };
      grouped[category].revenue += tx.amount;
    }
    const ordersInRange = await db.order.findMany({
      where: { createdAt: { gte: startDate, lte: endDate } },
      select: {
        items: { select: { product: { select: { category: true } } }, take: 1 },
      },
    });
    for (const o of ordersInRange) {
      const cat = o.items[0]?.product.category ?? 'unknown';
      if (!grouped[cat]) grouped[cat] = { revenue: 0, expenses: 0, orders: 0 };
      grouped[cat].orders++;
    }
  } else if (group_by === 'product') {
    for (const tx of transactions) {
      if (!revenueTypes.includes(tx.txType)) continue;
      const product = tx.order?.items[0]?.product;
      const key = product ? `${product.sku} - ${product.name}` : 'unknown';
      if (!grouped[key]) grouped[key] = { revenue: 0, expenses: 0, orders: 0 };
      grouped[key].revenue += tx.amount;
    }
  } else {
    for (const tx of transactions) {
      if (!revenueTypes.includes(tx.txType) && !expenseTypes.includes(tx.txType)) continue;
      const monthKey = `${tx.createdAt.getFullYear()}-${String(tx.createdAt.getMonth() + 1).padStart(2, '0')}`;
      if (!grouped[monthKey]) grouped[monthKey] = { revenue: 0, expenses: 0, orders: 0 };
      if (revenueTypes.includes(tx.txType)) {
        grouped[monthKey].revenue += tx.amount;
      } else {
        grouped[monthKey].expenses += Math.abs(tx.amount);
      }
    }
    const ordersInRange = await db.order.findMany({
      where: { createdAt: { gte: startDate, lte: endDate } },
      select: { createdAt: true },
    });
    for (const o of ordersInRange) {
      const monthKey = `${o.createdAt.getFullYear()}-${String(o.createdAt.getMonth() + 1).padStart(2, '0')}`;
      if (!grouped[monthKey]) grouped[monthKey] = { revenue: 0, expenses: 0, orders: 0 };
      grouped[monthKey].orders++;
    }
  }

  return success(c, {
    period: {
      year,
      month: month ?? null,
      start: startDate.toISOString().split('T')[0],
      end: endDate.toISOString().split('T')[0],
    },
    summary: {
      total_revenue: totalRevenue,
      total_expenses: totalExpenses,
      gross_margin: totalRevenue - totalExpenses,
      gross_margin_pct: totalRevenue > 0 ? Math.round(((totalRevenue - totalExpenses) / totalRevenue) * 100) : 0,
    },
    revenue_breakdown: revenueBreakdown,
    expense_breakdown: expenseBreakdown,
    grouped_by: group_by,
    groups: Object.entries(grouped).map(([key, val]) => ({
      key,
      ...val,
    })),
  });
});

// ─── M05: Finance Summary Reports ────────────────────────────────────────

// GET /api/v1/admin/finance/summary
adminFinance.get('/summary', async (c) => {
  const db = getDb();
  const schema = z.object({
    period: z.enum(['daily', 'weekly', 'monthly']).default('monthly'),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
  });
  const parsed = schema.safeParse({
    period: c.req.query('period'),
    start_date: c.req.query('start_date'),
    end_date: c.req.query('end_date'),
  });
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid parameters', parsed.error.flatten());
  }

  const now = new Date();
  const startDate = parsed.data.start_date ? new Date(parsed.data.start_date) : new Date(now.getFullYear(), 0, 1);
  const endDate = parsed.data.end_date ? new Date(parsed.data.end_date + 'T23:59:59.999Z') : now;

  const revenueTypes = ['rental_revenue', 'late_fee', 'damage_fee', 'force_buy', 'deposit_forfeited'];
  const expenseTypes = ['shipping', 'cogs', 'cleaning', 'repair', 'marketing', 'platform_fee'];

  const [transactions, orders, categories] = await Promise.all([
    db.financeTransaction.findMany({
      where: { createdAt: { gte: startDate, lte: endDate } },
      include: { category: { select: { name: true, type: true } } },
    }),
    db.order.findMany({
      where: { createdAt: { gte: startDate, lte: endDate } },
      select: { createdAt: true },
    }),
    db.financeCategory.findMany(),
  ]);

  // Aggregate by period
  const periods: Record<string, { revenue: number; expenses: number; orders: number }> = {};

  const getPeriodKey = (date: Date): string => {
    if (parsed.data.period === 'daily') {
      return date.toISOString().split('T')[0];
    } else if (parsed.data.period === 'weekly') {
      const weekStart = new Date(date);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      return `W${weekStart.toISOString().split('T')[0]}`;
    }
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  };

  for (const tx of transactions) {
    const key = getPeriodKey(tx.createdAt);
    if (!periods[key]) periods[key] = { revenue: 0, expenses: 0, orders: 0 };
    if (revenueTypes.includes(tx.txType)) {
      periods[key].revenue += tx.amount;
    } else if (expenseTypes.includes(tx.txType)) {
      periods[key].expenses += Math.abs(tx.amount);
    }
  }

  for (const order of orders) {
    const key = getPeriodKey(order.createdAt);
    if (!periods[key]) periods[key] = { revenue: 0, expenses: 0, orders: 0 };
    periods[key].orders++;
  }

  let totalRevenue = 0;
  let totalExpenses = 0;
  for (const tx of transactions) {
    if (revenueTypes.includes(tx.txType)) totalRevenue += tx.amount;
    else if (expenseTypes.includes(tx.txType)) totalExpenses += Math.abs(tx.amount);
  }

  // By category
  const byCategory: Record<string, { type: string; total: number }> = {};
  for (const tx of transactions) {
    const catName = tx.category?.name ?? tx.txType;
    const catType = tx.category?.type ?? (revenueTypes.includes(tx.txType) ? 'REVENUE' : 'EXPENSE');
    if (!byCategory[catName]) byCategory[catName] = { type: catType, total: 0 };
    byCategory[catName].total += Math.abs(tx.amount);
  }

  // Top products
  const productRevenue: Record<string, { name: string; revenue: number; count: number }> = {};
  const txWithProducts = await db.financeTransaction.findMany({
    where: {
      createdAt: { gte: startDate, lte: endDate },
      txType: { in: revenueTypes.map((t) => t as never) },
    },
    include: {
      order: {
        select: {
          items: {
            select: { productId: true, productName: true },
            take: 1,
          },
        },
      },
    },
  });
  for (const tx of txWithProducts) {
    const item = tx.order?.items[0];
    if (!item) continue;
    if (!productRevenue[item.productId]) {
      productRevenue[item.productId] = { name: item.productName, revenue: 0, count: 0 };
    }
    productRevenue[item.productId].revenue += tx.amount;
    productRevenue[item.productId].count++;
  }

  const topProducts = Object.entries(productRevenue)
    .map(([id, val]) => ({ product_id: id, product_name: val.name, revenue: val.revenue, rental_count: val.count }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  return success(c, {
    periods: Object.entries(periods)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, val]) => ({
        period_label: label,
        total_revenue: val.revenue,
        total_expenses: val.expenses,
        net_profit: val.revenue - val.expenses,
        order_count: val.orders,
      })),
    totals: {
      total_revenue: totalRevenue,
      total_expenses: totalExpenses,
      net_profit: totalRevenue - totalExpenses,
      total_orders: orders.length,
    },
    by_category: Object.entries(byCategory).map(([name, val]) => ({
      category_name: name,
      category_type: val.type,
      total: val.total,
    })),
    top_products: topProducts,
    categories: categories.map((cat) => ({ id: cat.id, name: cat.name, type: cat.type })),
  });
});

// GET /api/v1/admin/finance/summary/export — CSV download
adminFinance.get('/summary/export', async (c) => {
  const db = getDb();
  const schema = z.object({
    period: z.enum(['daily', 'weekly', 'monthly']).default('monthly'),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
  });
  const parsed = schema.safeParse({
    period: c.req.query('period'),
    start_date: c.req.query('start_date'),
    end_date: c.req.query('end_date'),
  });
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid parameters');
  }

  const now = new Date();
  const startDate = parsed.data.start_date ? new Date(parsed.data.start_date) : new Date(now.getFullYear(), 0, 1);
  const endDate = parsed.data.end_date ? new Date(parsed.data.end_date + 'T23:59:59.999Z') : now;

  const transactions = await db.financeTransaction.findMany({
    where: { createdAt: { gte: startDate, lte: endDate } },
    include: {
      order: { select: { orderNumber: true } },
      product: { select: { name: true, sku: true } },
      category: { select: { name: true, type: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const csvRows = [
    'Date,Type,Category,Amount (THB),Order Number,Product,Note',
  ];
  for (const tx of transactions) {
    const date = tx.createdAt.toISOString().split('T')[0];
    const txType = tx.txType;
    const category = tx.category?.name ?? tx.txType;
    const amount = tx.amount;
    const orderNum = tx.order?.orderNumber ?? '';
    const product = tx.product ? `${tx.product.sku} - ${tx.product.name}` : '';
    const note = (tx.note ?? '').replace(/,/g, ';').replace(/\n/g, ' ');
    csvRows.push(`${date},${txType},${category},${amount},${orderNum},${product},${note}`);
  }

  const csv = csvRows.join('\n');
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="finance-report-${parsed.data.period}-${startDate.toISOString().split('T')[0]}-${endDate.toISOString().split('T')[0]}.csv"`,
    },
  });
});

export default adminFinance;
