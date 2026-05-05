import { Hono } from 'hono';
import type { Context } from 'hono';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { getDb } from '../../lib/db';
import { success, created, error } from '../../lib/response';
import { getAdmin, requireRole } from '../../middleware/auth';
import { sendCustomNotification } from '../../lib/notifications';

const adminSettings = new Hono();

// Helper: log audit event without blocking the main operation (handles schema drift gracefully)
async function safeAuditLog(db: ReturnType<typeof getDb>, data: Parameters<ReturnType<typeof getDb>['auditLog']['create']>[0]['data']) {
  try {
    await db.auditLog.create({ data });
  } catch {
    // Audit log is non-critical; swallow errors from schema drift (e.g. missing ip_address column)
  }
}

// ─── SYSTEM CONFIG ──────────────────────────────────────────────────────────

// GET /api/v1/admin/settings/config
adminSettings.get('/config', async (c) => {
  const db = getDb();
  const configs = await db.systemConfig.findMany({ orderBy: { group: 'asc' } });
  return success(c, configs.map((cfg) => ({
    id: cfg.id,
    key: cfg.key,
    value: cfg.value,
    label: cfg.label,
    group: cfg.group,
  })));
});

// PATCH /api/v1/admin/settings/config/:key
const updateConfigSchema = z.object({ value: z.string() });

adminSettings.patch('/config/:key', async (c) => {
  const db = getDb();
  const admin = getAdmin(c);
  const key = c.req.param('key');
  const body = await c.req.json().catch(() => null);
  const parsed = updateConfigSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten());
  }

  const existing = await db.systemConfig.findUnique({ where: { key } });
  if (!existing) {
    return error(c, 404, 'NOT_FOUND', `Config key "${key}" not found`);
  }

  // FEAT-404: Validate wash_duration_days as integer >= 1
  if (key === 'wash_duration_days') {
    const numVal = Number(parsed.data.value);
    if (!Number.isInteger(numVal) || numVal < 1) {
      return error(c, 400, 'VALIDATION_ERROR', 'wash_duration_days must be an integer >= 1');
    }
  }

  const updated = await db.systemConfig.update({
    where: { key },
    data: { value: parsed.data.value },
  });

  await safeAuditLog(db, {
    adminId: admin.sub,
    action: 'UPDATE',
    resource: 'system_config',
    resourceId: updated.id,
    details: { key, old_value: existing.value, new_value: parsed.data.value },
  });

  return success(c, { id: updated.id, key: updated.key, value: updated.value, label: updated.label, group: updated.group });
});

// POST /api/v1/admin/settings/config (create new config entry)
const createConfigSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string(),
  label: z.string().optional(),
  group: z.string().default('general'),
});

adminSettings.post('/config', requireRole('superadmin'), async (c) => {
  const db = getDb();
  const admin = getAdmin(c);
  const body = await c.req.json().catch(() => null);
  const parsed = createConfigSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten());
  }

  const existing = await db.systemConfig.findUnique({ where: { key: parsed.data.key } });
  if (existing) {
    return error(c, 409, 'CONFLICT', `Config key "${parsed.data.key}" already exists`);
  }

  const cfg = await db.systemConfig.create({ data: parsed.data });

  await safeAuditLog(db, {
    adminId: admin.sub,
    action: 'CREATE',
    resource: 'system_config',
    resourceId: cfg.id,
    details: { key: cfg.key, value: cfg.value },
  });

  return created(c, { id: cfg.id, key: cfg.key, value: cfg.value, label: cfg.label, group: cfg.group });
});

// ─── SYSTEM CONFIG — BATCH UPSERT (allow-list) ────────────────────────────
//
// POST /api/v1/admin/settings/config/batch
//
// Additive endpoint powering the redesigned grouped System Config UI (#31).
// Upserts one or more well-known config keys in a single call and records
// one audit log entry per key that actually changed. Only keys matching the
// server-side allow-list are accepted — unknown keys return 400 so the
// generic free-form "+ Add Config" flow stays confined to POST /config
// (superadmin-only).

