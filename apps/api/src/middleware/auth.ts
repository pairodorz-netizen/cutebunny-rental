import { createMiddleware } from 'hono/factory';
import { sign, verify } from 'hono/jwt';
import type { AdminRole } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  email: string;
  role: AdminRole;
  exp: number;
  iat: number;
  [key: string]: unknown;
}

const JWT_EXPIRY_HOURS = 8;

export function getJwtSecret(): string {
  return process.env.JWT_SECRET || 'dev-secret-change-in-production';
}

export async function createToken(adminId: string, email: string, role: AdminRole): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    sub: adminId,
    email,
    role,
    iat: now,
    exp: now + JWT_EXPIRY_HOURS * 3600,
  };
  return await sign(payload, getJwtSecret());
}

export const requireAuth = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' } }, 401);
  }

  const token = authHeader.slice(7);
  try {
    const decoded = await verify(token, getJwtSecret(), 'HS256');
    const payload: JwtPayload = {
      sub: decoded.sub as string,
      email: decoded.email as string,
      role: decoded.role as AdminRole,
      exp: decoded.exp as number,
      iat: decoded.iat as number,
    };
    c.set('jwtPayload', payload);
    await next();
  } catch {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } }, 401);
  }
});

export function getAdmin(c: { get: (key: string) => unknown }): JwtPayload {
  return c.get('jwtPayload') as JwtPayload;
}

export const requireRole = (requiredRole: AdminRole) =>
  createMiddleware(async (c, next) => {
    const admin = c.get('jwtPayload') as JwtPayload | undefined;
    if (!admin) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }, 401);
    }
    if (requiredRole === 'superadmin' && admin.role !== 'superadmin') {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } }, 403);
    }
    await next();
  });
