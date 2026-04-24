// BUG-ORDERS-ARCHIVE-01-COUNT-PARITY — single source of truth for the
// admin /orders WHERE clause. Shared between the list route
// (`GET /api/v1/admin/orders`) and the new counts route
// (`GET /api/v1/admin/orders/counts`) so tab-count badges always match
// the filtered row count, and the owner's contract
//   "All Time + include_stale=true must return ALL orders regardless
//    of date window"
// is pinned at the function level rather than at each handler's
// inlined conditional.
//
// This module intentionally lives in apps/api (not @cutebunny/shared)
// because its return type references `Prisma.OrderWhereInput`, which
// is generated per-deployment and not safe to import from shared.

import type { OrderStatus, Prisma } from '@prisma/client';
import {
  ARCHIVED_STATUSES,
  buildOrdersWindowFilter,
} from '@cutebunny/shared/orders-archive-window';

export interface OrdersListQuery {
  status?: string;
  from?: string;
  to?: string;
  date_from?: string;
  date_to?: string;
  include_stale?: string;
  search?: string;
  search_sku?: string;
  search_product_name?: string;
  search_tracking?: string;
  search_order_number?: string;
  search_customer_name?: string;
  search_customer_phone?: string;
}

/**
 * Parses the admin /orders query params and returns the Prisma
 * OrderWhereInput. Honors every legacy alias (`date_from` / `date_to`)
 * and the new BUG-ORDERS-ARCHIVE-01 params (`from` / `to` /
 * `include_stale`).
 *
 * When include_stale is truthy ('true' or '1'), the archive-cutoff
 * condition is bypassed, but any createdAt bounds the caller passed
 * are STILL enforced (BUG-ORDERS-DATE-FILTER-01 rescope). Only the
 * "All Time" preset — which emits empty-string `from`/`to` — clears
 * the createdAt filter entirely.
 */
export function buildOrdersWhere(q: OrdersListQuery): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {};
  const dateFrom = q.from ?? q.date_from;
  const dateTo = q.to ?? q.date_to;
  const includeStale = q.include_stale === 'true' || q.include_stale === '1';

  if (q.status) where.status = q.status as OrderStatus;

  const windowFilter = buildOrdersWindowFilter({
    includeStale,
    dateFrom: dateFrom ?? undefined,
    dateTo: dateTo ?? undefined,
  });
  if (windowFilter.createdAt) where.createdAt = windowFilter.createdAt;

  if (q.search) {
    where.OR = [
      { orderNumber: { contains: q.search, mode: 'insensitive' } },
      { customer: { phone: { contains: q.search } } },
      { customer: { email: { contains: q.search, mode: 'insensitive' } } },
      { customer: { firstName: { contains: q.search, mode: 'insensitive' } } },
      { customer: { lastName: { contains: q.search, mode: 'insensitive' } } },
    ];
  }

  const andConditions: Prisma.OrderWhereInput[] = [];
  if (q.search_order_number) {
    andConditions.push({
      orderNumber: { contains: q.search_order_number, mode: 'insensitive' },
    });
  }
  if (q.search_customer_name) {
    andConditions.push({
      OR: [
        { customer: { firstName: { contains: q.search_customer_name, mode: 'insensitive' } } },
        { customer: { lastName: { contains: q.search_customer_name, mode: 'insensitive' } } },
      ],
    });
  }
  if (q.search_customer_phone) {
    andConditions.push({ customer: { phone: { contains: q.search_customer_phone } } });
  }
  if (q.search_sku) {
    andConditions.push({
      items: { some: { product: { sku: { contains: q.search_sku, mode: 'insensitive' } } } },
    });
  }
  if (q.search_product_name) {
    andConditions.push({
      items: { some: { productName: { contains: q.search_product_name, mode: 'insensitive' } } },
    });
  }
  if (q.search_tracking) {
    andConditions.push({
      shippingSnapshot: { path: ['tracking_number'], string_contains: q.search_tracking },
    });
  }

  if (windowFilter.archiveCutoff) {
    andConditions.push({
      OR: [
        { status: { notIn: [...ARCHIVED_STATUSES] as OrderStatus[] } },
        { updatedAt: { gte: windowFilter.archiveCutoff } },
      ],
    });
  }

  if (andConditions.length > 0) where.AND = andConditions;
  return where;
}

/**
 * Variant of buildOrdersWhere that strips the caller's `status` input.
 * Used by the /counts route so tab-count aggregation always reflects
 * every status bucket, even when the UI is currently sitting on a
 * specific tab.
 */
export function buildOrdersCountsWhere(q: OrdersListQuery): Prisma.OrderWhereInput {
  const rest = { ...q };
  delete rest.status;
  return buildOrdersWhere(rest);
}
