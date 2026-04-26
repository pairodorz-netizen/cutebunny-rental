/**
 * BUG-504-A03 — admin-only CRUD for the `categories` taxonomy table.
 *
 * Mount: app.route('/api/v1/admin/categories', adminCategories)
 *
 * Endpoints:
 *   GET    /                 — list every row in `sort_order ASC`, incl.
 *                              hidden (admin-bypass — no Cache-Control)
 *   POST   /                 — create (superadmin-only)
 *   PATCH  /:id              — partial update (superadmin-only)
 *   DELETE /:id              — hard delete (superadmin-only)
 *
 * Why a new router (vs extending `adminSettings`):
 *   The legacy `/api/v1/admin/settings/categories` endpoint is still
 *   wired into `apps/admin/src/pages/products.tsx` for the product
 *   create-form dropdown. A03 must be strictly additive / non-breaking
 *   so the legacy string[] endpoint is left untouched. The A04 atom
 *   migrates the customer site; a follow-up cleanup atom migrates the
 *   admin dropdown and retires the legacy endpoint.
 *
 * Response shape:
 *   Mirrors the A02 public `GET /api/v1/categories` (snake_case at the
 *   API boundary, camelCase inside Prisma). Keeps one wire contract
 *   across the admin + customer surfaces.
 *
 * Cache:
 *   Admin endpoints read the live row set (no Cache-Control). The 5-min
 *   public-edge cache on `GET /api/v1/categories` is accepted as the
 *   documented staleness window for A03. Edge purge-on-write is
 *   deferred to A04/A05.
 *
 * Redaction baseline:
 *   `onError()` catch-all returns 500 + JSON envelope
 *   `{error:{code:'internal_error',message:'Unexpected server error'}}`
 *   — identical to BUG-404-A01 / BUG-405-A01. No stack, no Prisma text,
 *   no Authorization header leak.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
  buildAdminCrudLogEntry,
  type AdminCrudOutcome,
} from '@cutebunny/shared/diagnostics';
import { getDb } from '../../lib/db';
import { success, created, error } from '../../lib/response';
import { getAdmin, requireRole } from '../../middleware/auth';

const adminCategories = new Hono();

// BUG-504-A07 — observability patch.
//
// Live incident 2026-04-26 19:53 GMT+9 (Cloudflare ray
// 9f250bf8fe01e395) showed three consecutive 500s on
// `DELETE /api/v1/admin/categories/:id` with the rendered envelope
// "Unexpected server error" — but the ray JSON had `exception:{}` and
// `logs:{}`, leaving us flying blind on the underlying throw.
//
// This catch-all previously returned the redacted envelope without
// emitting any structured log; Workers Logs Observability had nothing
// to show for the failure. We now emit a single `console.error` line
// tagged `[admin-categories]` carrying the exception identity + a
// truncated 5-frame stack alongside the request identifiers Cloudflare
// already redacts in the URL (so they're safe to log: a 12-hex-char
// hash for the categoryId path-param via `buildAdminCrudLogEntry`'s
// hashing pattern, the admin user id, and the `cf-ray` request id).
//
// Pattern mirrors `apps/api/src/routes/admin/products.ts:161`
// (BUG-404-A01) and `apps/api/src/routes/admin/orders.ts:25`
// (BUG-405-A01). Wire envelope is byte-for-byte unchanged so the
// redaction baseline documented at the top of this file still holds.
adminCategories.onError((err, c) => {
  // Best-effort identifier capture. None of these calls can throw on
  // a Hono Context — they fall back to `null` cleanly when absent
  // (e.g. unauthenticated request bypassing requireRole, or the
  // route had no `:id` segment).
  let userId: string | null = null;
  try {
    const admin = (c.get as unknown as (k: string) => unknown)('jwtPayload') as
      | { sub?: string }
      | undefined;
    userId = admin?.sub ?? null;
  } catch {
    userId = null;
  }
  const categoryId = c.req.param('id') ?? null;
  const requestId = c.req.header('cf-ray') ?? null;

  // eslint-disable-next-line no-console
  console.error(
    '[admin-categories]',
    JSON.stringify({
      err_message: err instanceof Error ? err.message : String(err),
      err_name: err instanceof Error ? err.name : null,
      err_code:
        typeof (err as unknown as { code?: unknown })?.code === 'string'
          ? (err as unknown as { code: string }).code
          : null,
      err_stack:
        err instanceof Error && typeof err.stack === 'string'
          ? err.stack.split('\n').slice(0, 5).join(' | ')
          : null,
      categoryId,
      userId,
      requestId,
    }),
  );

  return c.json(
    { error: { code: 'internal_error', message: 'Unexpected server error' } },
    500,
  );
});

// ─── Helpers ────────────────────────────────────────────────────────────

interface CategoryRow {
  id: string;
  slug: string;
  nameTh: string;
  nameEn: string;
  sortOrder: number;
  visibleFrontend: boolean;
  visibleBackend: boolean;
}

function toDto(row: CategoryRow) {
  return {
    id: row.id,
    slug: row.slug,
    name_th: row.nameTh,
    name_en: row.nameEn,
    sort_order: row.sortOrder,
    visible_frontend: row.visibleFrontend,
    visible_backend: row.visibleBackend,
  };
}

async function safeAuditLog(
  db: ReturnType<typeof getDb>,
  data: Parameters<ReturnType<typeof getDb>['auditLog']['create']>[0]['data'],
): Promise<void> {
  try {
    await db.auditLog.create({ data });
  } catch {
    // Audit log is non-critical; swallow errors from schema drift.
  }
}

/**
 * BUG-504-RC1-RC2 — structured CRUD log line.
 *
 * Cloudflare Workers Logs masks the path identifier; without a hash
 * we cannot correlate "the failing DELETE" to "the offending row".
 * `buildAdminCrudLogEntry` produces a deterministic 12-hex-char hash
 * so two log lines for the same id collide while raw UUIDs never
 * leak into the log stream.
 *
 * `console.log` here is intentionally `console.log` (not `console.error`)
 * even on error outcomes: Workers Logs differentiates by the structured
 * `outcome` / `error_code` fields, not by stream. Stays a single line
 * so log-aggregation tools can JSON.parse it directly.
 */