// BUG-AUDIT-UI-A01: exported so the audit-log read handler (and any
// future consumer that needs to map a SystemConfig key to its UX
// section) can derive `section` without duplicating the allow-list.
export const FIXED_ALLOWED_KEYS: Record<string, { label: string; group: string }> = {
  late_return_fee: { label: 'Late Return Fee (THB/day)', group: 'finance' },
  shipping_duration_days: { label: 'Shipping Duration (days)', group: 'calendar' },
  wash_duration_days: { label: 'Wash Duration (days)', group: 'calendar' },
  origin_province: { label: 'Origin Province', group: 'shipping' },
  // Customer UX (#31 follow-up) — admin config + storage only; no customer
  // flow enforcement yet (tracked in separate issue).
  min_rental_days: { label: 'Minimum Rental Days', group: 'customer_ux' },
  max_rental_days: { label: 'Maximum Rental Days', group: 'customer_ux' },
  booking_buffer_days: { label: 'Booking Buffer Days', group: 'customer_ux' },
  min_advance_booking_days: { label: 'Minimum Advance Booking Days', group: 'customer_ux' },
  // Global free-shipping toggle (#36). Stored as the string "true" / "false";
  // when "false", all orders compute shipping_cost = 0 while shipping_days
  // stays unchanged.
  shipping_fee_enabled: { label: 'Charge Shipping Fee', group: 'shipping' },
  // Editable rental terms displayed on customer checkout Step 2.
  // BUG-503: per-locale keys so admins can edit each language independently.
  rental_terms: { label: 'Rental Terms (Thai)', group: 'customer_ux' },
  rental_terms_en: { label: 'Rental Terms (English)', group: 'customer_ux' },
  rental_terms_zh: { label: 'Rental Terms (Chinese)', group: 'customer_ux' },
};

const SHIPPING_DAYS_KEY_RE = /^shipping_days_[A-Z0-9]{2,10}$/;

function resolveAllowedKey(key: string): { label: string; group: string } | null {
  if (FIXED_ALLOWED_KEYS[key]) return FIXED_ALLOWED_KEYS[key];
  if (SHIPPING_DAYS_KEY_RE.test(key)) {
    const code = key.slice('shipping_days_'.length);
    return { label: `Shipping Days — ${code}`, group: 'shipping' };
  }
  return null;
}

// BUG-AUDIT-UI-A01: thin wrapper around `resolveAllowedKey` exposing
// just the group. Null-tolerant so callers can pipe `details.key`
// (which may be `undefined` on non-config audit rows) without a
// pre-check. Used by the audit-log read handler to derive `section`
// per row and to translate `?section=<group>` filters into the matching
// key allow-list for the Prisma JSON-path where-clause.
export function resolveGroup(key: string | null | undefined): string | null {
  if (typeof key !== 'string' || key.length === 0) return null;
  return resolveAllowedKey(key)?.group ?? null;
}

// BUG-AUDIT-UI-A01: invert the FIXED_ALLOWED_KEYS map so a `section`
// filter (e.g. `finance`) translates to its known keys. Excludes the
// `shipping_days_*` regex family because the audit log is keyed on the
// concrete province code, not the regex; those rows still surface
// under section=`shipping` via the row-level `resolveGroup` derivation,
// just not via the explicit `in` filter.
function keysForSection(section: string): string[] {
  return Object.entries(FIXED_ALLOWED_KEYS)
    .filter(([, v]) => v.group === section)
    .map(([k]) => k);
}

function validateConfigValue(key: string, value: string): string | null {
  if (key === 'late_return_fee') {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 'late_return_fee must be a number >= 0';
    return null;
  }
  if (
    key === 'shipping_duration_days' ||
    key === 'wash_duration_days' ||
    key === 'min_rental_days' ||
    key === 'max_rental_days' ||
    SHIPPING_DAYS_KEY_RE.test(key)
  ) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) return `${key} must be an integer >= 1`;
    return null;
  }
  if (key === 'booking_buffer_days' || key === 'min_advance_booking_days') {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) return `${key} must be an integer >= 0`;
    return null;
  }
  if (key === 'origin_province') {
    if (!/^[A-Z0-9]{2,10}$/.test(value)) return 'origin_province must be a short uppercase province code';
    return null;
  }
  if (key === 'shipping_fee_enabled') {
    if (value !== 'true' && value !== 'false') return 'shipping_fee_enabled must be "true" or "false"';
    return null;
  }
  return null;
}

