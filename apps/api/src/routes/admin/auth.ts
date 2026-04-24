import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { getDb } from '../../lib/db';
import { success, error } from '../../lib/response';
import { createToken, requireAuth, requireRole } from '../../middleware/auth';
import { rateLimit, clearRateLimit } from '../../middleware/rate-limit';

interface RateLimitKVBinding {
  get: (key: string) => Promise<string | null>;
  put: (
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ) => Promise<void>;
  delete: (key: string) => Promise<void>;
}

const auth = new Hono();

// A-AUTH: POST /api/v1/admin/auth/login
auth.post('/login', rateLimit(5, 15), async (c) => {
  const db = getDb();

  const body = await c.req.json().catch(() => null);
  if (!body?.email || !body?.password) {
    return error(c, 400, 'VALIDATION_ERROR', 'Email and password are required');
  }

  const admin = await db.adminUser.findUnique({
    where: { email: body.email },
  });

  if (!admin) {
    return error(c, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const passwordValid = await bcrypt.compare(body.password, admin.passwordHash);
  if (!passwordValid) {
    return error(c, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  // Update last login
  await db.adminUser.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date() },
  });

  const token = await createToken(admin.id, admin.email, admin.role);

  return success(c, {
    access_token: token,
    token_type: 'Bearer',
    expires_in: 8 * 3600,
    admin: {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
    },
  });
});

// BUG-AUTH operator escape hatch — superadmin-only KV reset path for a
// specific IP's /login rate-limit counter. Enables clearing a real
// lockout without a full Worker redeploy. Path-scoped to
// /api/v1/admin/auth/login to match the key `rateLimit` writes.
auth.delete('/rate-limit/:ip', requireAuth, requireRole('superadmin'), async (c) => {
  const ip = c.req.param('ip');
  if (!ip || ip.length === 0) {
    return error(c, 400, 'VALIDATION_ERROR', 'IP parameter is required');
  }

  const kv = (c.env as { RATE_LIMIT_KV?: RateLimitKVBinding } | undefined)
    ?.RATE_LIMIT_KV;

  await clearRateLimit(ip, '/api/v1/admin/auth/login', kv);

  return success(c, {
    cleared: true,
    ip,
    path: '/api/v1/admin/auth/login',
    backend: kv ? 'kv' : 'memory',
  });
});

export default auth;
