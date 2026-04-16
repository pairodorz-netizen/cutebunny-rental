import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { getDb } from '../../lib/db';
import { success, error } from '../../lib/response';
import { createToken } from '../../middleware/auth';
import { rateLimit } from '../../middleware/rate-limit';

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

export default auth;
