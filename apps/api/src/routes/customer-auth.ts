import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { sign, verify } from 'hono/jwt';
import { z } from 'zod';
import { getDb } from '../lib/db';
import { success, created, error } from '../lib/response';
import { getEnv } from '../lib/env';
import { rateLimit } from '../middleware/rate-limit';

const customerAuth = new Hono();

function getJwtSecret(): string {
  return getEnv().JWT_SECRET || 'dev-secret-change-in-production';
}

async function createCustomerToken(customerId: string, email: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await sign({
    sub: customerId,
    email,
    type: 'customer',
    iat: now,
    exp: now + 30 * 24 * 3600, // 30 days
  }, getJwtSecret());
}

// POST /api/v1/customer/auth/register
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  phone: z.string().optional(),
});

customerAuth.post('/register', rateLimit(10, 15), async (c) => {
  const db = getDb();
  const body = await c.req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid registration data', parsed.error.flatten());
  }

  const existing = await db.customer.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return error(c, 409, 'CONFLICT', 'Email already registered');
  }

  const hash = await bcrypt.hash(parsed.data.password, 10);
  const customer = await db.customer.create({
    data: {
      email: parsed.data.email,
      passwordHash: hash,
      firstName: parsed.data.first_name,
      lastName: parsed.data.last_name,
      phone: parsed.data.phone,
    },
    select: { id: true, email: true, firstName: true, lastName: true, phone: true, tier: true, createdAt: true },
  });

  const token = await createCustomerToken(customer.id, customer.email);

  return created(c, {
    access_token: token,
    token_type: 'Bearer',
    customer: {
      id: customer.id,
      email: customer.email,
      first_name: customer.firstName,
      last_name: customer.lastName,
      phone: customer.phone,
      tier: customer.tier,
    },
  });
});

// POST /api/v1/customer/auth/login
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

customerAuth.post('/login', rateLimit(5, 15), async (c) => {
  const db = getDb();
  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid login data', parsed.error.flatten());
  }

  const customer = await db.customer.findUnique({ where: { email: parsed.data.email } });
  if (!customer || !customer.passwordHash) {
    return error(c, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const valid = await bcrypt.compare(parsed.data.password, customer.passwordHash);
  if (!valid) {
    return error(c, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const token = await createCustomerToken(customer.id, customer.email);

  return success(c, {
    access_token: token,
    token_type: 'Bearer',
    customer: {
      id: customer.id,
      email: customer.email,
      first_name: customer.firstName,
      last_name: customer.lastName,
      phone: customer.phone,
      tier: customer.tier,
    },
  });
});

// GET /api/v1/customer/auth/me (requires customer token)
customerAuth.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return error(c, 401, 'UNAUTHORIZED', 'Missing authorization');
  }

  try {
    const decoded = await verify(authHeader.slice(7), getJwtSecret(), 'HS256');
    if (decoded.type !== 'customer') {
      return error(c, 401, 'UNAUTHORIZED', 'Invalid token type');
    }

    const db = getDb();
    const customer = await db.customer.findUnique({
      where: { id: decoded.sub as string },
      select: {
        id: true, email: true, firstName: true, lastName: true, phone: true,
        tier: true, rentalCount: true, totalPayment: true, creditBalance: true,
        address: true, createdAt: true,
      },
    });

    if (!customer) {
      return error(c, 404, 'NOT_FOUND', 'Customer not found');
    }

    return success(c, {
      id: customer.id,
      email: customer.email,
      first_name: customer.firstName,
      last_name: customer.lastName,
      phone: customer.phone,
      tier: customer.tier,
      rental_count: customer.rentalCount,
      total_payment: customer.totalPayment,
      credit_balance: customer.creditBalance,
      address: customer.address,
      created_at: customer.createdAt.toISOString(),
    });
  } catch {
    return error(c, 401, 'UNAUTHORIZED', 'Invalid or expired token');
  }
});

// GET /api/v1/customer/auth/orders (customer's order history)
customerAuth.get('/orders', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return error(c, 401, 'UNAUTHORIZED', 'Missing authorization');
  }

  try {
    const decoded = await verify(authHeader.slice(7), getJwtSecret(), 'HS256');
    if (decoded.type !== 'customer') {
      return error(c, 401, 'UNAUTHORIZED', 'Invalid token type');
    }

    const db = getDb();
    const orders = await db.order.findMany({
      where: { customerId: decoded.sub as string },
      include: {
        items: {
          include: { product: { select: { thumbnailUrl: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return success(c, orders.map((order) => ({
      id: order.id,
      order_number: order.orderNumber,
      status: order.status,
      rental_start: order.rentalStartDate.toISOString().split('T')[0],
      rental_end: order.rentalEndDate.toISOString().split('T')[0],
      total_days: order.totalDays,
      total_amount: order.totalAmount,
      deposit: order.deposit,
      delivery_fee: order.deliveryFee,
      items: order.items.map((item) => ({
        product_name: item.productName,
        size: item.size,
        quantity: item.quantity,
        subtotal: item.subtotal,
        status: item.status,
        thumbnail: item.product.thumbnailUrl,
      })),
      created_at: order.createdAt.toISOString(),
    })));
  } catch {
    return error(c, 401, 'UNAUTHORIZED', 'Invalid or expired token');
  }
});

// PATCH /api/v1/customer/auth/profile (update profile)
const updateProfileSchema = z.object({
  first_name: z.string().min(1).optional(),
  last_name: z.string().min(1).optional(),
  phone: z.string().optional(),
  address: z.record(z.unknown()).optional(),
});

customerAuth.patch('/profile', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return error(c, 401, 'UNAUTHORIZED', 'Missing authorization');
  }

  try {
    const decoded = await verify(authHeader.slice(7), getJwtSecret(), 'HS256');
    if (decoded.type !== 'customer') {
      return error(c, 401, 'UNAUTHORIZED', 'Invalid token type');
    }

    const body = await c.req.json().catch(() => null);
    const parsed = updateProfileSchema.safeParse(body);
    if (!parsed.success) {
      return error(c, 400, 'VALIDATION_ERROR', 'Invalid profile data', parsed.error.flatten());
    }

    const db = getDb();
    const updateData: Record<string, unknown> = {};
    if (parsed.data.first_name) updateData.firstName = parsed.data.first_name;
    if (parsed.data.last_name) updateData.lastName = parsed.data.last_name;
    if (parsed.data.phone !== undefined) updateData.phone = parsed.data.phone;
    if (parsed.data.address !== undefined) updateData.address = parsed.data.address;

    const updated = await db.customer.update({
      where: { id: decoded.sub as string },
      data: updateData,
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, tier: true, address: true },
    });

    return success(c, {
      id: updated.id,
      email: updated.email,
      first_name: updated.firstName,
      last_name: updated.lastName,
      phone: updated.phone,
      tier: updated.tier,
      address: updated.address,
    });
  } catch {
    return error(c, 401, 'UNAUTHORIZED', 'Invalid or expired token');
  }
});

export default customerAuth;
