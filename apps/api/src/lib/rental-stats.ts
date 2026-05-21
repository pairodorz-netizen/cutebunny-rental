/**
 * BUG-526/528: Shared rental-count aggregation helper.
 *
 * Computes actual rental counts per product (and per customer) from
 * order_items joined to orders that have progressed past "unpaid".
 * This replaces the stale `products.rental_count` /
 * `customers.rental_count` / `customers.total_payment` columns
 * that are never incremented in the current codebase.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

// BUG-535: 'ready' was never a valid OrderStatus enum value — it caused
// Prisma to throw a validation error silently caught by try/catch,
// returning empty Maps for all callers.
const PAID_STATUSES = ['paid_locked', 'shipped', 'returned', 'repair', 'finished'];

export interface ProductRentalStat {
  productId: string;
  rentalCount: number;
}

export interface CustomerRentalStat {
  customerId: string;
  rentalCount: number;
  totalPayment: number;
}

export async function getProductRentalCounts(db: Db): Promise<Map<string, number>> {
  try {
    // BUG-535: Use raw SQL to bypass all PrismaNeon adapter issues.
    // Previous attempts with groupBy, findMany on orderItem (nested
    // relation filter), and findMany on Order (nested select) all
    // silently failed on Cloudflare Workers. Raw SQL is proven to
    // work in this codebase (see dashboard.ts lowStockProducts fallback).
    const rows: Array<{ productId: string; count: number }> = await db.$queryRaw`
      SELECT oi.product_id AS "productId", COUNT(*)::int AS "count"
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE o.status IN ('paid_locked', 'shipped', 'returned', 'repair', 'finished')
      GROUP BY oi.product_id
    `;

    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.productId, row.count);
    }
    return map;
  } catch {
    return new Map<string, number>();
  }
}

export async function getCustomerRentalStats(db: Db): Promise<Map<string, CustomerRentalStat>> {
  try {
    // BUG-540: Use raw SQL — PrismaNeon findMany with nested relation
    // (items: { select: { id: true } }) silently fails on Cloudflare Workers,
    // same class of issue as BUG-535 for getProductRentalCounts.
    // Join order-level totals with per-order item counts to avoid
    // Cartesian product inflating SUM(total_amount).
    const rows: Array<{ customerId: string; rentalCount: number; totalPayment: number }> = await db.$queryRaw`
      SELECT
        o.customer_id AS "customerId",
        COALESCE(SUM(ic.cnt), 0)::int AS "rentalCount",
        COALESCE(SUM(o.total_amount), 0)::int AS "totalPayment"
      FROM orders o
      LEFT JOIN (
        SELECT order_id, COUNT(*)::int AS cnt
        FROM order_items
        GROUP BY order_id
      ) ic ON ic.order_id = o.id
      WHERE o.status IN ('paid_locked', 'shipped', 'returned', 'repair', 'finished')
      GROUP BY o.customer_id
    `;

    const map = new Map<string, CustomerRentalStat>();
    for (const row of rows) {
      map.set(row.customerId, row);
    }
    return map;
  } catch {
    return new Map<string, CustomerRentalStat>();
  }
}
