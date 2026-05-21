/**
 * HOTFIX-513 — Schema-safe guard for late_fee/damage_fee in scheduled worker.
 *
 * Verifies that the scheduled worker queries orders with explicit `select`
 * instead of `include` (which causes Prisma to SELECT * including columns
 * that may not exist in prod yet, triggering P2022).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processOrderAutoAdvance, backfillStaleOrders } from '../scheduled';

// ─── Mock DB ────────────────────────────────────────────────────────────

function createSchemaGuardDb() {
  const orders: Array<Record<string, unknown>> = [];
  const statusLogs: Array<Record<string, unknown>> = [];

  // Track all findMany calls to verify select vs include
  const findManyCalls: Array<Record<string, unknown>> = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      await fn(db);
    }),
    order: {
      findMany: vi.fn(async (args?: Record<string, unknown>) => {
        findManyCalls.push(args ?? {});
        return orders.filter((o) => {
          if (!args?.where) return true;
          const w = args.where as Record<string, unknown>;
          if (w.status && typeof w.status === 'string' && o.status !== w.status) return false;
          if (w.rentalStartDate && typeof w.rentalStartDate === 'object') {
            const cond = w.rentalStartDate as { lte?: Date };
            if (cond.lte && (o.rentalStartDate as Date).getTime() > cond.lte.getTime()) return false;
          }
          if (w.rentalEndDate && typeof w.rentalEndDate === 'object') {
            const cond = w.rentalEndDate as { lt?: Date };
            if (cond.lt && (o.rentalEndDate as Date).getTime() >= cond.lt.getTime()) return false;
          }
          return true;
        }).slice(0, (args?.take as number) ?? 100);
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
      findUnique: vi.fn(async () => null),
    },
    orderStatusLog: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        statusLogs.push({ ...args.data, createdAt: new Date() });
        return { id: 'log-' + statusLogs.length };
      }),
      findFirst: vi.fn(async () => null),
    },
    availabilityCalendar: {
      updateMany: vi.fn(async () => ({ count: 0 })),
      findMany: vi.fn(async () => []),
    },
    product: {
      findUnique: vi.fn(async () => null),
    },
    customer: {
      findUnique: vi.fn(async () => null),
    },
    systemConfig: {
      findUnique: vi.fn(async () => null),
    },
    notificationLog: {
      create: vi.fn(async () => ({ id: 'notif-1' })),
    },
  };

  return { db, findManyCalls, orders, statusLogs };
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('HOTFIX-513: Schema-safe guard — scheduled worker uses select instead of include', () => {
  let db: ReturnType<typeof createSchemaGuardDb>['db'];
  let findManyCalls: Array<Record<string, unknown>>;

  beforeEach(() => {
    const mock = createSchemaGuardDb();
    db = mock.db;
    findManyCalls = mock.findManyCalls;
  });

  it('processOrderAutoAdvance uses select (not include) for all order.findMany calls', async () => {
    await processOrderAutoAdvance(db, new Date('2026-05-12T07:00:00.000Z'));

    // Should have at least 1 findMany call (paid_locked batch)
    // plus detectStaleOrders (shipped batch)
    expect(findManyCalls.length).toBeGreaterThanOrEqual(1);

    for (const call of findManyCalls) {
      // Every call must use `select`, not `include`
      expect(call).toHaveProperty('select');
      expect(call).not.toHaveProperty('include');

      // The select must NOT reference lateFee or damageFee
      const selectObj = call.select as Record<string, unknown>;
      expect(selectObj).not.toHaveProperty('lateFee');
      expect(selectObj).not.toHaveProperty('damageFee');
    }
  });

  it('backfillStaleOrders uses select (not include) for all order.findMany calls', async () => {
    await backfillStaleOrders(db, true, new Date('2026-05-12T07:00:00.000Z'));

    // Should have at least 1 findMany call (paid_locked)
    expect(findManyCalls.length).toBeGreaterThanOrEqual(1);

    for (const call of findManyCalls) {
      expect(call).toHaveProperty('select');
      expect(call).not.toHaveProperty('include');

      const selectObj = call.select as Record<string, unknown>;
      expect(selectObj).not.toHaveProperty('lateFee');
      expect(selectObj).not.toHaveProperty('damageFee');
    }
  });

  it('select includes only fields needed by the scheduled worker', async () => {
    await processOrderAutoAdvance(db, new Date('2026-05-12T07:00:00.000Z'));

    // Check the first findMany call (paid_locked batch)
    const firstCall = findManyCalls[0];
    const selectObj = firstCall.select as Record<string, unknown>;

    // Required fields for scheduled worker
    expect(selectObj).toHaveProperty('id', true);
    expect(selectObj).toHaveProperty('orderNumber', true);
    expect(selectObj).toHaveProperty('customerId', true);
    expect(selectObj).toHaveProperty('status', true);
    expect(selectObj).toHaveProperty('rentalStartDate', true);
    expect(selectObj).toHaveProperty('rentalEndDate', true);
    expect(selectObj).toHaveProperty('items');
  });

  it('processOrderAutoAdvance succeeds without late_fee/damage_fee in order data', async () => {
    // Simulate order data without fee columns (pre-migration state)
    const mock = createSchemaGuardDb();
    mock.orders.push({
      id: 'order-1',
      orderNumber: 'ORD-TEST-001',
      customerId: 'cust-1',
      status: 'paid_locked',
      rentalStartDate: new Date('2026-05-10'),
      rentalEndDate: new Date('2026-05-12'),
      // No lateFee, damageFee — simulates pre-migration data
      items: [{ productId: 'prod-1' }],
    });

    // Product must exist and be available for inventory check
    mock.db.product.findUnique.mockResolvedValue({
      id: 'prod-1',
      available: true,
      name: 'Test Product',
    });
    mock.db.customer.findUnique.mockResolvedValue({
      id: 'cust-1',
      email: 'test@example.com',
    });
    mock.db.order.updateMany.mockResolvedValue({ count: 1 });

    const metrics = await processOrderAutoAdvance(
      mock.db,
      new Date('2026-05-12T07:00:00.000Z'),
    );

    // Should process the order without error
    expect(metrics.paid_locked_to_shipped.processed).toBe(1);
    expect(metrics.paid_locked_to_shipped.failed).toBe(0);
  });

  it('backfillStaleOrders succeeds without fee columns in order data', async () => {
    const mock = createSchemaGuardDb();
    mock.orders.push({
      id: 'order-2',
      orderNumber: 'ORD-TEST-002',
      customerId: 'cust-2',
      status: 'paid_locked',
      rentalStartDate: new Date('2026-05-08'),
      rentalEndDate: new Date('2026-05-10'),
      items: [{ productId: 'prod-2' }],
    });

    mock.db.product.findUnique.mockResolvedValue({
      id: 'prod-2',
      available: true,
      name: 'Test Product 2',
    });
    mock.db.order.updateMany.mockResolvedValue({ count: 1 });

    const result = await backfillStaleOrders(
      mock.db,
      true, // dry-run
      new Date('2026-05-12T07:00:00.000Z'),
    );

    // Should scan orders without error
    expect(result.orders_scanned).toBe(1);
    expect(result.errors).toHaveLength(0);
  });
});
