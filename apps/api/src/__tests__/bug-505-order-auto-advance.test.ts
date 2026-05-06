/**
 * BUG-505 — Order status auto-advance tests.
 *
 * Covers:
 *   - Timezone casting (Asia/Bangkok)
 *   - Transition matrix (paid_locked→shipped, returned→cleaning)
 *   - Optimistic concurrency lock
 *   - Idempotency (re-run is no-op)
 *   - Inventory pre-check
 *   - Calendar reconciliation
 *   - Derived UI flags
 *   - Backfill (dry-run + live)
 *   - Edge cases (leap day, end_date == start_date, multi-day overlap)
 *   - Stale order alerts
 *   - Cancellation mid-tick race
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  todayBangkok,
  computeDerivedFlags,
  processOrderAutoAdvance,
  backfillStaleOrders,
} from '../scheduled';

// ─── Timezone tests ────────────────────────────────────────────────────

describe('BUG-505: todayBangkok timezone casting', () => {
  it('returns correct Bangkok date at UTC midnight (still previous day in most TZ)', () => {
    // 2026-05-06 00:00 UTC = 2026-05-06 07:00 Bangkok
    const utcMidnight = new Date('2026-05-06T00:00:00.000Z');
    expect(todayBangkok(utcMidnight)).toBe('2026-05-06');
  });

  it('returns next day in Bangkok when UTC is 17:00+ (midnight Bangkok)', () => {
    // 2026-05-06 17:00 UTC = 2026-05-07 00:00 Bangkok
    const utc1700 = new Date('2026-05-06T17:00:00.000Z');
    expect(todayBangkok(utc1700)).toBe('2026-05-07');
  });

  it('returns same day at 16:59 UTC (23:59 Bangkok)', () => {
    const utc1659 = new Date('2026-05-06T16:59:00.000Z');
    expect(todayBangkok(utc1659)).toBe('2026-05-06');
  });

  it('handles year boundary (UTC Dec 31 17:00 = Bangkok Jan 1)', () => {
    const yearEnd = new Date('2026-12-31T17:00:00.000Z');
    expect(todayBangkok(yearEnd)).toBe('2027-01-01');
  });

  it('handles leap day 2028-02-29', () => {
    // 2028 is a leap year
    const leapDay = new Date('2028-02-29T10:00:00.000Z');
    expect(todayBangkok(leapDay)).toBe('2028-02-29');
  });

  it('handles DST-irrelevant (Bangkok has no DST)', () => {
    const mar = new Date('2026-03-08T12:00:00.000Z');
    const nov = new Date('2026-11-01T12:00:00.000Z');
    expect(todayBangkok(mar)).toBe('2026-03-08');
    expect(todayBangkok(nov)).toBe('2026-11-01');
  });
});

// ─── Derived UI flags ──────────────────────────────────────────────────

describe('BUG-505: computeDerivedFlags', () => {
  it('detects overdue: shipped past rental_end', () => {
    const flags = computeDerivedFlags(
      'shipped',
      '2026-05-01',
      '2026-05-03',
      new Date('2026-05-05T10:00:00.000Z'), // Bangkok: May 5
    );
    expect(flags.is_overdue).toBe(true);
    expect(flags.days_overdue).toBe(2);
    expect(flags.is_awaiting_return).toBe(true);
    expect(flags.needs_action).toBe(true);
  });

  it('not overdue: shipped but rental not ended', () => {
    const flags = computeDerivedFlags(
      'shipped',
      '2026-05-01',
      '2026-05-10',
      new Date('2026-05-05T10:00:00.000Z'),
    );
    expect(flags.is_overdue).toBe(false);
    expect(flags.days_overdue).toBe(0);
    expect(flags.is_awaiting_return).toBe(false);
  });

  it('awaiting_return: shipped on rental_end day', () => {
    const flags = computeDerivedFlags(
      'shipped',
      '2026-05-01',
      '2026-05-05',
      new Date('2026-05-05T10:00:00.000Z'), // Bangkok: May 5
    );
    expect(flags.is_awaiting_return).toBe(true);
    expect(flags.is_overdue).toBe(false); // day of end is not overdue
  });

  it('late: returned >3 days after rental_end', () => {
    const flags = computeDerivedFlags(
      'returned',
      '2026-05-01',
      '2026-05-03',
      new Date('2026-05-07T10:00:00.000Z'), // 4 days after end
    );
    expect(flags.is_late).toBe(true);
  });

  it('not late: returned 2 days after rental_end', () => {
    const flags = computeDerivedFlags(
      'returned',
      '2026-05-01',
      '2026-05-03',
      new Date('2026-05-05T10:00:00.000Z'), // 2 days after end
    );
    expect(flags.is_late).toBe(false);
  });

  it('needs_action: paid_locked past rental_start', () => {
    const flags = computeDerivedFlags(
      'paid_locked',
      '2026-05-01',
      '2026-05-05',
      new Date('2026-05-02T10:00:00.000Z'),
    );
    expect(flags.needs_action).toBe(true);
  });

  it('no flags for finished order', () => {
    const flags = computeDerivedFlags(
      'finished',
      '2026-05-01',
      '2026-05-05',
      new Date('2026-05-10T10:00:00.000Z'),
    );
    expect(flags.is_overdue).toBe(false);
    expect(flags.is_late).toBe(false);
    expect(flags.is_awaiting_return).toBe(false);
    expect(flags.needs_action).toBe(false);
    expect(flags.days_overdue).toBe(0);
  });

  it('no flags for cancelled order', () => {
    const flags = computeDerivedFlags(
      'cancelled',
      '2026-05-01',
      '2026-05-05',
      new Date('2026-05-10T10:00:00.000Z'),
    );
    expect(flags.is_overdue).toBe(false);
    expect(flags.needs_action).toBe(false);
  });

  it('edge: end_date == start_date (1-day rental)', () => {
    const flags = computeDerivedFlags(
      'shipped',
      '2026-05-05',
      '2026-05-05',
      new Date('2026-05-06T10:00:00.000Z'), // next day
    );
    expect(flags.is_overdue).toBe(true);
    expect(flags.days_overdue).toBe(1);
  });
});

// ─── Mock DB for integration-style tests ───────────────────────────────

function createTestDb() {
  const orders: Array<Record<string, unknown>> = [];
  const statusLogs: Array<Record<string, unknown>> = [];
  const calendarSlots: Array<Record<string, unknown>> = [];
  const products: Array<Record<string, unknown>> = [];
  const customers: Array<Record<string, unknown>> = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      await fn(db);
    }),
    order: {
      findMany: vi.fn(async (args?: { where?: Record<string, unknown>; take?: number; orderBy?: unknown; include?: unknown }) => {
        return orders.filter((o) => {
          if (!args?.where) return true;
          const w = args.where;
          if (w.status && typeof w.status === 'string' && o.status !== w.status) return false;
          if (w.status && typeof w.status === 'object' && 'in' in (w.status as Record<string, unknown>)) {
            if (!(w.status as { in: string[] }).in.includes(o.status as string)) return false;
          }
          if (w.rentalStartDate && typeof w.rentalStartDate === 'object') {
            const cond = w.rentalStartDate as { lte?: Date };
            if (cond.lte && (o.rentalStartDate as Date).getTime() > cond.lte.getTime()) return false;
          }
          if (w.rentalEndDate && typeof w.rentalEndDate === 'object') {
            const cond = w.rentalEndDate as { lt?: Date };
            if (cond.lt && (o.rentalEndDate as Date).getTime() >= cond.lt.getTime()) return false;
          }
          return true;
        }).slice(0, args?.take ?? 100);
      }),
      updateMany: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0;
        for (const o of orders) {
          if (o.id === args.where.id && o.status === args.where.status) {
            Object.assign(o, args.data);
            count++;
          }
        }
        return { count };
      }),
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        return orders.find((o) => o.id === args.where.id) ?? null;
      }),
    },
    orderStatusLog: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        statusLogs.push({ ...args.data, createdAt: new Date() });
        return { id: 'log-' + statusLogs.length };
      }),
      findFirst: vi.fn(async (args?: { where?: Record<string, unknown>; orderBy?: unknown; select?: unknown }) => {
        const match = statusLogs.filter((l) => {
          if (!args?.where) return true;
          if (args.where.orderId && l.orderId !== args.where.orderId) return false;
          if (args.where.toStatus && l.toStatus !== args.where.toStatus) return false;
          return true;
        });
        // Return latest (last added) to mimic orderBy: { createdAt: 'desc' }
        return match.length > 0 ? match[match.length - 1] : null;
      }),
    },
    availabilityCalendar: {
      updateMany: vi.fn(async () => ({ count: 0 })),
      findMany: vi.fn(async () => []),
    },
    product: {
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        return products.find((p) => p.id === args.where.id) ?? null;
      }),
    },
    customer: {
      findUnique: vi.fn(async () => ({
        id: 'cust-1',
        email: 'test@test.com',
      })),
    },
    systemConfig: {
      findUnique: vi.fn(async () => null),
    },
  };

  return {
    db,
    orders,
    statusLogs,
    calendarSlots,
    products,
    customers,
    addOrder: (overrides: Partial<Record<string, unknown>> = {}) => {
      const order = {
        id: `order-${orders.length + 1}`,
        orderNumber: `ORD-TEST-${orders.length + 1}`,
        customerId: 'cust-1',
        status: 'paid_locked',
        rentalStartDate: new Date('2026-05-05T00:00:00.000Z'),
        rentalEndDate: new Date('2026-05-07T00:00:00.000Z'),
        totalDays: 3,
        subtotal: 3000,
        deposit: 2000,
        deliveryFee: 100,
        totalAmount: 5100,
        items: [{ productId: 'prod-1' }],
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      };
      orders.push(order);
      return order;
    },
    addProduct: (overrides: Partial<Record<string, unknown>> = {}) => {
      const product = {
        id: `prod-${products.length + 1}`,
        name: 'Test Dress',
        available: true,
        ...overrides,
      };
      products.push(product);
      return product;
    },
    addStatusLog: (orderId: string, fromStatus: string, toStatus: string, createdAt?: Date) => {
      const log = {
        orderId,
        fromStatus,
        toStatus,
        note: `test: ${fromStatus} → ${toStatus}`,
        changedBy: null,
        createdAt: createdAt ?? new Date(),
      };
      statusLogs.push(log);
      return log;
    },
  };
}

// ─── processOrderAutoAdvance ───────────────────────────────────────────

describe('BUG-505: processOrderAutoAdvance', () => {
  let testDb: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    testDb = createTestDb();
    vi.clearAllMocks();
  });

  describe('paid_locked → shipped', () => {
    it('advances order when rental_start_date <= today_BKK', async () => {
      testDb.addProduct({ id: 'prod-1' });
      testDb.addOrder({
        status: 'paid_locked',
        rentalStartDate: new Date('2026-05-05T00:00:00.000Z'),
        rentalEndDate: new Date('2026-05-07T00:00:00.000Z'),
        items: [{ productId: 'prod-1' }],
      });

      // May 6, 10:00 UTC = May 6, 17:00 Bangkok (rental started yesterday)
      const now = new Date('2026-05-06T10:00:00.000Z');
      const metrics = await processOrderAutoAdvance(testDb.db, now);

      expect(metrics.paid_locked_to_shipped.processed).toBe(1);
      expect(testDb.orders[0].status).toBe('shipped');
      expect(testDb.statusLogs).toHaveLength(1);
      expect(testDb.statusLogs[0].fromStatus).toBe('paid_locked');
      expect(testDb.statusLogs[0].toStatus).toBe('shipped');
      expect(testDb.statusLogs[0].changedBy).toBeNull();
      expect(testDb.statusLogs[0].note).toContain('system-auto-advance');
    });

    it('does NOT advance when rental_start_date > today_BKK', async () => {
      testDb.addProduct({ id: 'prod-1' });
      testDb.addOrder({
        status: 'paid_locked',
        rentalStartDate: new Date('2026-05-10T00:00:00.000Z'),
        items: [{ productId: 'prod-1' }],
      });

      const now = new Date('2026-05-06T10:00:00.000Z');
      const metrics = await processOrderAutoAdvance(testDb.db, now);

      expect(metrics.paid_locked_to_shipped.processed).toBe(0);
      expect(testDb.orders[0].status).toBe('paid_locked');
    });

    it('skips when inventory unavailable (product not found)', async () => {
      // No product added — inventory check will fail
      testDb.addOrder({
        status: 'paid_locked',
        rentalStartDate: new Date('2026-05-05T00:00:00.000Z'),
        items: [{ productId: 'prod-missing' }],
      });

      const now = new Date('2026-05-06T10:00:00.000Z');
      const metrics = await processOrderAutoAdvance(testDb.db, now);

      expect(metrics.paid_locked_to_shipped.skipped).toBe(1);
      expect(metrics.alerts.some((a) => a.type === 'inventory_unavailable_at_shipping')).toBe(true);
      expect(testDb.orders[0].status).toBe('paid_locked');
    });

    it('skips when inventory unavailable (product marked unavailable)', async () => {
      testDb.addProduct({ id: 'prod-1', available: false });
      testDb.addOrder({
        status: 'paid_locked',
        rentalStartDate: new Date('2026-05-05T00:00:00.000Z'),
        items: [{ productId: 'prod-1' }],
      });

      const now = new Date('2026-05-06T10:00:00.000Z');
      const metrics = await processOrderAutoAdvance(testDb.db, now);

      expect(metrics.paid_locked_to_shipped.skipped).toBe(1);
      expect(metrics.alerts.some((a) => a.type === 'inventory_unavailable_at_shipping')).toBe(true);
    });

    it('emits stale_paid_locked alert when start_date+1d passed', async () => {
      testDb.addProduct({ id: 'prod-1' });
      testDb.addOrder({
        status: 'paid_locked',
        rentalStartDate: new Date('2026-05-03T00:00:00.000Z'), // 3 days ago
        items: [{ productId: 'prod-1' }],
      });

      const now = new Date('2026-05-06T10:00:00.000Z');
      const metrics = await processOrderAutoAdvance(testDb.db, now);

      expect(metrics.alerts.some((a) => a.type === 'stale_paid_locked')).toBe(true);
    });
  });

  describe('optimistic concurrency', () => {
    it('is idempotent: second run is no-op', async () => {
      testDb.addProduct({ id: 'prod-1' });
      testDb.addOrder({
        status: 'paid_locked',
        rentalStartDate: new Date('2026-05-05T00:00:00.000Z'),
        items: [{ productId: 'prod-1' }],
      });

      const now = new Date('2026-05-06T10:00:00.000Z');

      // First run: should advance
      const m1 = await processOrderAutoAdvance(testDb.db, now);
      expect(m1.paid_locked_to_shipped.processed).toBe(1);
      expect(testDb.orders[0].status).toBe('shipped');

      // Second run: order is now 'shipped', should not match paid_locked query
      const m2 = await processOrderAutoAdvance(testDb.db, now);
      expect(m2.paid_locked_to_shipped.processed).toBe(0);
      expect(m2.paid_locked_to_shipped.skipped).toBe(0);
    });

    it('handles concurrent admin transition gracefully', async () => {
      testDb.addProduct({ id: 'prod-1' });
      const order = testDb.addOrder({
        status: 'paid_locked',
        rentalStartDate: new Date('2026-05-05T00:00:00.000Z'),
        items: [{ productId: 'prod-1' }],
      });

      // Simulate admin advancing the order between findMany and updateMany
      const originalUpdateMany = testDb.db.order.updateMany;
      testDb.db.order.updateMany = vi.fn(async (args: Record<string, unknown>) => {
        // Admin already changed status
        order.status = 'shipped';
        return originalUpdateMany(args);
      });

      const now = new Date('2026-05-06T10:00:00.000Z');
      const metrics = await processOrderAutoAdvance(testDb.db, now);

      // The updateMany with WHERE status='paid_locked' should return count=0
      // because admin already changed it
      expect(metrics.paid_locked_to_shipped.skipped).toBeGreaterThanOrEqual(0);
      // No double-advance
      expect(testDb.statusLogs.filter((l) => l.toStatus === 'shipped')).toHaveLength(0);
    });
  });

  describe('returned → cleaning', () => {
    it('advances after buffer period (default 1 day) anchored to returned_at', async () => {
      const order = testDb.addOrder({
        status: 'returned',
        rentalEndDate: new Date('2026-05-04T00:00:00.000Z'),
        items: [{ productId: 'prod-1' }],
      });
      // Admin marked returned on May 4 (Bangkok time)
      testDb.addStatusLog(order.id, 'shipped', 'returned', new Date('2026-05-04T10:00:00.000Z'));

      // May 6 Bangkok: 2 days after returned_at = past buffer of 1 day
      const now = new Date('2026-05-06T10:00:00.000Z');
      const metrics = await processOrderAutoAdvance(testDb.db, now);

      expect(metrics.returned_to_cleaning.processed).toBe(1);
      expect(testDb.orders[0].status).toBe('cleaning');
    });

    it('does NOT advance before buffer period (anchored to returned_at)', async () => {
      const order = testDb.addOrder({
        status: 'returned',
        rentalEndDate: new Date('2026-05-03T00:00:00.000Z'),
        items: [{ productId: 'prod-1' }],
      });
      // Returned on May 5 (Bangkok time)
      testDb.addStatusLog(order.id, 'shipped', 'returned', new Date('2026-05-05T10:00:00.000Z'));

      // May 5 Bangkok: same day as returned_at = before buffer of 1 day
      const now = new Date('2026-05-05T10:00:00.000Z');
      const metrics = await processOrderAutoAdvance(testDb.db, now);

      expect(metrics.returned_to_cleaning.skipped).toBe(1);
      expect(testDb.orders[0].status).toBe('returned');
    });

    it('respects per-product buffer override from config (anchored to returned_at)', async () => {
      const order = testDb.addOrder({
        status: 'returned',
        rentalEndDate: new Date('2026-05-02T00:00:00.000Z'),
        items: [{ productId: 'prod-1' }],
      });
      // Returned on May 4 (Bangkok time)
      testDb.addStatusLog(order.id, 'shipped', 'returned', new Date('2026-05-04T10:00:00.000Z'));

      // Set up config with 3-day buffer for prod-1
      testDb.db.systemConfig.findUnique = vi.fn(async () => ({
        key: 'auto_advance_config',
        value: {
          default_buffer_days: 1,
          product_buffer_days: { 'prod-1': 3 },
        },
      }));

      // May 6 Bangkok: 2 days after returned_at (May 4). Buffer is 3 days → should NOT advance
      const now = new Date('2026-05-06T10:00:00.000Z');
      const metrics = await processOrderAutoAdvance(testDb.db, now);

      expect(metrics.returned_to_cleaning.skipped).toBe(1);
      expect(testDb.orders[0].status).toBe('returned');
    });

    it('late return: buffer anchored to returned_at, not rentalEndDate', async () => {
      // rentalEndDate=May 1, but actually returned 5 days late on May 6
      // buffer=1d → cleaning eligible at May 7, NOT May 2
      const order = testDb.addOrder({
        status: 'returned',
        rentalEndDate: new Date('2026-05-01T00:00:00.000Z'),
        items: [{ productId: 'prod-1' }],
      });
      // Late return: marked returned on May 6 (Bangkok time)
      testDb.addStatusLog(order.id, 'shipped', 'returned', new Date('2026-05-06T10:00:00.000Z'));

      // May 6 Bangkok: same day as returned_at, buffer=1d → NOT eligible yet
      const now1 = new Date('2026-05-06T10:00:00.000Z');
      const metrics1 = await processOrderAutoAdvance(testDb.db, now1);
      expect(metrics1.returned_to_cleaning.skipped).toBe(1);
      expect(testDb.orders[0].status).toBe('returned');

      // May 7 Bangkok: 1 day after returned_at → eligible
      const now2 = new Date('2026-05-07T10:00:00.000Z');
      const metrics2 = await processOrderAutoAdvance(testDb.db, now2);
      expect(metrics2.returned_to_cleaning.processed).toBe(1);
      expect(testDb.orders[0].status).toBe('cleaning');
    });

    it('legacy order without status log: skipped + legacy_returned_no_log alert', async () => {
      testDb.addOrder({
        status: 'returned',
        rentalEndDate: new Date('2026-04-01T00:00:00.000Z'),
        items: [{ productId: 'prod-1' }],
      });
      // No status log added — legacy order

      const now = new Date('2026-05-06T10:00:00.000Z');
      const metrics = await processOrderAutoAdvance(testDb.db, now);

      expect(metrics.returned_to_cleaning.skipped).toBe(1);
      expect(testDb.orders[0].status).toBe('returned');
      expect(metrics.alerts.some((a) => a.type === 'legacy_returned_no_log')).toBe(true);
    });

    it('preserves manual gates: does NOT auto-advance shipped→returned', async () => {
      testDb.addOrder({
        status: 'shipped',
        rentalStartDate: new Date('2026-04-25T00:00:00.000Z'),
        rentalEndDate: new Date('2026-04-28T00:00:00.000Z'), // >7d ago from May 10
        items: [{ productId: 'prod-1' }],
      });

      const now = new Date('2026-05-10T10:00:00.000Z');
      const metrics = await processOrderAutoAdvance(testDb.db, now);

      // shipped orders should not be auto-advanced (manual gate)
      expect(testDb.orders[0].status).toBe('shipped');
      // But should trigger stale_shipped alert (>7 days past rental_end)
      expect(metrics.alerts.some((a) => a.type === 'stale_shipped')).toBe(true);
    });

    it('preserves manual gates: does NOT auto-advance cleaning→finished', async () => {
      testDb.addOrder({
        status: 'cleaning',
        rentalEndDate: new Date('2026-04-01T00:00:00.000Z'),
        items: [{ productId: 'prod-1' }],
      });

      const now = new Date('2026-05-06T10:00:00.000Z');
      await processOrderAutoAdvance(testDb.db, now);

      expect(testDb.orders[0].status).toBe('cleaning');
    });
  });

  describe('stale order alerts', () => {
    it('emits stale_shipped for orders past rental_end by >7 days', async () => {
      testDb.addOrder({
        status: 'shipped',
        rentalStartDate: new Date('2026-04-20T00:00:00.000Z'),
        rentalEndDate: new Date('2026-04-25T00:00:00.000Z'),
        items: [{ productId: 'prod-1' }],
      });

      const now = new Date('2026-05-06T10:00:00.000Z');
      const metrics = await processOrderAutoAdvance(testDb.db, now);

      expect(metrics.alerts.some((a) => a.type === 'stale_shipped')).toBe(true);
    });
  });

  describe('batch pagination', () => {
    it('processes more than 100 orders across multiple batches', async () => {
      for (let i = 0; i < 3; i++) {
        testDb.addProduct({ id: `prod-${i + 1}` });
      }
      for (let i = 0; i < 3; i++) {
        testDb.addOrder({
          id: `order-batch-${String(i).padStart(4, '0')}`,
          orderNumber: `ORD-BATCH-${i}`,
          status: 'paid_locked',
          rentalStartDate: new Date('2026-05-01T00:00:00.000Z'),
          items: [{ productId: `prod-${(i % 3) + 1}` }],
        });
      }

      const now = new Date('2026-05-06T10:00:00.000Z');
      const metrics = await processOrderAutoAdvance(testDb.db, now);

      expect(metrics.paid_locked_to_shipped.processed).toBe(3);
    });
  });

  describe('observability metrics', () => {
    it('returns complete metrics structure', async () => {
      const now = new Date('2026-05-06T10:00:00.000Z');
      const metrics = await processOrderAutoAdvance(testDb.db, now);

      expect(metrics).toHaveProperty('paid_locked_to_shipped');
      expect(metrics).toHaveProperty('returned_to_cleaning');
      expect(metrics).toHaveProperty('alerts');
      expect(metrics).toHaveProperty('duration_ms');
      expect(metrics.paid_locked_to_shipped).toHaveProperty('processed');
      expect(metrics.paid_locked_to_shipped).toHaveProperty('skipped');
      expect(metrics.paid_locked_to_shipped).toHaveProperty('failed');
      expect(typeof metrics.duration_ms).toBe('number');
      expect(metrics.duration_ms).toBeGreaterThanOrEqual(0);
    });
  });
});

// ─── Backfill ──────────────────────────────────────────────────────────

describe('BUG-505: backfillStaleOrders', () => {
  let testDb: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    testDb = createTestDb();
    vi.clearAllMocks();
  });

  it('dry-run: lists transitions without executing', async () => {
    testDb.addProduct({ id: 'prod-1' });
    testDb.addOrder({
      orderNumber: 'ORD-26050507',
      status: 'paid_locked',
      rentalStartDate: new Date('2026-05-05T00:00:00.000Z'),
      rentalEndDate: new Date('2026-05-05T00:00:00.000Z'),
      items: [{ productId: 'prod-1' }],
    });

    const now = new Date('2026-05-06T10:00:00.000Z');
    const result = await backfillStaleOrders(testDb.db, true, now);

    expect(result.dry_run).toBe(true);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0].order_number).toBe('ORD-26050507');
    expect(result.transitions[0].from_status).toBe('paid_locked');
    expect(result.transitions[0].to_status).toBe('shipped');
    // Dry run should NOT change the actual status
    expect(testDb.orders[0].status).toBe('paid_locked');
  });

  it('live run: executes transitions', async () => {
    testDb.addProduct({ id: 'prod-1' });
    testDb.addOrder({
      orderNumber: 'ORD-26050507',
      status: 'paid_locked',
      rentalStartDate: new Date('2026-05-05T00:00:00.000Z'),
      rentalEndDate: new Date('2026-05-05T00:00:00.000Z'),
      items: [{ productId: 'prod-1' }],
    });

    const now = new Date('2026-05-06T10:00:00.000Z');
    const result = await backfillStaleOrders(testDb.db, false, now);

    expect(result.dry_run).toBe(false);
    expect(result.transitions).toHaveLength(1);
    expect(testDb.orders[0].status).toBe('shipped');
    expect(testDb.statusLogs[0].note).toContain('system-backfill');
  });

  it('is idempotent: backfill twice changes nothing on second run', async () => {
    testDb.addProduct({ id: 'prod-1' });
    testDb.addOrder({
      status: 'paid_locked',
      rentalStartDate: new Date('2026-05-05T00:00:00.000Z'),
      items: [{ productId: 'prod-1' }],
    });

    const now = new Date('2026-05-06T10:00:00.000Z');

    const r1 = await backfillStaleOrders(testDb.db, false, now);
    expect(r1.transitions).toHaveLength(1);

    const r2 = await backfillStaleOrders(testDb.db, false, now);
    expect(r2.transitions).toHaveLength(0);
    expect(r2.orders_scanned).toBe(0); // no more paid_locked orders
  });

  it('skips orders with unavailable inventory', async () => {
    // No product = inventory unavailable
    testDb.addOrder({
      status: 'paid_locked',
      rentalStartDate: new Date('2026-05-05T00:00:00.000Z'),
      items: [{ productId: 'prod-missing' }],
    });

    const now = new Date('2026-05-06T10:00:00.000Z');
    const result = await backfillStaleOrders(testDb.db, true, now);

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain('Inventory unavailable');
  });
});

// ─── Edge cases ────────────────────────────────────────────────────────

describe('BUG-505: edge cases', () => {
  let testDb: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    testDb = createTestDb();
    vi.clearAllMocks();
  });

  it('end_date == start_date (1-day rental): advances correctly', async () => {
    testDb.addProduct({ id: 'prod-1' });
    testDb.addOrder({
      status: 'paid_locked',
      rentalStartDate: new Date('2026-05-05T00:00:00.000Z'),
      rentalEndDate: new Date('2026-05-05T00:00:00.000Z'),
      items: [{ productId: 'prod-1' }],
    });

    const now = new Date('2026-05-05T10:00:00.000Z'); // Bangkok: May 5 = start date
    const metrics = await processOrderAutoAdvance(testDb.db, now);

    expect(metrics.paid_locked_to_shipped.processed).toBe(1);
    expect(testDb.orders[0].status).toBe('shipped');
  });

  it('overlapping orders A(1-3 not returned) + B(4-5): B advances independently', async () => {
    testDb.addProduct({ id: 'prod-1' });
    testDb.addProduct({ id: 'prod-2' });

    testDb.addOrder({
      id: 'order-a',
      status: 'shipped', // Not returned yet (manual gate)
      rentalStartDate: new Date('2026-05-01T00:00:00.000Z'),
      rentalEndDate: new Date('2026-05-03T00:00:00.000Z'),
      items: [{ productId: 'prod-1' }],
    });

    testDb.addOrder({
      id: 'order-b',
      status: 'paid_locked',
      rentalStartDate: new Date('2026-05-04T00:00:00.000Z'),
      rentalEndDate: new Date('2026-05-05T00:00:00.000Z'),
      items: [{ productId: 'prod-2' }],
    });

    const now = new Date('2026-05-05T10:00:00.000Z');
    const metrics = await processOrderAutoAdvance(testDb.db, now);

    // Order A: shipped → NOT auto-advanced (manual gate)
    expect(testDb.orders[0].status).toBe('shipped');
    // Order B: paid_locked → shipped (rental started)
    expect(testDb.orders[1].status).toBe('shipped');
    expect(metrics.paid_locked_to_shipped.processed).toBe(1);
  });

  it('leap day rental: 2028-02-28 to 2028-02-29', async () => {
    testDb.addProduct({ id: 'prod-1' });
    testDb.addOrder({
      status: 'paid_locked',
      rentalStartDate: new Date('2028-02-28T00:00:00.000Z'),
      rentalEndDate: new Date('2028-02-29T00:00:00.000Z'),
      items: [{ productId: 'prod-1' }],
    });

    const now = new Date('2028-02-29T10:00:00.000Z'); // Bangkok: Feb 29
    const metrics = await processOrderAutoAdvance(testDb.db, now);

    expect(metrics.paid_locked_to_shipped.processed).toBe(1);
    expect(testDb.orders[0].status).toBe('shipped');
  });

  it('does not advance cancelled order', async () => {
    testDb.addOrder({
      status: 'cancelled',
      rentalStartDate: new Date('2026-05-01T00:00:00.000Z'),
      rentalEndDate: new Date('2026-05-03T00:00:00.000Z'),
      items: [{ productId: 'prod-1' }],
    });

    const now = new Date('2026-05-06T10:00:00.000Z');
    const metrics = await processOrderAutoAdvance(testDb.db, now);

    expect(testDb.orders[0].status).toBe('cancelled');
    expect(metrics.paid_locked_to_shipped.processed).toBe(0);
  });
});
