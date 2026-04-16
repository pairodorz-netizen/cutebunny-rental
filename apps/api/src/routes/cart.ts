import { Hono } from 'hono';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getDb } from '../lib/db';
import { success, error } from '../lib/response';
import { checkAvailability, createTentativeHolds } from '../lib/availability';

const cart = new Hono();

// In-memory cart store (production: use Redis/KV)
const cartStore = new Map<string, {
  items: CartItem[];
  createdAt: number;
  expiresAt: number;
}>();

interface CartItem {
  product_id: string;
  rental_days: number;
  rental_start: string;
  product_name: string;
  size: string;
  price_per_day: number;
  subtotal: number;
  deposit: number;
}

// Clean expired carts every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [token, cartData] of cartStore) {
    if (cartData.expiresAt <= now) {
      cartStore.delete(token);
    }
  }
}, 5 * 60_000);

export function getCartStore() {
  return cartStore;
}

// C08: POST /api/v1/cart — Create cart session
cart.post('/', async (c) => {
  const db = getDb();

  const bodySchema = z.object({
    items: z.array(z.object({
      product_id: z.string().uuid(),
      rental_days: z.number().int().min(1).max(30),
      rental_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })).min(1).max(10),
  });

  const body = await c.req.json().catch(() => null);
  if (!body) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid request body');
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid cart items', parsed.error.flatten());
  }

  const cartItems: CartItem[] = [];
  const conflicts: Array<{ product_id: string; dates: string[] }> = [];

  for (const item of parsed.data.items) {
    const product = await db.product.findUnique({
      where: { id: item.product_id, available: true },
    });

    if (!product) {
      return error(c, 404, 'NOT_FOUND', `Product ${item.product_id} not found or unavailable`);
    }

    const startDate = new Date(item.rental_start + 'T00:00:00.000Z');
    const avail = await checkAvailability(db, item.product_id, startDate, item.rental_days);

    if (!avail.available) {
      conflicts.push({ product_id: item.product_id, dates: avail.conflictDates });
      continue;
    }

    const pricePerDay = item.rental_days <= 1
      ? product.rentalPrice1Day
      : item.rental_days <= 3
        ? Math.round(product.rentalPrice3Day / 3)
        : Math.round(product.rentalPrice5Day / 5);

    cartItems.push({
      product_id: product.id,
      rental_days: item.rental_days,
      rental_start: item.rental_start,
      product_name: product.name,
      size: product.size[0] ?? 'ONE',
      price_per_day: pricePerDay,
      subtotal: pricePerDay * item.rental_days,
      deposit: product.deposit,
    });
  }

  if (conflicts.length > 0) {
    return error(c, 409, 'AVAILABILITY_CONFLICT', 'Some items are not available for the requested dates', { conflicts });
  }

  // Create tentative holds
  for (const item of cartItems) {
    const startDate = new Date(item.rental_start + 'T00:00:00.000Z');
    await createTentativeHolds(db, item.product_id, startDate, item.rental_days);
  }

  const cartToken = randomUUID();
  const now = Date.now();
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

  cartStore.set(cartToken, {
    items: cartItems,
    createdAt: now,
    expiresAt: now + TWENTY_FOUR_HOURS,
  });

  const subtotal = cartItems.reduce((sum, i) => sum + i.subtotal, 0);
  const totalDeposit = cartItems.reduce((sum, i) => sum + i.deposit, 0);

  return success(c, {
    cart_token: cartToken,
    items: cartItems,
    summary: {
      item_count: cartItems.length,
      subtotal,
      deposit: totalDeposit,
      estimated_total: subtotal + totalDeposit,
    },
    expires_at: new Date(now + TWENTY_FOUR_HOURS).toISOString(),
  });
});

export default cart;