const batchUpdateSchema = z.object({
  updates: z.record(z.string(), z.string()),
});

adminSettings.post('/config/batch', async (c) => {
  const db = getDb();
  const admin = getAdmin(c);
  const body = await c.req.json().catch(() => null);
  const parsed = batchUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten());
  }

  const entries = Object.entries(parsed.data.updates);
  if (entries.length === 0) {
    return success(c, { updated: [], skipped: [] });
  }

  // Validate every key up front — reject the whole batch if anything is bad.
  const fieldErrors: Record<string, string> = {};
  for (const [key, value] of entries) {
    const meta = resolveAllowedKey(key);
    if (!meta) {
      fieldErrors[key] = `Config key "${key}" is not in the allow-list`;
      continue;
    }
    const verr = validateConfigValue(key, value);
    if (verr) fieldErrors[key] = verr;
  }
  if (Object.keys(fieldErrors).length > 0) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid config values', { fieldErrors });
  }

  // Cross-field check: max_rental_days must be >= min_rental_days in the
  // effective post-batch state (DB value for whichever side isn't in the
  // payload).
  const batchMap = new Map(entries);
  if (batchMap.has('min_rental_days') || batchMap.has('max_rental_days')) {
    const readNum = async (key: string): Promise<number | null> => {
      if (batchMap.has(key)) return Number(batchMap.get(key));
      const row = await db.systemConfig.findUnique({ where: { key } });
      if (!row || typeof row.value !== 'string') return null;
      const n = Number(row.value);
      return Number.isFinite(n) ? n : null;
    };
    const minDays = await readNum('min_rental_days');
    const maxDays = await readNum('max_rental_days');
    if (minDays != null && maxDays != null && maxDays < minDays) {
      return error(c, 400, 'VALIDATION_ERROR', 'Invalid config values', {
        fieldErrors: {
          max_rental_days: `max_rental_days (${maxDays}) must be >= min_rental_days (${minDays})`,
        },
      });
    }
  }

  const updated: Array<{ id: string; key: string; value: unknown; label: string | null; group: string | null }> = [];
  const skipped: string[] = [];

  for (const [key, value] of entries) {
    const meta = resolveAllowedKey(key);
    if (!meta) continue; // unreachable due to validation above
    const existing = await db.systemConfig.findUnique({ where: { key } });
    if (existing) {
      if (typeof existing.value === 'string' && existing.value === value) {
        skipped.push(key);
        continue;
      }
      const row = await db.systemConfig.update({
        where: { key },
        data: { value },
      });
      await safeAuditLog(db, {
        adminId: admin.sub,
        action: 'UPDATE',
        resource: 'system_config',
        resourceId: row.id,
        details: { key, old_value: existing.value as Prisma.InputJsonValue, new_value: value },
      });
      updated.push({ id: row.id, key: row.key, value: row.value, label: row.label, group: row.group });
    } else {
      const row = await db.systemConfig.create({
        data: { key, value, label: meta.label, group: meta.group },
      });
      await safeAuditLog(db, {
        adminId: admin.sub,
        action: 'CREATE',
        resource: 'system_config',
        resourceId: row.id,
        details: { key, value },
      });
      updated.push({ id: row.id, key: row.key, value: row.value, label: row.label, group: row.group });
    }
  }

  return success(c, { updated, skipped });
});

// ─── ADMIN USER MANAGEMENT ─────────────────────────────────────────────────

// GET /api/v1/admin/settings/users
adminSettings.get('/users', async (c) => {
  const db = getDb();
  const users = await db.adminUser.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, email: true, name: true, role: true, lastLoginAt: true, createdAt: true },
  });
  return success(c, users);
});

// POST /api/v1/admin/settings/users (create admin user)
const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
  role: z.enum(['superadmin', 'staff']).default('staff'),
});

