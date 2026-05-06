/**
 * BUG-505 — Cloudflare Scheduled Worker for order status auto-advance.
 *
 * Runs hourly via cron trigger. Transitions:
 *   paid_locked → shipped  (when rental_start_date <= today_BKK AND inventory verified)
 *   returned → cleaning    (when rental_end_date + buffer_days <= today_BKK)
 *
 * Manual gates (NOT auto-advanced):
 *   shipped → returned     (admin confirms physical return)
 *   cleaning → finished    (admin confirms cleaning complete)
 *
 * Design:
 *   - Optimistic concurrency: UPDATE WHERE id=$1 AND status=$expected
 *   - Atomic tx per order: status flip + calendar reconciliation
 *   - Batch: paginate 100 orders per run
 *   - Idempotent: re-run is always a no-op for already-advanced orders
 *   - Timezone: all date comparisons use Asia/Bangkok (UTC+7)
 */

import type { PrismaClient } from '@prisma/client';

// ─── Timezone helpers ──────────────────────────────────────────────────

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000; // UTC+7

/** Returns today's date string (YYYY-MM-DD) in Asia/Bangkok. */
export function todayBangkok(now: Date = new Date()): string {
  const bangkokMs = now.getTime() + BANGKOK_OFFSET_MS;
  return new Date(bangkokMs).toISOString().split('T')[0];
}

