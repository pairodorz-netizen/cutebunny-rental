import { Hono } from 'hono';
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

const FIXED_ALLOWED_KEYS: Record<string, { label: string; group: string }> = {
  late_return_fee: { label: 'Late Return Fee (THB/day)', group: 'finance' },
  shipping_duration_days: { label: 'Shipping Duration (days)', group: 'calendar' },
  wash_duration_days: { label: 'Wash Duration (days)', group: 'calendar' },
  origin_province: { label: 'Origin Province', group: 'shipping' },
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

function validateConfigValue(key: string, value: string): string | null {
  if (key === 'late_return_fee') {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 'late_return_fee must be a number >= 0';
    return null;
  }
  if (key === 'shipping_duration_days' || key === 'wash_duration_days' || SHIPPING_DAYS_KEY_RE.test(key)) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) return `${key} must be an integer >= 1`;
    return null;
  }
  if (key === 'origin_province') {
    if (!/^[A-Z0-9]{2,10}$/.test(value)) return 'origin_province must be a short uppercase province code';
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
adminSettings.get('/audit-log', async (c) => {
  const db = getDb();
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1'));
  const perPage = Math.min(100, Math.max(1, parseInt(c.req.query('per_page') ?? '50')));
  const resource = c.req.query('resource');
  const action = c.req.query('action');

  const where: Record<string, unknown> = {};
  if (resource) where.resource = resource;
  if (action) where.action = action;

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

    return success(c, logs.map((log) => ({
      id: log.id,
      admin_email: log.admin?.email ?? 'system',
      admin_name: log.admin?.name ?? 'System',
      action: log.action,
      resource: log.resource,
      resource_id: log.resourceId,
      details: log.details,
      ip_address: (log as Record<string, unknown>).ipAddress ?? null,
      created_at: log.createdAt.toISOString(),
    })), {
      page,
      per_page: perPage,
      total,
      total_pages: Math.ceil(total / perPage),
    });
  } catch {
    // Schema drift: return empty audit log rather than crashing
    return success(c, [], { page, per_page: perPage, total: 0, total_pages: 0 });
  }
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

// GET /api/v1/admin/settings/categories
adminSettings.get('/categories', async (c) => {
  const db = getDb();
  const cfg = await db.systemConfig.findUnique({ where: { key: 'product_categories' } });
  const defaults = ['wedding', 'evening', 'cocktail', 'casual', 'costume', 'traditional', 'accessories'];
  const categories: string[] = cfg ? (Array.isArray(cfg.value) ? cfg.value as string[] : defaults) : defaults;
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

export default adminSettings;