adminSettings.post('/users', async (c) => {
  const db = getDb();
  const admin = getAdmin(c);
  const body = await c.req.json().catch(() => null);
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten());
  }

  const existing = await db.adminUser.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return error(c, 409, 'CONFLICT', 'Email already registered');
  }

  const hash = await bcrypt.hash(parsed.data.password, 10);
  const user = await db.adminUser.create({
    data: {
      email: parsed.data.email,
      passwordHash: hash,
      name: parsed.data.name,
      role: parsed.data.role,
    },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });

  await safeAuditLog(db, {
    adminId: admin.sub,
    action: 'CREATE',
    resource: 'admin_user',
    resourceId: user.id,
    details: { email: user.email, role: user.role },
  });

  return created(c, user);
});

// PATCH /api/v1/admin/settings/users/:id
const updateUserSchema = z.object({
  name: z.string().optional(),
  role: z.enum(['superadmin', 'staff']).optional(),
  password: z.string().min(8).optional(),
});

adminSettings.patch('/users/:id', requireRole('superadmin'), async (c) => {
  const db = getDb();
  const admin = getAdmin(c);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten());
  }

  const existing = await db.adminUser.findUnique({ where: { id } });
  if (!existing) {
    return error(c, 404, 'NOT_FOUND', 'Admin user not found');
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.role !== undefined) updateData.role = parsed.data.role;
  if (parsed.data.password) updateData.passwordHash = await bcrypt.hash(parsed.data.password, 10);

  const updated = await db.adminUser.update({
    where: { id },
    data: updateData,
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });

  await safeAuditLog(db, {
    adminId: admin.sub,
    action: 'UPDATE',
    resource: 'admin_user',
    resourceId: id,
    details: { fields_updated: Object.keys(updateData).filter((k) => k !== 'passwordHash') },
  });

  return success(c, updated);
});

// DELETE /api/v1/admin/settings/users/:id
adminSettings.delete('/users/:id', requireRole('superadmin'), async (c) => {
  const db = getDb();
  const admin = getAdmin(c);
  const id = c.req.param('id');

  if (id === admin.sub) {
    return error(c, 400, 'SELF_DELETE', 'Cannot delete your own account');
  }

  const existing = await db.adminUser.findUnique({ where: { id } });
  if (!existing) {
    return error(c, 404, 'NOT_FOUND', 'Admin user not found');
  }

  await db.adminUser.delete({ where: { id } });

  await safeAuditLog(db, {
    adminId: admin.sub,
    action: 'DELETE',
    resource: 'admin_user',
    resourceId: id,
    details: { email: existing.email },
  });

  return success(c, { deleted: true });
});

// ─── AUDIT LOG ──────────────────────────────────────────────────────────────

