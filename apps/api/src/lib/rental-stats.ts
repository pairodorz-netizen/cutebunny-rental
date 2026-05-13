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

const PAID_STATUSES = ['paid_locked', 'shipped', 'returned', 'cleaning', 'repair', 'ready', 'finished'];

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
    // BUG-534: Query from Order model (top-level where) instead of OrderItem
    // with nested relation filter. PrismaNeon adapter on Cloudflare Workers
    // silently fails on any nested relation filter (both groupBy and findMany
    // on orderItem with `where: { order: { status: ... } }`).
    // This pattern matches getCustomerRentalStats() which works on prod.
    const orders = await db.order.findMany({
      where: { status: { in: PAID_STATUSES } },
      select: { items: { select: { productId: true } } },
    });

    const map = new Map<string, number>();
    for (const order of orders) {
      for (const item of order.items) {
        map.set(item.productId, (map.get(item.productId) ?? 0) + 1);
      }
    }
    return map;
  } catch {
    return new Map<string, number>();
  }
}

export async function getCustomerRentalStats(db: Db): Promise<Map<string, CustomerRentalStat>> {
  try {
    const orders = await db.order.findMany({
      where: { status: { in: PAID_STATUSES } },
      select: {
        customerId: true,
        totalAmount: true,
        items: { select: { id: true } },
      },
    });

    const map = new Map<string, CustomerRentalStat>();
    for (const o of orders) {
      const existing = map.get(o.customerId) ?? { customerId: o.customerId, rentalCount: 0, totalPayment: 0 };
      existing.rentalCount += o.items.length;
      existing.totalPayment += o.totalAmount;
      map.set(o.customerId, existing);
    }
    return map;
  } catch {
    return new Map<string, CustomerRentalStat>();
  }
}
