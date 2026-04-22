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
import { getDb } from '../../lib/db';
import { success, created, error } from '../../lib/response';
import { getAdmin, requireRole } from '../../middleware/auth';

const adminCategories = new Hono();

adminCategories.onError((_err, c) => {
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
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid category data', parsed.error.flatten());
  }

  const existing = (await db.category.findUnique({ where: { id } })) as CategoryRow | null;
  if (!existing) {
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

  return success(c, toDto(row));
});

// DELETE /api/v1/admin/categories/:id — hard delete
adminCategories.delete('/:id', requireRole('superadmin'), async (c) => {
  const db = getDb();
  const admin = getAdmin(c);
  const id = c.req.param('id');

  const existing = (await db.category.findUnique({ where: { id } })) as CategoryRow | null;
  if (!existing) {
    return error(c, 404, 'NOT_FOUND', 'Category not found');
  }

  await db.category.delete({ where: { id } });

  await safeAuditLog(db, {
    adminId: admin.sub,
    action: 'DELETE',
    resource: 'category',
    resourceId: id,
    details: { slug: existing.slug },
  });

  return c.body(null, 204);
});

export default adminCategories;