// GET /api/v1/admin/settings/audit-log
//
// BUG-504-A08 extended the query surface so A06.5 drift-detection
// events can be queried without hitting the database directly. New
// params (all optional, additive):
//   • action=<string>           — exact filter on log.action
//   • resource=<string>         — exact filter on log.resource
//   • since=<ISO8601>           — createdAt >= since (inclusive)
//   • limit=<1..100>            — alias for per_page (takes precedence
//                                 when both are provided, matches the
//                                 audit-forensic convention)
//   • page=<int>                — 1-based (unchanged)
//
// The response preserves the existing admin-UI shape (admin_email,
// admin_name, resource_id, details, created_at, ip_address) and adds
// the A08 forensic aliases (actor_id, payload, detected_at) alongside
// them so both the /settings?tab=audit UI and a forensic consumer can
// read the same payload without a transform layer.
adminSettings.get('/audit-log', requireRole('superadmin'), async (c) => {
  const db = getDb();
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1'));
  const rawLimit =
    c.req.query('pageSize') ??
    c.req.query('per_page') ??
    c.req.query('limit') ??
    '50';
  const perPage = Math.min(100, Math.max(1, parseInt(rawLimit)));
  const resource = c.req.query('resource');
  const action = c.req.query('action');
  const sinceRaw = c.req.query('since');
  const fromRaw = c.req.query('from');
  const toRaw = c.req.query('to');
  const actor = c.req.query('actor');
  const sectionsRaw = c.req.queries('section') ?? [];
  const qRaw = c.req.query('q');

  // BUG-AUDIT-UI-A01: validate every ISO 8601 input with the same
  // pattern A08 used for `since`. Each malformed value short-circuits
  // before hitting the DB so we don't pay a round-trip on garbage.
  function parseIsoOr400(name: string, raw: string | undefined) {
    if (!raw) return undefined;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return { __err: name, raw };
    return parsed;
  }
  const sinceParsed = parseIsoOr400('since', sinceRaw);
  if (sinceParsed && '__err' in sinceParsed) {
    return error(c, 400, 'VALIDATION_ERROR', '`since` must be a valid ISO 8601 timestamp', { since: sinceRaw });
  }
  const fromParsed = parseIsoOr400('from', fromRaw);
  if (fromParsed && '__err' in fromParsed) {
    return error(c, 400, 'VALIDATION_ERROR', '`from` must be a valid ISO 8601 timestamp', { from: fromRaw });
  }
  const toParsed = parseIsoOr400('to', toRaw);
  if (toParsed && '__err' in toParsed) {
    return error(c, 400, 'VALIDATION_ERROR', '`to` must be a valid ISO 8601 timestamp', { to: toRaw });
  }
  const sinceDate = sinceParsed instanceof Date ? sinceParsed : undefined;
  const fromDate = fromParsed instanceof Date ? fromParsed : undefined;
  const toDate = toParsed instanceof Date ? toParsed : undefined;

  // BUG-AUDIT-UI-A01: default 7-day window when no temporal filter is
  // supplied. Explicit `since`, `from`, or `to` always wins.
  const lowerBound = fromDate ?? sinceDate ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const where: Record<string, unknown> = {};
  if (resource) where.resource = resource;
  if (action) where.action = action;
  const createdAt: { gte?: Date; lte?: Date } = { gte: lowerBound };
  if (toDate) createdAt.lte = toDate;
  where.createdAt = createdAt;
  if (actor) where.adminId = actor;

  // BUG-AUDIT-UI-A01: section filter — translate group → key OR-list
  // via `keysForSection`. Multiple `?section=` params union together.
  // Skipped silently when the group resolves to no concrete keys (e.g.
  // a typo) so the request still returns a useful empty page rather
  // than a 4xx the UI can't act on.
  const andClauses: Array<Record<string, unknown>> = [];
  if (sectionsRaw.length > 0) {
    const allKeys = sectionsRaw.flatMap((s) => keysForSection(s));
    if (allKeys.length > 0) {
      andClauses.push({
        OR: allKeys.map((k) => ({
          details: { path: ['key'], equals: k },
        })),
      });
    } else {
      // unknown section(s) — return empty page deterministically
      andClauses.push({ id: '__no_match__' });
    }
  }

  // BUG-AUDIT-UI-A01: free-text search on `details.key`. Capped at
  // 100 chars belt-and-suspenders. Prisma JsonFilter is parameterized,
  // so no injection risk; case-sensitivity matches the Postgres ->>'
  // operator default. Section dropdown is the typical discovery path.
  if (qRaw) {
    const q = qRaw.slice(0, 100);
    andClauses.push({
      details: { path: ['key'], string_contains: q },
    });
  }
  if (andClauses.length > 0) where.AND = andClauses;

  // Defensively truncate string `old_value` / `new_value` so a
  // pathological payload can't bloat the response.
  function truncate(v: unknown): unknown {
    if (typeof v === 'string' && v.length > 500) return v.slice(0, 500) + '…';
    return v;
  }

  // Wrap in try-catch to handle schema drift (e.g. missing ip_address column)
  try {
    const [logs, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        include: { admin: { select: { id: true, email: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      db.auditLog.count({ where }),
    ]);

    return success(c, logs.map((log) => {
      const details = (log.details ?? null) as Record<string, unknown> | null;
      const key = typeof details?.key === 'string' ? details.key : null;
      return {
        id: log.id,
        admin_email: log.admin?.email ?? 'system',
        admin_name: log.admin?.name ?? 'System',
        // BUG-504-A08 forensic aliases — coexist with the UI fields
        // above so neither consumer needs a transform layer.
        actor_id: log.admin?.id ?? log.adminId ?? null,
        action: log.action,
        resource: log.resource,
        resource_id: log.resourceId,
        details,
        payload: details,
        // BUG-AUDIT-UI-A01: per-row UI conveniences. `section` is
        // null on non-config rows; UI renders "—".
        key,
        section: resolveGroup(key),
        old_value: truncate(details?.old_value),
        new_value: truncate(details?.new_value),
        ip_address: (log as Record<string, unknown>).ipAddress ?? null,
        created_at: log.createdAt.toISOString(),
        detected_at: log.createdAt.toISOString(),
      };
    }), {
      page,
      per_page: perPage,
      pageSize: perPage,
      limit: perPage,
      total,
      count: total,
      total_pages: Math.ceil(total / perPage),
    });
  } catch {
    // Schema drift: return empty audit log rather than crashing
    return success(c, [], {
      page,
      per_page: perPage,
      pageSize: perPage,
      limit: perPage,
      total: 0,
      count: 0,
      total_pages: 0,
    });
  }
});

// POST /api/v1/admin/settings/audit-log — client-posted audit events
// (BUG-504-A06.5). Narrow action whitelist: admin clients may only emit
// the drift-detection event. Server-side audit writes still go through
// `safeAuditLog` inline in the relevant mutation handlers; this POST is
// *only* for passive client-side observations.
const postAuditLogSchema = z.object({
  action: z.enum(['category.drift_detected']),
  resource: z.literal('categories'),
  resource_id: z.string().nullable().optional(),
  details: z.record(z.unknown()),
});

adminSettings.post('/audit-log', async (c) => {
  const db = getDb();
  const admin = getAdmin(c);
  const body = await c.req.json().catch(() => null);
  const parsed = postAuditLogSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid audit log payload', parsed.error.flatten());
  }

  await safeAuditLog(db, {
    adminId: admin.sub,
    action: parsed.data.action,
    resource: parsed.data.resource,
    resourceId: parsed.data.resource_id ?? null,
    details: parsed.data.details as Prisma.InputJsonValue,
  });

  return success(c, { recorded: true });
});

// ─── NOTIFICATIONS ──────────────────────────────────────────────────────────

// GET /api/v1/admin/settings/notifications
adminSettings.get('/notifications', async (c) => {
  const db = getDb();
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1'));
  const perPage = Math.min(100, Math.max(1, parseInt(c.req.query('per_page') ?? '30')));
  const channel = c.req.query('channel');
  const status = c.req.query('status');

  const where: Record<string, unknown> = {};
  if (channel) where.channel = channel;
  if (status) where.status = status;

  const [logs, total] = await Promise.all([
    db.notificationLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    db.notificationLog.count({ where }),
  ]);

  return success(c, logs.map((log) => ({
    id: log.id,
    order_id: log.orderId,
    customer_id: log.customerId,
    channel: log.channel,
    recipient: log.recipient,
    subject: log.subject,
    body: log.body,
    status: log.status,
    error_message: log.errorMessage,
    created_at: log.createdAt.toISOString(),
  })), {
    page,
    per_page: perPage,
    total,
    total_pages: Math.ceil(total / perPage),
  });
});

// POST /api/v1/admin/settings/notifications/send
const sendNotificationSchema = z.object({
  channel: z.enum(['email', 'line', 'sms']),
  recipient: z.string().min(1),
  subject: z.string().optional(),
  body: z.string().min(1),
  order_id: z.string().uuid().optional(),
  customer_id: z.string().uuid().optional(),
});

adminSettings.post('/notifications/send', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = sendNotificationSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid notification data', parsed.error.flatten());
  }

  const result = await sendCustomNotification({
    channel: parsed.data.channel,
    recipient: parsed.data.recipient,
    subject: parsed.data.subject,
    body: parsed.data.body,
    orderId: parsed.data.order_id,
    customerId: parsed.data.customer_id,
  });

  return created(c, result);
});

