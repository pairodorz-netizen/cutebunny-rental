import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../lib/db';
import { success, error } from '../../lib/response';

const adminFinance = new Hono();

// M01: GET /api/v1/admin/finance/report
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

  // Build date range
  const startDate = month
    ? new Date(year, month - 1, 1)
    : new Date(year, 0, 1);
  const endDate = month
    ? new Date(year, month, 0, 23, 59, 59, 999)
    : new Date(year, 11, 31, 23, 59, 59, 999);

  // Get all finance transactions in range
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

  // Revenue types
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

  // Group by logic
  const grouped: Record<string, { revenue: number; expenses: number; orders: number }> = {};

  if (group_by === 'category') {
    for (const tx of transactions) {
      if (!revenueTypes.includes(tx.txType)) continue;
      const category = tx.order?.items[0]?.product.category ?? 'unknown';
      if (!grouped[category]) grouped[category] = { revenue: 0, expenses: 0, orders: 0 };
      grouped[category].revenue += tx.amount;
    }
    // Count orders per category
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
    // group by month
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
    // Count orders per month
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

export default adminFinance;
