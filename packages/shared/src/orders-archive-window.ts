/**
 * BUG-ORDERS-ARCHIVE-01 — pure archive-window classifier for the admin
 * /orders list. Policy (owner-ratified, no schema change, no cron):
 *
 *   1. Active statuses (anything NOT in ARCHIVED_STATUSES) are ALWAYS
 *      visible regardless of `updatedAt` age. Never hide work-in-progress.
 *   2. finished / cancelled orders are hidden when
 *        updatedAt < now() - windowDays * 86_400_000 ms.
 *      Boundary is inclusive at the cutoff moment (updatedAt === cutoff
 *      stays visible).
 *   3. includeStale=true short-circuits the filter (for the admin
 *      "show archived" toggle and ad-hoc audit queries).
 *
 * The same rule is encoded twice — once at the DB where-clause level
 * in `apps/api/src/routes/admin/orders.ts` for Prisma efficiency, and
 * once here as a pure function so tests, frontend previews, and any
 * post-query reductions (e.g. in-memory tab counts) agree on the cut.
 */
export const ARCHIVED_STATUSES = ['finished', 'cancelled'] as const;
export type ArchivedStatus = (typeof ARCHIVED_STATUSES)[number];

export const ACTIVE_ORDER_STATUSES = [
  'unpaid',
  'paid_locked',
  'shipped',
  'returned',
  'cleaning',
  'repair',
] as const;
export type ActiveOrderStatus = (typeof ACTIVE_ORDER_STATUSES)[number];

export type OrderStatusLiteral = ActiveOrderStatus | ArchivedStatus;

export interface ArchivableOrder {
  status: OrderStatusLiteral;
  updatedAt: Date | string;
}

/** Default window used by the admin /orders page. Mirror in i18n copy. */
export const DEFAULT_ARCHIVE_WINDOW_DAYS = 30;

/**
 * Returns the Date before which finished/cancelled orders are considered
 * stale. Pure: no Date.now() access; callers pass `now`.
 */
export function computeArchiveCutoff(now: Date, windowDays: number): Date {
  if (!Number.isFinite(windowDays) || windowDays < 0) {
    throw new Error(
      `computeArchiveCutoff: windowDays must be a finite, non-negative number; got ${String(windowDays)}`,
    );
  }
  return new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function isArchivedStatus(status: OrderStatusLiteral): status is ArchivedStatus {
  return (ARCHIVED_STATUSES as readonly string[]).includes(status);
}

/**
 * Returns true when the order should be hidden from the default /orders
 * view. Active statuses always return false (never hide work-in-progress).
 */
export function isArchived(order: ArchivableOrder, cutoff: Date): boolean {
  if (!isArchivedStatus(order.status)) return false;
  const updatedAt = toDate(order.updatedAt);
  return updatedAt.getTime() < cutoff.getTime();
}

export interface ApplyArchiveFilterOpts {
  cutoff: Date;
  /** When true, returns the input unchanged (archived toggle). */
  includeStale?: boolean;
}

export function applyArchiveFilter<T extends ArchivableOrder>(
  rows: readonly T[],
  opts: ApplyArchiveFilterOpts,
): T[] {
  if (opts.includeStale) return [...rows];
  return rows.filter((r) => !isArchived(r, opts.cutoff));
}

export interface PaginationInput {
  total: number;
  page: number;
  pageSize: number;
}

export interface PaginationShape {
  totalPages: number;
  hasMore: boolean;
}

/**
 * Computes total_pages + has_more for the admin /orders list. Shape
 * matches what the frontend consumes via `meta.total_pages` /
 * `meta.has_more` so the prev/next control can disable at the edges
 * without knowing page math.
 */
export function computePagination({
  total,
  page,
  pageSize,
}: PaginationInput): PaginationShape {
  if (!Number.isFinite(total) || total < 0) {
    throw new Error(`computePagination: total must be non-negative; got ${String(total)}`);
  }
  if (!Number.isFinite(page) || page < 1) {
    throw new Error(`computePagination: page must be >= 1; got ${String(page)}`);
  }
  if (!Number.isFinite(pageSize) || pageSize < 1) {
    throw new Error(`computePagination: pageSize must be >= 1; got ${String(pageSize)}`);
  }
  if (total === 0) return { totalPages: 0, hasMore: false };
  const totalPages = Math.ceil(total / pageSize);
  const hasMore = page * pageSize < total;
  return { totalPages, hasMore };
}
