import { Hono } from 'hono';
import { getDb } from '../../lib/db';
import { success } from '../../lib/response';

const dashboard = new Hono();

// A-DASH: GET /api/v1/admin/dashboard/stats
dashboard.get('/stats', async (c) => {
  const db = getDb();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const [
    ordersToday,
    ordersPendingPayment,
    ordersShipped,
    overdueReturns,
    revenueThisMonth,
    topProducts,
    lowStockProducts,
    totalCustomers,
    totalOrders,
  ] = await Promise.all([
    // Orders created today
    db.order.count({
      where: { createdAt: { gte: today, lt: tomorrow } },
    }),
    // Orders pending payment
    db.order.count({
      where: { status: 'unpaid' },
    }),
    // Orders currently shipped (in transit)
    db.order.count({
      where: { status: 'shipped' },
    }),
    // Overdue returns (shipped, rental end date passed)
    db.order.count({
      where: {
        status: 'shipped',
        rentalEndDate: { lt: today },
      },
    }),
    // Revenue this month
    db.financeTransaction.aggregate({
      where: {
        txType: 'rental_revenue',
        createdAt: { gte: firstOfMonth },
      },
      _sum: { amount: true },
    }),
    // Top products by rental count
    db.product.findMany({
      orderBy: { rentalCount: 'desc' },
      take: 5,
      select: {
        id: true,
        sku: true,
        name: true,
        rentalCount: true,
        thumbnailUrl: true,
      },
    }),
    // Low stock alert (stock <= 1)
    db.product.findMany({
      where: { stockQuantity: { lte: 1 }, available: true },
      select: {
        id: true,
        sku: true,
        name: true,
        stockQuantity: true,
      },
    }),
    // Total customers
    db.customer.count(),
    // Total orders
    db.order.count(),
  ]);

  return success(c, {
    orders_today: ordersToday,
    orders_pending_payment: ordersPendingPayment,
    orders_shipped: ordersShipped,
    overdue_returns: overdueReturns,
    revenue_this_month: revenueThisMonth._sum.amount ?? 0,
    total_customers: totalCustomers,
    total_orders: totalOrders,
    top_products: topProducts.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      rental_count: p.rentalCount,
      thumbnail: p.thumbnailUrl,
    })),
    low_stock_alert: lowStockProducts.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      stock: p.stockQuantity,
    })),
  });
});

export default dashboard;
