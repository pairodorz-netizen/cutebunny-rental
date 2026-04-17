import { Hono } from 'hono';
import { z } from 'zod';

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

interface ComboComponent {
  product_id: string;
  product_name: string;
  revenue_share_pct: number;
  label: string | null;
}

interface CartItem {
  product_id: string;
  rental_days: number;
  rental_start: string;
  product_name: string;
  size: string;
  price_per_day: number;
  subtotal: number;
  deposit: number;
  is_combo: boolean;
  combo_components?: ComboComponent[];
}

/**
 * Calculate rental price using the standard pricing rules:
 * 1 day → 1-day rate
 * 2-3 days → 3-day rate
 * 4-5 days → 5-day rate
 * 6+ days → 5-day rate + extraDayRate × (days - 5)
 */
function calculateRentalPrice(
  days: number,
  price1Day: number,
  price3Day: number,
  price5Day: number,
  extraDayRate: number
): number {
  if (days === 1) return price1Day;
  if (days <= 3) return price3Day;
  if (days <= 5) return price5Day;
  // days > 5
  if (extraDayRate > 0) {
    return price5Day + extraDayRate * (days - 5);
  }
  return price5Day;
}

// Clean expired carts (called lazily, not via setInterval which is disallowed in Workers global scope)
function cleanExpiredCarts() {
  const now = Date.now();
  for (const [token, cartData] of cartStore) {
    if (cartData.expiresAt <= now) {
      cartStore.delete(token);
    }
  }
}

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
    // Try regular product first
    const product = await db.product.findUnique({
      where: { id: item.product_id, available: true },
    });

    if (product) {
      // Regular product
      const startDate = new Date(item.rental_start + 'T00:00:00.000Z');
      const avail = await checkAvailability(db, item.product_id, startDate, item.rental_days);

      if (!avail.available) {
        conflicts.push({ product_id: item.product_id, dates: avail.conflictDates });
        continue;
      }

      const subtotal = calculateRentalPrice(
        item.rental_days,
        product.rentalPrice1Day,
        product.rentalPrice3Day,
        product.rentalPrice5Day,
        product.extraDayRate ?? 0
      );

      cartItems.push({
        product_id: product.id,
        rental_days: item.rental_days,
        rental_start: item.rental_start,
        product_name: product.name,
        size: product.size[0] ?? 'ONE',
        price_per_day: Math.round(subtotal / item.rental_days),
        subtotal,
        deposit: product.deposit,
        is_combo: false,
      });
      continue;
    }

    // Try combo set
    const comboSet = await db.comboSet.findUnique({
      where: { id: item.product_id, available: true },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                available: true,
              },
            },
          },
        },
      },
    });

    if (!comboSet) {
      return error(c, 404, 'NOT_FOUND', `Product ${item.product_id} not found or unavailable`);
    }

    // Check availability for ALL component products
    const startDate = new Date(item.rental_start + 'T00:00:00.000Z');
    let allAvailable = true;
    for (const comboItem of comboSet.items) {
      const avail = await checkAvailability(db, comboItem.productId, startDate, item.rental_days);
      if (!avail.available) {
        conflicts.push({ product_id: item.product_id, dates: avail.conflictDates });
        allAvailable = false;
        break;
      }
    }

    if (!allAvailable) continue;

    const subtotal = calculateRentalPrice(
      item.rental_days,
      comboSet.rentalPrice1Day,
      comboSet.rentalPrice3Day,
      comboSet.rentalPrice5Day,
      comboSet.extraDayRate ?? 0
    );

    cartItems.push({
      product_id: comboSet.id,
      rental_days: item.rental_days,
      rental_start: item.rental_start,
      product_name: comboSet.name,
      size: comboSet.size[0] ?? 'ONE',
      price_per_day: Math.round(subtotal / item.rental_days),
      subtotal,
      deposit: 0,
      is_combo: true,
      combo_components: comboSet.items.map((ci) => ({
        product_id: ci.productId,
        product_name: ci.product.name,
        revenue_share_pct: ci.revenueSharePct,
        label: ci.label,
      })),
    });
  }

  if (conflicts.length > 0) {
    return error(c, 409, 'AVAILABILITY_CONFLICT', 'Some items are not available for the requested dates', { conflicts });
  }

  // Create tentative holds
  for (const item of cartItems) {
    const startDate = new Date(item.rental_start + 'T00:00:00.000Z');
    if (item.is_combo && item.combo_components) {
      // Hold each component product
      for (const comp of item.combo_components) {
        await createTentativeHolds(db, comp.product_id, startDate, item.rental_days);
      }
    } else {
      await createTentativeHolds(db, item.product_id, startDate, item.rental_days);
    }
  }

  // Clean expired carts lazily on each request
  cleanExpiredCarts();

  const cartToken = crypto.randomUUID();
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