function logAdminCategoryCrud(input: {
  route: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  identifier: string | null;
  outcome: AdminCrudOutcome;
  errorCode: string | null;
  details?: Record<string, string | number | boolean | null>;
}): void {
  const entry = buildAdminCrudLogEntry(input);
  // eslint-disable-next-line no-console
  console.log('[admin-categories]', JSON.stringify(entry));
}

// ─── Schemas ────────────────────────────────────────────────────────────

const SLUG_RE = /^[a-z0-9_-]+$/;
const SlugSchema = z.string().min(1).max(100).regex(SLUG_RE, 'slug must match [a-z0-9_-]+');
const NameSchema = z.string().min(1).max(200);
const SortOrderSchema = z.number().int().min(0);

const createSchema = z.object({
  slug: SlugSchema,
  name_th: NameSchema,
  name_en: NameSchema,
  sort_order: SortOrderSchema,
  visible_frontend: z.boolean().optional(),
  visible_backend: z.boolean().optional(),
});

const updateSchema = z
  .object({
    slug: SlugSchema.optional(),
    name_th: NameSchema.optional(),
    name_en: NameSchema.optional(),
    sort_order: SortOrderSchema.optional(),
    visible_frontend: z.boolean().optional(),
    visible_backend: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field is required' });

// ─── Routes ─────────────────────────────────────────────────────────────

// GET /api/v1/admin/categories — admin list (incl. hidden, no cache)
adminCategories.get('/', async (c) => {
  const db = getDb();
  const rows = await db.category.findMany({ orderBy: { sortOrder: 'asc' } });
  return success(c, rows.map((r: CategoryRow) => toDto(r)));
});

// POST /api/v1/admin/categories — create
adminCategories.post('/', requireRole('superadmin'), async (c) => {
  const db = getDb();
  const admin = getAdmin(c);
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid category data', parsed.error.flatten());
  }

  const existing = await db.category.findUnique({ where: { slug: parsed.data.slug } });
  if (existing) {
    return error(c, 409, 'CONFLICT', `Category slug "${parsed.data.slug}" already exists`);
  }

  const row = (await db.category.create({
    data: {
      slug: parsed.data.slug,
      nameTh: parsed.data.name_th,
      nameEn: parsed.data.name_en,
      sortOrder: parsed.data.sort_order,
      ...(parsed.data.visible_frontend !== undefined && { visibleFrontend: parsed.data.visible_frontend }),
      ...(parsed.data.visible_backend !== undefined && { visibleBackend: parsed.data.visible_backend }),
    },
  })) as CategoryRow;

  await safeAuditLog(db, {
    adminId: admin.sub,
    action: 'CREATE',
    resource: 'category',
    resourceId: row.id,
    details: { slug: row.slug, name_th: row.nameTh, name_en: row.nameEn, sort_order: row.sortOrder },
  });

  return created(c, toDto(row));
});

// PATCH /api/v1/admin/categories/:id — partial update
adminCategories.patch('/:id', requireRole('superadmin'), async (c) => {
  const db = getDb();
  const admin = getAdmin(c);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    logAdminCategoryCrud({
      route: '/api/v1/admin/categories/:id',
      method: 'PATCH',
      identifier: id,
      outcome: 'validation_error',
      errorCode: 'VALIDATION_ERROR',
    });
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid category data', parsed.error.flatten());
  }

  const existing = (await db.category.findUnique({ where: { id } })) as CategoryRow | null;
  if (!existing) {
    logAdminCategoryCrud({
      route: '/api/v1/admin/categories/:id',
      method: 'PATCH',
      identifier: id,
      outcome: 'not_found',
      errorCode: 'NOT_FOUND',
    });
    return error(c, 404, 'NOT_FOUND', 'Category not found');
  }

  // Slug-collision guard: only when slug is actually changing.
  if (parsed.data.slug && parsed.data.slug !== existing.slug) {
    const collision = (await db.category.findUnique({
      where: { slug: parsed.data.slug },
    })) as CategoryRow | null;
    if (collision && collision.id !== id) {
      return error(c, 409, 'CONFLICT', `Category slug "${parsed.data.slug}" already exists`);
    }
  }

  const data: Prisma.CategoryUpdateInput = {};
  if (parsed.data.slug !== undefined) data.slug = parsed.data.slug;
  if (parsed.data.name_th !== undefined) data.nameTh = parsed.data.name_th;
  if (parsed.data.name_en !== undefined) data.nameEn = parsed.data.name_en;
  if (parsed.data.sort_order !== undefined) data.sortOrder = parsed.data.sort_order;
  if (parsed.data.visible_frontend !== undefined) data.visibleFrontend = parsed.data.visible_frontend;
  if (parsed.data.visible_backend !== undefined) data.visibleBackend = parsed.data.visible_backend;

  const row = (await db.category.update({ where: { id }, data })) as CategoryRow;

  await safeAuditLog(db, {
    adminId: admin.sub,
    action: 'UPDATE',
    resource: 'category',
    resourceId: id,
    details: { changes: parsed.data },
  });

  logAdminCategoryCrud({
    route: '/api/v1/admin/categories/:id',
    method: 'PATCH',
    identifier: id,
    outcome: 'success',
    errorCode: null,
  });

  return success(c, toDto(row));
});

