import { Hono } from 'hono';
import { getDb } from '../../lib/db';
import { success } from '../../lib/response';

const CACHE_TTL_MS = 15_000;
const summaryCache: { data: unknown; ts: number } = { data: null, ts: 0 };

async function fetchSummaryData() {
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
    lowStockAlert,
    totalCustomers,
    totalOrders,
    totalProducts,
    ordersByStatusRaw,
    totalRevenueAgg,
    productsAvailable,
    productsCleaning,
    recentOrders,
    lowStockProducts,
  ] = await Promise.all([
    db.order.count({ where: { createdAt: { gte: today, lt: tomorrow } } }),
    db.order.count({ where: { status: 'unpaid' } }),
    db.order.count({ where: { status: 'shipped' } }),
    db.order.count({ where: { status: 'shipped', rentalEndDate: { lt: today } } }),
    db.financeTransaction.aggregate({
      where: { txType: 'rental_revenue', createdAt: { gte: firstOfMonth } },
      _sum: { amount: true },
    }),
    db.product.findMany({
      orderBy: { rentalCount: 'desc' },
      take: 5,
      select: { id: true, sku: true, name: true, rentalCount: true, thumbnailUrl: true },
    }),
    db.product.findMany({
      where: { stockQuantity: { lte: 1 }, available: true },
      select: { id: true, sku: true, name: true, stockQuantity: true },
    }),
    db.customer.count(),
    db.order.count(),
    db.product.count(),
    db.order.groupBy({ by: ['status'], _count: { id: true } }),
    db.financeTransaction.aggregate({
      where: { txType: { in: ['rental_revenue', 'late_fee', 'damage_fee', 'force_buy'] } },
      _sum: { amount: true },
    }),
    db.product.count({ where: { available: true } }),
    db.order.count({ where: { status: 'cleaning' } }),
    db.order.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { firstName: true, lastName: true } },
        items: { select: { productName: true }, take: 1 },
      },
    }),
    db.product.findMany({
      where: { deletedAt: null },
      select: { id: true, sku: true, name: true, thumbnailUrl: true, stockOnHand: true, lowStockThreshold: true },
    }).then((ps) => ps.filter((p) => p.stockOnHand <= p.lowStockThreshold))
      .catch(async () => {
        return await db.$queryRaw`
          SELECT id, sku, name, thumbnail_url as "thumbnailUrl", stock_on_hand as "stockOnHand", low_stock_threshold as "lowStockThreshold"
          FROM products
          WHERE deleted_at IS NULL AND stock_on_hand <= low_stock_threshold
          ORDER BY stock_on_hand ASC
          LIMIT 10
        ` as Array<{ id: string; sku: string; name: string; thumbnailUrl: string | null; stockOnHand: number; lowStockThreshold: number }>;
      }),
  ]);

  const ordersByStatus: Record<string, number> = {};
  for (const row of ordersByStatusRaw) {
    ordersByStatus[row.status] = row._count.id;
  }

  return {
    stats: {
      orders_today: ordersToday,
      orders_pending_payment: ordersPendingPayment,
      orders_shipped: ordersShipped,
      overdue_returns: overdueReturns,
      revenue_this_month: revenueThisMonth._sum.amount ?? 0,
      total_customers: totalCustomers,
      total_orders: totalOrders,
      top_products: topProducts.map((p) => ({
        id: p.id, sku: p.sku, name: p.name,
        rental_count: p.rentalCount, thumbnail: p.thumbnailUrl,
      })),
      low_stock_alert: lowStockAlert.map((p) => ({
        id: p.id, sku: p.sku, name: p.name, stock: p.stockQuantity,
      })),
    },
    overview: {
      total_products: totalProducts,
      total_orders: totalOrders,
      orders_by_status: ordersByStatus,
      total_revenue: totalRevenueAgg._sum.amount ?? 0,
      total_active_rentals: ordersShipped,
      products_available: productsAvailable,
      products_rented: ordersShipped,
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
    },
    lowStock: lowStockProducts.map((p) => ({
      id: p.id, sku: p.sku, name: p.name,
      thumbnail_url: p.thumbnailUrl,
      stock_on_hand: p.stockOnHand,
      low_stock_threshold: p.lowStockThreshold,
    })),
  };
}

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

// C2: GET /api/v1/admin/dashboard/low-stock — Low stock widget
dashboard.get('/low-stock', async (c) => {
  const db = getDb();
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') ?? '10', 10)));

  // Products where stock_on_hand <= lowStockThreshold, not deleted
  const lowStockProducts = await db.product.findMany({
    where: {
      deletedAt: null,
      stockOnHand: { lte: db.product.fields?.lowStockThreshold as unknown as number ?? 5 },
    },
    select: {
      id: true,
      sku: true,
      name: true,
      thumbnailUrl: true,
      stockOnHand: true,
      lowStockThreshold: true,
    },
    orderBy: { stockOnHand: 'asc' },
    take: limit,
  }).catch(async () => {
    // Fallback: use raw comparison since Prisma doesn't support field-to-field comparison easily
    return await db.$queryRaw`
      SELECT id, sku, name, thumbnail_url as "thumbnailUrl", stock_on_hand as "stockOnHand", low_stock_threshold as "lowStockThreshold"
      FROM products
      WHERE deleted_at IS NULL AND stock_on_hand <= low_stock_threshold
      ORDER BY stock_on_hand ASC
      LIMIT ${limit}
    ` as Array<{ id: string; sku: string; name: string; thumbnailUrl: string | null; stockOnHand: number; lowStockThreshold: number }>;
  });

  return success(c, lowStockProducts.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    thumbnail_url: p.thumbnailUrl,
    stock_on_hand: p.stockOnHand,
    low_stock_threshold: p.lowStockThreshold,
  })));
});

// BUG-504: GET /api/v1/admin/dashboard/summary — single endpoint returning all dashboard data
dashboard.get('/summary', async (c) => {
  const now = Date.now();
  if (summaryCache.data && now - summaryCache.ts < CACHE_TTL_MS) {
    return success(c, summaryCache.data);
  }
  const data = await fetchSummaryData();
  summaryCache.data = data;
  summaryCache.ts = Date.now();
  return success(c, data);
});

// C3: POST /api/v1/admin/dashboard/low-stock-digest — Email digest scaffold (no-op handler)
dashboard.post('/low-stock-digest', async (c) => {
  const db = getDb();

  // Scaffold: find low-stock products, but don't actually send email
  const lowStockProducts = await db.product.findMany({
    where: {
      deletedAt: null,
    },
    select: {
      id: true,
      sku: true,
      name: true,
      stockOnHand: true,
      lowStockThreshold: true,
    },
  }).catch(() => []);

  const belowThreshold = lowStockProducts.filter(
    (p) => p.stockOnHand <= p.lowStockThreshold
  );

  // No-op: log what would be sent
  const digestPayload = {
    generated_at: new Date().toISOString(),
    total_low_stock: belowThreshold.length,
    products: belowThreshold.map((p) => ({
      sku: p.sku,
      name: p.name,
      stock_on_hand: p.stockOnHand,
      threshold: p.lowStockThreshold,
    })),
    email_sent: false, // scaffold — no actual email integration yet
    message: 'Email digest scaffold — no email provider configured',
  };

  return success(c, digestPayload);
});

export default dashboard;