// ─── CATEGORY MANAGEMENT ────────────────────────────────────────────────────
//
// BUG-504-A04: these endpoints are DEPRECATED in favour of the A03
// DB-backed `/api/v1/admin/categories` router. Body shapes are frozen
// for the last release cycle; every response carries RFC 8594
// `Deprecation` / `Sunset` / `Link` advisory headers so consumers can
// discover the successor. Full removal is scheduled for BUG-504-A06.

// Six months out (≫ 30-day migration buffer required by the A04 gate).
const LEGACY_SUNSET_MS = 180 * 24 * 60 * 60 * 1000;

function applyLegacyCategoriesDeprecation(c: Context): void {
  const sunset = new Date(Date.now() + LEGACY_SUNSET_MS).toUTCString();
  c.header('Deprecation', 'true');
  c.header('Sunset', sunset);
  c.header(
    'Link',
    '</api/v1/admin/categories>; rel="successor-version"',
  );
}

// GET /api/v1/admin/settings/categories
adminSettings.get('/categories', async (c) => {
  const db = getDb();
  const cfg = await db.systemConfig.findUnique({ where: { key: 'product_categories' } });
  const defaults = ['wedding', 'evening', 'cocktail', 'casual', 'costume', 'traditional', 'accessories'];
  const categories: string[] = cfg ? (Array.isArray(cfg.value) ? cfg.value as string[] : defaults) : defaults;
  applyLegacyCategoriesDeprecation(c);
  return success(c, categories);
});

