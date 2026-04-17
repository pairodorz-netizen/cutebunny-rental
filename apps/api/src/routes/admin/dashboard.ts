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
    db.order.count({
      where: { createdAt: { gte: today, lt: tomorrow } },
    }),
    db.order.count({
      where: { status: 'unpaid' },
    }),
    db.order.count({
      where: { status: 'shipped' },
    }),
    db.order.count({
      where: {
        status: 'shipped',
        rentalEndDate: { lt: today },
      },
    }),
    db.financeTransaction.aggregate({
      where: {
        txType: 'rental_revenue',
        createdAt: { gte: firstOfMonth },
      },
      _sum: { amount: true },
    }),
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
    db.product.findMany({
      where: { stockQuantity: { lte: 1 }, available: true },
      select: {
        id: true,
        sku: true,
        name: true,
        stockQuantity: true,
      },
    }),
    db.customer.count(),
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

// M01: GET /api/v1/admin/dashboard/overview
dashboard.get('/overview', async (c) => {
  const db = getDb();

  const [
    totalProducts,
    totalOrders,
    ordersByStatusRaw,
    totalRevenueAgg,
    activeRentals,
    productsAvailable,
    productsRented,
    productsCleaning,
    recentOrders,
  ] = await Promise.all([
    db.product.count(),
    db.order.count(),
    db.order.groupBy({
      by: ['status'],
      _count: { id: true },
    }),
    db.financeTransaction.aggregate({
      where: { txType: { in: ['rental_revenue', 'late_fee', 'damage_fee', 'force_buy'] } },
      _sum: { amount: true },
    }),
    db.order.count({ where: { status: 'shipped' } }),
    db.product.count({ where: { available: true } }),
    db.order.count({ where: { status: 'shipped' } }),
    db.order.count({ where: { status: 'cleaning' } }),
    db.order.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { firstName: true, lastName: true } },
        items: { select: { productName: true }, take: 1 },
      },
    }),
  ]);

  const ordersByStatus: Record<string, number> = {};
  for (const row of ordersByStatusRaw) {
    ordersByStatus[row.status] = row._count.id;
  }

  return success(c, {
    total_products: totalProducts,
    total_orders: totalOrders,
    orders_by_status: ordersByStatus,
    total_revenue: totalRevenueAgg._sum.amount ?? 0,
    total_active_rentals: activeRentals,
    products_available: productsAvailable,
    products_rented: productsRented,
    products_cleaning: productsCleaning,
    recent_orders: recentOrders.map((o) => ({
      id: o.id,
      order_number: o.orderNumber,
      customer_name: `${o.customer.firstName} ${o.customer.lastName}`,
      product_name: o.items[0]?.productName ?? '-',
      status: o.status,
      total_amount: o.totalAmount,
      created_at: o.createdAt.toISOString(),
    })),
  });
});

export default dashboard;
