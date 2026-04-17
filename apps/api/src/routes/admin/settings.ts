import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getDb } from '../../lib/db';
import { success, created, error } from '../../lib/response';
import { getAdmin, requireRole } from '../../middleware/auth';
import { sendCustomNotification } from '../../lib/notifications';

const adminSettings = new Hono();

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

  const updated = await db.systemConfig.update({
    where: { key },
    data: { value: parsed.data.value },
  });

  await db.auditLog.create({
    data: {
      adminId: admin.sub,
      action: 'UPDATE',
      resource: 'system_config',
      resourceId: updated.id,
      details: { key, old_value: existing.value, new_value: parsed.data.value },
    },
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

  await db.auditLog.create({
    data: {
      adminId: admin.sub,
      action: 'CREATE',
      resource: 'system_config',
      resourceId: cfg.id,
      details: { key: cfg.key, value: cfg.value },
    },
  });

  return created(c, { id: cfg.id, key: cfg.key, value: cfg.value, label: cfg.label, group: cfg.group });
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

adminSettings.post('/users', requireRole('superadmin'), async (c) => {
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

  await db.auditLog.create({
    data: {
      adminId: admin.sub,
      action: 'CREATE',
      resource: 'admin_user',
      resourceId: user.id,
      details: { email: user.email, role: user.role },
    },
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

  await db.auditLog.create({
    data: {
      adminId: admin.sub,
      action: 'UPDATE',
      resource: 'admin_user',
      resourceId: id,
      details: { fields_updated: Object.keys(updateData).filter((k) => k !== 'passwordHash') },
    },
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

  await db.auditLog.create({
    data: {
      adminId: admin.sub,
      action: 'DELETE',
      resource: 'admin_user',
      resourceId: id,
      details: { email: existing.email },
    },
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
    ip_address: log.ipAddress,
    created_at: log.createdAt.toISOString(),
  })), {
    page,
    per_page: perPage,
    total,
    total_pages: Math.ceil(total / perPage),
  });
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

export default adminSettings;