// PUT /api/v1/admin/settings/categories
const updateCategoriesSchema = z.object({
  categories: z.array(z.string().min(1)).min(1),
});

adminSettings.put('/categories', requireRole('superadmin'), async (c) => {
  const db = getDb();
  const admin = getAdmin(c);
  const body = await c.req.json().catch(() => null);
  const parsed = updateCategoriesSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten());
  }

  const cfg = await db.systemConfig.upsert({
    where: { key: 'product_categories' },
    update: { value: parsed.data.categories as unknown as Prisma.InputJsonValue },
    create: { key: 'product_categories', value: parsed.data.categories as unknown as Prisma.InputJsonValue, label: 'Product Categories', group: 'products' },
  });

  await safeAuditLog(db, {
    adminId: admin.sub,
    action: 'UPDATE',
    resource: 'system_config',
    resourceId: cfg.id,
    details: { key: 'product_categories', categories: parsed.data.categories },
  });

  applyLegacyCategoriesDeprecation(c);
  return success(c, parsed.data.categories);
});

// DELETE /api/v1/admin/settings/categories/:name — Delete category (check products first)
adminSettings.delete('/categories/:name', requireRole('superadmin'), async (c) => {
  const db = getDb();
  const admin = getAdmin(c);
  const name = c.req.param('name');

  // Check if any products use this category (cast enum to text to allow non-enum category names)
  const countResult = await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) as count FROM products WHERE category::text = ${name}`;
  const count = Number(countResult[0]?.count ?? 0);
  if (count > 0) {
    return error(c, 409, 'CATEGORY_IN_USE', `Cannot delete category "${name}" — ${count} product(s) still use it. Reassign them first.`);
  }

  // Remove from the list
  const cfg = await db.systemConfig.findUnique({ where: { key: 'product_categories' } });
  const defaults = ['wedding', 'evening', 'cocktail', 'casual', 'costume', 'traditional', 'accessories'];
  const categories: string[] = cfg ? (Array.isArray(cfg.value) ? cfg.value as string[] : defaults) : defaults;
  const updated = categories.filter((cat) => cat !== name);

  await db.systemConfig.upsert({
    where: { key: 'product_categories' },
    update: { value: updated as unknown as Prisma.InputJsonValue },
    create: { key: 'product_categories', value: updated as unknown as Prisma.InputJsonValue, label: 'Product Categories', group: 'products' },
  });

  await safeAuditLog(db, {
    adminId: admin.sub,
    action: 'DELETE',
    resource: 'category',
    resourceId: name,
    details: { deleted_category: name },
  });

  applyLegacyCategoriesDeprecation(c);
  return success(c, { deleted: true, category: name });
});

// ─── STORE ADDRESS ──────────────────────────────────────────────────────────

// GET /api/v1/admin/settings/store-addresses
adminSettings.get('/store-addresses', async (c) => {
  const db = getDb();
  const cfg = await db.systemConfig.findUnique({ where: { key: 'store_addresses' } });
  const addresses = cfg ? (Array.isArray(cfg.value) ? cfg.value : []) : [];
  return success(c, addresses);
});

// PUT /api/v1/admin/settings/store-addresses
const storeAddressSchema = z.object({
  addresses: z.array(z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    contact_person: z.string().optional(),
    phone: z.string().optional(),
    address_line: z.string().optional(),
    province: z.string().optional(),
    district: z.string().optional(),
    subdistrict: z.string().optional(),
    postal_code: z.string().optional(),
    note: z.string().optional(),
    is_primary: z.boolean().default(false),
  })),
});

adminSettings.put('/store-addresses', requireRole('superadmin'), async (c) => {
  const db = getDb();
  const admin = getAdmin(c);
  const body = await c.req.json().catch(() => null);
  const parsed = storeAddressSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten());
  }

  // Ensure IDs and exactly one primary
  const addresses = parsed.data.addresses.map((a, i) => ({
    ...a,
    id: a.id || `addr_${Date.now()}_${i}`,
  }));

  await db.systemConfig.upsert({
    where: { key: 'store_addresses' },
    update: { value: addresses as unknown as Prisma.InputJsonValue },
    create: { key: 'store_addresses', value: addresses as unknown as Prisma.InputJsonValue, label: 'Store Addresses', group: 'store' },
  });

  await safeAuditLog(db, {
    adminId: admin.sub,
    action: 'UPDATE',
    resource: 'system_config',
    resourceId: 'store_addresses',
    details: { count: addresses.length },
  });

  return success(c, addresses);
});

// ─── SHIPPING FEE TOGGLE (#36) ─────────────────────────────────────────────

// GET /api/v1/admin/settings/shipping/fee-toggle — current toggle state
adminSettings.get('/shipping/fee-toggle', async (c) => {
  const db = getDb();
  const row = await db.systemConfig.findUnique({ where: { key: 'shipping_fee_enabled' } });
  const raw = row?.value;
  let enabled = true;
  if (typeof raw === 'boolean') enabled = raw;
  else if (typeof raw === 'string') enabled = raw.toLowerCase() !== 'false';
  return success(c, { enabled });
});

// PATCH /api/v1/admin/settings/shipping/fee-toggle — flip the global toggle.
// When `enabled=false`, the shipping-cost calculation short-circuits to 0 for
// all orders while per-province shipping_days is preserved. Existing per-zone
// and per-province fee values in the DB are NOT modified — they remain ready
// to be restored instantly when the toggle flips back on.
const feeToggleSchema = z.object({ enabled: z.boolean() });

adminSettings.patch('/shipping/fee-toggle', async (c) => {
  const db = getDb();
  const admin = getAdmin(c);
  const body = await c.req.json().catch(() => null);
  const parsed = feeToggleSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten());
  }

  const newValue = parsed.data.enabled ? 'true' : 'false';

  const existing = await db.systemConfig.findUnique({ where: { key: 'shipping_fee_enabled' } });
  const oldValue = existing?.value ?? null;

  const row = await db.systemConfig.upsert({
    where: { key: 'shipping_fee_enabled' },
    update: { value: newValue },
    create: {
      key: 'shipping_fee_enabled',
      value: newValue,
      label: 'Charge Shipping Fee',
      group: 'shipping',
    },
  });

  // Audit log: shipping.fee_toggle.changed (per issue #36 spec).
  await safeAuditLog(db, {
    adminId: admin.sub,
    action: 'shipping.fee_toggle.changed',
    resource: 'system_config',
    resourceId: row.id,
    details: { key: 'shipping_fee_enabled', old_value: oldValue, new_value: newValue },
  });

  return success(c, { enabled: parsed.data.enabled });
});

export default adminSettings;