/** Returns a Date object for 00:00:00 UTC of the given YYYY-MM-DD string. */
function dateOnly(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

// ─── Types ─────────────────────────────────────────────────────────────

export interface TickMetrics {
  paid_locked_to_shipped: { processed: number; skipped: number; failed: number };
  returned_to_cleaning: { processed: number; skipped: number; failed: number };
  alerts: Alert[];
  duration_ms: number;
}

export interface Alert {
  type:
    | 'stale_paid_locked'
    | 'stale_shipped'
    | 'inventory_unavailable_at_shipping'
    | 'calendar_drift';
  order_id: string;
  order_number: string;
  detail: string;
}

interface AutoAdvanceConfig {
  default_buffer_days: number;
  product_buffer_days: Record<string, number>;
}

const DEFAULT_AUTO_ADVANCE_CONFIG: AutoAdvanceConfig = {
  default_buffer_days: 1,
  product_buffer_days: {},
};

const BATCH_SIZE = 100;

// ─── Config loader ─────────────────────────────────────────────────────

async function loadAutoAdvanceConfig(db: PrismaClient): Promise<AutoAdvanceConfig> {
  try {
    const row = await db.systemConfig.findUnique({
      where: { key: 'auto_advance_config' },
    });
    if (row && row.value && typeof row.value === 'object') {
      const val = row.value as Record<string, unknown>;
      return {
        default_buffer_days:
          typeof val.default_buffer_days === 'number' ? val.default_buffer_days : 1,
        product_buffer_days:
          typeof val.product_buffer_days === 'object' && val.product_buffer_days !== null
            ? (val.product_buffer_days as Record<string, number>)
            : {},
      };
    }
  } catch {
    // Config not seeded yet — use defaults
  }
  return { ...DEFAULT_AUTO_ADVANCE_CONFIG };
}

// ─── Inventory verification ────────────────────────────────────────────

/**
 * Verify that calendar slots for the order's rental period are still
 * booked for this order (haven't been released/reassigned). Also checks
 * that the product and its inventory unit are not decommissioned.
 */
async function verifyInventoryAvailable(
  db: PrismaClient,
  orderId: string,
  items: Array<{ productId: string }>,
  rentalStartDate: Date,
  rentalEndDate: Date,
): Promise<{ available: boolean; reason?: string }> {
  for (const item of items) {
    // Check product exists and is available
    const product = await db.product.findUnique({
      where: { id: item.productId },
      select: { id: true, available: true, name: true },
    });
    if (!product) {
      return { available: false, reason: `Product ${item.productId} not found` };
    }
    if (!product.available) {
      return { available: false, reason: `Product "${product.name}" is no longer available` };
    }

    // Check that calendar slots for rental period belong to this order
    const conflictSlots = await db.availabilityCalendar.findMany({
      where: {
        productId: item.productId,
        calendarDate: { gte: rentalStartDate, lte: rentalEndDate },
        slotStatus: { in: ['booked', 'tentative'] },
        orderId: { not: orderId },
      },
      take: 1,
    });
    if (conflictSlots.length > 0) {
      return {
        available: false,
        reason: `Product "${product.name}" has conflicting booking on ${conflictSlots[0].calendarDate.toISOString().split('T')[0]}`,
      };
    }
  }
  return { available: true };
}

// ─── Calendar reconciliation ───────────────────────────────────────────

/**
 * Sync calendar slot states for an order after status transition.
 * Runs inside the same transaction as the status flip.
 */
async function reconcileCalendarSlots(
  tx: PrismaClient,
  orderId: string,
  newStatus: 'shipped' | 'cleaning',
  rentalEndDate: Date,
): Promise<{ updated: number; driftDetected: boolean }> {
  let updated = 0;
  let driftDetected = false;

  if (newStatus === 'shipped') {
    // When advancing to shipped: ensure rental period slots are 'booked'
    // Fix any that drifted to 'tentative' or 'available'
    const driftedSlots = await tx.availabilityCalendar.updateMany({
      where: {
        orderId,
        slotStatus: { in: ['tentative', 'available'] },
      },
      data: { slotStatus: 'booked' },
    });
    updated = driftedSlots.count;
    driftDetected = driftedSlots.count > 0;
  }

  if (newStatus === 'cleaning') {
    // When advancing to cleaning: mark any remaining 'late_return' slots
    // for this order as 'washing' (dress is now in cleaning process)
    const todayStr = todayBangkok();
    const today = dateOnly(todayStr);
    const lateSlots = await tx.availabilityCalendar.updateMany({
      where: {
        orderId,
        slotStatus: 'late_return',
        calendarDate: { gt: rentalEndDate },
      },
      data: { slotStatus: 'washing' },
    });
    updated += lateSlots.count;

    // Also ensure post-rental shipping slots that are still 'shipping'
    // are updated to 'washing' if the item is now in cleaning
    const shippingSlots = await tx.availabilityCalendar.updateMany({
      where: {
        orderId,
        slotStatus: 'shipping',
        calendarDate: { gt: rentalEndDate, lte: today },
      },
      data: { slotStatus: 'washing' },
    });
    updated += shippingSlots.count;
    driftDetected = driftDetected || (lateSlots.count + shippingSlots.count) > 0;
  }

  return { updated, driftDetected };
}

// ─── paid_locked → shipped ─────────────────────────────────────────────

async function advancePaidLockedToShipped(
  db: PrismaClient,
  todayStr: string,
  metrics: TickMetrics,
): Promise<void> {
  const todayDate = dateOnly(todayStr);
  const staleCutoff = new Date(todayDate);
  staleCutoff.setDate(staleCutoff.getDate() - 1); // start_date + 1d ago = stale

  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const orders = await db.order.findMany({
      where: {
        status: 'paid_locked',
        rentalStartDate: { lte: todayDate },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      include: {
        items: { select: { productId: true } },
      },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
    });

    hasMore = orders.length === BATCH_SIZE;
    if (orders.length > 0) {
      cursor = orders[orders.length - 1].id;
    }

    for (const order of orders) {
      try {
        // Check for stale alert (start_date + 1d already passed)
        if (order.rentalStartDate.getTime() <= staleCutoff.getTime()) {
          metrics.alerts.push({
            type: 'stale_paid_locked',
            order_id: order.id,
            order_number: order.orderNumber,
            detail: `Order still paid_locked, rental started ${order.rentalStartDate.toISOString().split('T')[0]}`,
          });
        }

        // Inventory pre-check
        const inventoryCheck = await verifyInventoryAvailable(
          db,
          order.id,
          order.items,
          order.rentalStartDate,
          order.rentalEndDate,
        );

        if (!inventoryCheck.available) {
          metrics.alerts.push({
            type: 'inventory_unavailable_at_shipping',
            order_id: order.id,
            order_number: order.orderNumber,
            detail: inventoryCheck.reason ?? 'Inventory unavailable',
          });
          metrics.paid_locked_to_shipped.skipped++;
          continue;
        }

        // Atomic transition + calendar reconciliation
        await db.$transaction(async (tx) => {
          // Optimistic concurrency: only update if still paid_locked
          const updated = await tx.order.updateMany({
            where: { id: order.id, status: 'paid_locked' },
            data: { status: 'shipped' },
          });

          if (updated.count === 0) {
            // Already advanced by admin or another tick
            metrics.paid_locked_to_shipped.skipped++;
            return;
          }

          // Status log
          await tx.orderStatusLog.create({
            data: {
              orderId: order.id,
              fromStatus: 'paid_locked',
              toStatus: 'shipped',
              note: 'system-auto-advance: paid_locked → shipped (rental start date reached)',
              changedBy: null,
            },
          });

          // Calendar reconciliation
          const calResult = await reconcileCalendarSlots(
            tx as unknown as PrismaClient,
            order.id,
            'shipped',
            order.rentalEndDate,
          );

          if (calResult.driftDetected) {
            metrics.alerts.push({
              type: 'calendar_drift',
              order_id: order.id,
              order_number: order.orderNumber,
              detail: `Fixed ${calResult.updated} drifted calendar slot(s) during paid_locked→shipped`,
            });
          }

          // Customer notification (non-blocking, outside core tx)
          metrics.paid_locked_to_shipped.processed++;
        });

        // Post-tx notification (isolated, non-blocking)
        try {
          const customer = await db.customer.findUnique({
            where: { id: order.customerId },
            select: { email: true, id: true },
          });
          if (customer) {
            const { sendOrderStatusNotification } = await import('./lib/notifications');
            await sendOrderStatusNotification(
              order.id,
              order.orderNumber,
              'shipped',
              customer.email,
              customer.id,
            );
          }
        } catch {
          // Notification failure is non-blocking
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === 'OPTIMISTIC_LOCK_CONFLICT') {
          metrics.paid_locked_to_shipped.skipped++;
        } else {
          metrics.paid_locked_to_shipped.failed++;
          console.error(`[scheduled] paid_locked→shipped failed for ${order.orderNumber}:`, msg);
        }
      }
    }
  }
}

// ─── returned → cleaning ───────────────────────────────────────────────

async function advanceReturnedToCleaning(
  db: PrismaClient,
  todayStr: string,
  config: AutoAdvanceConfig,
  metrics: TickMetrics,
): Promise<void> {
  const todayDate = dateOnly(todayStr);

  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const orders = await db.order.findMany({
      where: {
        status: 'returned',
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      include: {
        items: { select: { productId: true } },
      },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
    });

    hasMore = orders.length === BATCH_SIZE;
    if (orders.length > 0) {
      cursor = orders[orders.length - 1].id;
    }

    for (const order of orders) {
      try {
        // Determine buffer days (per-product override or default)
        const productIds = order.items.map((i) => i.productId);
        let bufferDays = config.default_buffer_days;
        for (const pid of productIds) {
          if (config.product_buffer_days[pid] !== undefined) {
            bufferDays = Math.max(bufferDays, config.product_buffer_days[pid]);
          }
        }

        // Check if buffer period has passed
        const bufferCutoff = new Date(order.rentalEndDate);
        bufferCutoff.setDate(bufferCutoff.getDate() + bufferDays);

        if (todayDate.getTime() < bufferCutoff.getTime()) {
          metrics.returned_to_cleaning.skipped++;
          continue;
        }

        // Atomic transition + calendar reconciliation
        await db.$transaction(async (tx) => {
          const updated = await tx.order.updateMany({
            where: { id: order.id, status: 'returned' },
            data: { status: 'cleaning' },
          });

          if (updated.count === 0) {
            metrics.returned_to_cleaning.skipped++;
            return;
          }

          await tx.orderStatusLog.create({
            data: {
              orderId: order.id,
              fromStatus: 'returned',
              toStatus: 'cleaning',
              note: `system-auto-advance: returned → cleaning (buffer ${bufferDays}d after rental_end)`,
              changedBy: null,
            },
          });

          const calResult = await reconcileCalendarSlots(
            tx as unknown as PrismaClient,
            order.id,
            'cleaning',
            order.rentalEndDate,
          );

          if (calResult.driftDetected) {
            metrics.alerts.push({
              type: 'calendar_drift',
              order_id: order.id,
              order_number: order.orderNumber,
              detail: `Fixed ${calResult.updated} drifted calendar slot(s) during returned→cleaning`,
            });
          }

          metrics.returned_to_cleaning.processed++;
        });
      } catch (e) {
        metrics.returned_to_cleaning.failed++;
        console.error(
          `[scheduled] returned→cleaning failed for ${order.orderNumber}:`,
          e instanceof Error ? e.message : String(e),
        );
      }
    }
  }
}

// ─── Stale order alerts ────────────────────────────────────────────────

async function detectStaleOrders(
  db: PrismaClient,
  todayStr: string,
  metrics: TickMetrics,
): Promise<void> {
  const todayDate = dateOnly(todayStr);

  // Stale shipped: rental ended >7 days ago but still shipped
  const staleShippedCutoff = new Date(todayDate);
  staleShippedCutoff.setDate(staleShippedCutoff.getDate() - 7);

  const staleShipped = await db.order.findMany({
    where: {
      status: 'shipped',
      rentalEndDate: { lt: staleShippedCutoff },
    },
    select: { id: true, orderNumber: true, rentalEndDate: true },
    take: 50,
  });

  for (const o of staleShipped) {
    metrics.alerts.push({
      type: 'stale_shipped',
      order_id: o.id,
      order_number: o.orderNumber,
      detail: `Shipped order past rental end by >7 days (ended ${o.rentalEndDate.toISOString().split('T')[0]})`,
    });
  }
}

// ─── Main scheduled handler ────────────────────────────────────────────

export async function processOrderAutoAdvance(
  db: PrismaClient,
  now?: Date,
): Promise<TickMetrics> {
  const startTime = Date.now();
  const todayStr = todayBangkok(now);

  const metrics: TickMetrics = {
    paid_locked_to_shipped: { processed: 0, skipped: 0, failed: 0 },
    returned_to_cleaning: { processed: 0, skipped: 0, failed: 0 },
    alerts: [],
    duration_ms: 0,
  };

  const config = await loadAutoAdvanceConfig(db);

  await advancePaidLockedToShipped(db, todayStr, metrics);
  await advanceReturnedToCleaning(db, todayStr, config, metrics);
  await detectStaleOrders(db, todayStr, metrics);

  metrics.duration_ms = Date.now() - startTime;

  console.log('[scheduled] BUG-505 tick complete:', JSON.stringify(metrics));

  return metrics;
}

// ─── Derived UI flags ──────────────────────────────────────────────────

export interface DerivedOrderFlags {
  is_overdue: boolean;
  is_late: boolean;
  is_awaiting_return: boolean;
  needs_action: boolean;
  days_overdue: number;
}

/**
 * Compute derived UI flags from order status + rental period.
 * Pure function — no DB access, no side effects.
 */
export function computeDerivedFlags(
  status: string,
  rentalStartDate: Date | string,
  rentalEndDate: Date | string,
  now?: Date,
): DerivedOrderFlags {
  const todayStr = todayBangkok(now);
  const todayMs = dateOnly(todayStr).getTime();
  const startMs = (typeof rentalStartDate === 'string' ? new Date(rentalStartDate) : rentalStartDate).getTime();
  const endMs = (typeof rentalEndDate === 'string' ? new Date(rentalEndDate) : rentalEndDate).getTime();

  const daysAfterEnd = Math.floor((todayMs - endMs) / (1000 * 60 * 60 * 24));

  // overdue: shipped AND rental_end_date < today (should have been returned)
  const is_overdue = status === 'shipped' && daysAfterEnd > 0;

  // late: returned but significantly past rental_end (>3 days)
  const is_late = status === 'returned' && daysAfterEnd > 3;

  // awaiting_return: shipped AND rental_end_date <= today (return window)
  const is_awaiting_return = status === 'shipped' && todayMs >= endMs;

  // needs_action: statuses that require admin attention
  const needs_action =
    is_overdue ||
    (status === 'paid_locked' && todayMs >= startMs) || // should be shipped
    (status === 'unpaid' && todayMs >= startMs); // missed payment deadline

  return {
    is_overdue,
    is_late,
    is_awaiting_return,
    needs_action,
    days_overdue: is_overdue ? daysAfterEnd : 0,
  };
}

// ─── Backfill (one-shot, idempotent) ───────────────────────────────────

export interface BackfillResult {
  dry_run: boolean;
  orders_scanned: number;
  transitions: Array<{
    order_id: string;
    order_number: string;
    from_status: string;
    to_status: string;
    reason: string;
  }>;
  skipped: Array<{
    order_id: string;
    order_number: string;
    reason: string;
  }>;
  errors: string[];
}

export async function backfillStaleOrders(
  db: PrismaClient,
  dryRun: boolean = true,
  now?: Date,
): Promise<BackfillResult> {
  const todayStr = todayBangkok(now);
  const todayDate = dateOnly(todayStr);
  const config = await loadAutoAdvanceConfig(db);

  const result: BackfillResult = {
    dry_run: dryRun,
    orders_scanned: 0,
    transitions: [],
    skipped: [],
    errors: [],
  };

  // Find all stale paid_locked orders (rental started but never shipped)
  const stalePaidLocked = await db.order.findMany({
    where: {
      status: 'paid_locked',
      rentalStartDate: { lte: todayDate },
    },
    include: {
      items: { select: { productId: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  // Find all stale returned orders (buffer passed but not in cleaning)
  const staleReturned = await db.order.findMany({
    where: {
      status: 'returned',
    },
    include: {
      items: { select: { productId: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  result.orders_scanned = stalePaidLocked.length + staleReturned.length;

  // Process paid_locked → shipped
  for (const order of stalePaidLocked) {
    const inventoryCheck = await verifyInventoryAvailable(
      db,
      order.id,
      order.items,
      order.rentalStartDate,
      order.rentalEndDate,
    );

    if (!inventoryCheck.available) {
      result.skipped.push({
        order_id: order.id,
        order_number: order.orderNumber,
        reason: `Inventory unavailable: ${inventoryCheck.reason}`,
      });
      continue;
    }

    if (dryRun) {
      result.transitions.push({
        order_id: order.id,
        order_number: order.orderNumber,
        from_status: 'paid_locked',
        to_status: 'shipped',
        reason: `Rental started ${order.rentalStartDate.toISOString().split('T')[0]}, today is ${todayStr}`,
      });
    } else {
      try {
        await db.$transaction(async (tx) => {
          const updated = await tx.order.updateMany({
            where: { id: order.id, status: 'paid_locked' },
            data: { status: 'shipped' },
          });
          if (updated.count === 0) return;

          await tx.orderStatusLog.create({
            data: {
              orderId: order.id,
              fromStatus: 'paid_locked',
              toStatus: 'shipped',
              note: 'system-backfill: paid_locked → shipped (BUG-505)',
              changedBy: null,
            },
          });

          await reconcileCalendarSlots(
            tx as unknown as PrismaClient,
            order.id,
            'shipped',
            order.rentalEndDate,
          );
        });

        result.transitions.push({
          order_id: order.id,
          order_number: order.orderNumber,
          from_status: 'paid_locked',
          to_status: 'shipped',
          reason: `Backfilled: rental started ${order.rentalStartDate.toISOString().split('T')[0]}`,
        });
      } catch (e) {
        result.errors.push(
          `${order.orderNumber}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  // Process returned → cleaning
  for (const order of staleReturned) {
    const productIds = order.items.map((i) => i.productId);
    let bufferDays = config.default_buffer_days;
    for (const pid of productIds) {
      if (config.product_buffer_days[pid] !== undefined) {
        bufferDays = Math.max(bufferDays, config.product_buffer_days[pid]);
      }
    }

    const bufferCutoff = new Date(order.rentalEndDate);
    bufferCutoff.setDate(bufferCutoff.getDate() + bufferDays);

    if (todayDate.getTime() < bufferCutoff.getTime()) {
      result.skipped.push({
        order_id: order.id,
        order_number: order.orderNumber,
        reason: `Buffer not passed: end=${order.rentalEndDate.toISOString().split('T')[0]}, buffer=${bufferDays}d, cutoff=${bufferCutoff.toISOString().split('T')[0]}`,
      });
      continue;
    }

    if (dryRun) {
      result.transitions.push({
        order_id: order.id,
        order_number: order.orderNumber,
        from_status: 'returned',
        to_status: 'cleaning',
        reason: `Buffer passed: end=${order.rentalEndDate.toISOString().split('T')[0]}, buffer=${bufferDays}d`,
      });
    } else {
      try {
        await db.$transaction(async (tx) => {
          const updated = await tx.order.updateMany({
            where: { id: order.id, status: 'returned' },
            data: { status: 'cleaning' },
          });
          if (updated.count === 0) return;

          await tx.orderStatusLog.create({
            data: {
              orderId: order.id,
              fromStatus: 'returned',
              toStatus: 'cleaning',
              note: `system-backfill: returned → cleaning (BUG-505, buffer ${bufferDays}d)`,
              changedBy: null,
            },
          });

          await reconcileCalendarSlots(
            tx as unknown as PrismaClient,
            order.id,
            'cleaning',
            order.rentalEndDate,
          );
        });

        result.transitions.push({
          order_id: order.id,
          order_number: order.orderNumber,
          from_status: 'returned',
          to_status: 'cleaning',
          reason: `Backfilled: buffer ${bufferDays}d passed`,
        });
      } catch (e) {
        result.errors.push(
          `${order.orderNumber}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  return result;
}