// DELETE /api/v1/admin/categories/:id — hard delete
//
// BUG-504-RC2: pre-check products.count(category_id) > 0 BEFORE calling
// db.category.delete to avoid Postgres P2003 (FK violation) leaking
// out as a generic 500 internal_error. The FK is ON DELETE RESTRICT
// against products.category_id by design — it must not be relaxed.
// We translate "category in use" into a clean 409 IN_USE envelope so
// the admin UI can render an actionable message and offer the
// visibility-toggle soft-delete path.
adminCategories.delete('/:id', requireRole('superadmin'), async (c) => {
  const db = getDb();
  const admin = getAdmin(c);
  const id = c.req.param('id');

  const existing = (await db.category.findUnique({ where: { id } })) as CategoryRow | null;
  if (!existing) {
    logAdminCategoryCrud({
      route: '/api/v1/admin/categories/:id',
      method: 'DELETE',
      identifier: id,
      outcome: 'not_found',
      errorCode: 'NOT_FOUND',
    });
    return error(c, 404, 'NOT_FOUND', 'Category not found');
  }

  // BUG-504-RC2 + BUG-505-A01 pre-check — short-circuit the FK
  // violation path on ACTIVE rows only.
  //
  // Soft-deleted products keep their `category_id` so Restore can put
  // them back on their original category. Counting those tombstones
  // against the category was BUG-505-A01: owners hit `409 IN_USE`
  // even after soft-deleting every active product. The fix narrows
  // the count to `deletedAt: null` rows, which is the same predicate
  // the rest of the admin products surface uses to mean "live row".
  const productsCount = await db.product.count({
    where: { categoryId: id, deletedAt: null },
  });
  if (productsCount > 0) {
    logAdminCategoryCrud({
      route: '/api/v1/admin/categories/:id',
      method: 'DELETE',
      identifier: id,
      outcome: 'in_use_blocked',
      errorCode: 'IN_USE',
      details: { products_count: productsCount, slug: existing.slug },
    });
    return error(
      c,
      409,
      'IN_USE',
      `Cannot delete category "${existing.slug}": ${productsCount} product(s) still reference it. Reassign the products first or hide the category via the visibility toggles.`,
      { products_count: productsCount, slug: existing.slug },
    );
  }

  // BUG-505-A01 — clear `category_id` on soft-deleted tombstones
  // BEFORE the category.delete call. The FK is `ON DELETE RESTRICT`,
  // so without this update the tombstones would block the delete
  // with a P2003 even though no live row references the category.
  //
  // Why $executeRaw instead of `db.product.updateMany`: the DB
  // column `products.category_id` is nullable (BUG-504-A06 step
  // 1/3 added it as `UUID NULL`) but the Prisma schema still types
  // it as `String` (required) because every live product has a
  // value. `updateMany({ data: { categoryId: null } })` would not
  // typecheck. A raw UPDATE is the smallest possible change that
  // respects the schema-untouched constraint of this atom and is
  // bounded to soft-deleted tombstones for the specific category
  // about to be deleted.
  await db.$executeRaw`
    UPDATE "products"
       SET "category_id" = NULL
     WHERE "category_id" = ${id}::uuid
       AND "deleted_at" IS NOT NULL
  `;

  await db.category.delete({ where: { id } });

  await safeAuditLog(db, {
    adminId: admin.sub,
    action: 'DELETE',
    resource: 'category',
    resourceId: id,
    details: { slug: existing.slug },
  });

  logAdminCategoryCrud({
    route: '/api/v1/admin/categories/:id',
    method: 'DELETE',
    identifier: id,
    outcome: 'success',
    errorCode: null,
    details: { slug: existing.slug },
  });

  return c.body(null, 204);
});

export default adminCategories;
