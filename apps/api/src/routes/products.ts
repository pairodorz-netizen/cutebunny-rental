import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../lib/db';
import { success, error } from '../lib/response';
import { parseLocale, localizeField } from '../lib/i18n';
import { getMonthAvailability } from '../lib/availability';
import type { Prisma } from '@prisma/client';

const products = new Hono();

// C01: GET /api/v1/products — Catalog list
products.get('/', async (c) => {
  const db = getDb();
  const locale = parseLocale(c.req.query('locale'));
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
  const perPage = Math.min(50, Math.max(1, parseInt(c.req.query('per_page') ?? '20', 10)));
  const color = c.req.query('color');
  const size = c.req.query('size');
  const availableStart = c.req.query('available_start');
  const availableEnd = c.req.query('available_end');

  const where: Prisma.ProductWhereInput = { available: true };

  if (color) {
    where.color = { has: color };
  }
  if (size) {
    where.size = { has: size };
  }

  // If availability date filter is provided, exclude products with conflicting bookings
  if (availableStart && availableEnd) {
    const startDate = new Date(availableStart);
    const endDate = new Date(availableEnd);
    if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
      where.availabilitySlots = {
        none: {
          calendarDate: { gte: startDate, lte: endDate },
          slotStatus: { in: ['booked', 'cleaning', 'blocked_repair', 'late_return'] },
        },
      };
    }
  }

  const [items, total] = await Promise.all([
    db.product.findMany({
      where,
      include: {
        images: { orderBy: { sortOrder: 'asc' }, take: 1 },
        brand: true,
      },
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy: { createdAt: 'desc' },
    }),
    db.product.count({ where }),
  ]);

  const data = items.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: localizeField(p.nameI18n as Record<string, string> | null, p.name, locale),
    category: p.category,
    brand: p.brand ? localizeField(p.brand.nameI18n as Record<string, string> | null, p.brand.name, locale) : null,
    thumbnail: p.images[0]?.url ?? p.thumbnailUrl,
    size: p.size,
    color: p.color,
    rental_prices: {
      '1day': p.rentalPrice1Day,
      '3day': p.rentalPrice3Day,
      '5day': p.rentalPrice5Day,
    },
    deposit: p.deposit,
    rental_count: p.rentalCount,
    currency: p.currency,
  }));

  return success(c, data, {
    page,
    per_page: perPage,
    total,
    total_pages: Math.ceil(total / perPage),
  });
});

// C02: GET /api/v1/products/:id — Product detail
products.get('/:id', async (c) => {
  const db = getDb();
  const locale = parseLocale(c.req.query('locale'));
  const id = c.req.param('id');

  const product = await db.product.findUnique({
    where: { id },
    include: {
      images: { orderBy: { sortOrder: 'asc' } },
      brand: true,
    },
  });

  if (!product) {
    return error(c, 404, 'NOT_FOUND', 'Product not found');
  }

  // Get related products (same category, different SKU)
  const relatedProducts = await db.product.findMany({
    where: {
      category: product.category,
      id: { not: product.id },
      available: true,
    },
    take: 4,
    select: { id: true, sku: true, name: true, nameI18n: true, thumbnailUrl: true, rentalPrice1Day: true },
  });

  const data = {
    id: product.id,
    sku: product.sku,
    name: localizeField(product.nameI18n as Record<string, string> | null, product.name, locale),
    description: localizeField(product.descriptionI18n as Record<string, string> | null, product.description ?? '', locale),
    category: product.category,
    brand: product.brand
      ? {
          id: product.brand.id,
          name: localizeField(product.brand.nameI18n as Record<string, string> | null, product.brand.name, locale),
        }
      : null,
    images: product.images.map((img) => ({
      id: img.id,
      url: img.url,
      alt_text: img.altText,
    })),
    size: product.size,
    color: product.color,
    rental_prices: {
      '1day': product.rentalPrice1Day,
      '3day': product.rentalPrice3Day,
      '5day': product.rentalPrice5Day,
    },
    ref_price: product.retailPrice,
    deposit: product.deposit,
    rental_count: product.rentalCount,
    currency: product.currency,
    related_skus: relatedProducts.map((rp) => ({
      id: rp.id,
      sku: rp.sku,
      name: localizeField(rp.nameI18n as Record<string, string> | null, rp.name, locale),
      thumbnail: rp.thumbnailUrl,
      price_1day: rp.rentalPrice1Day,
    })),
  };

  return success(c, data);
});

// C03: GET /api/v1/products/:id/calendar — Availability calendar
products.get('/:id/calendar', async (c) => {
  const db = getDb();
  const id = c.req.param('id');
  const yearStr = c.req.query('year');
  const monthStr = c.req.query('month');

  const schema = z.object({
    year: z.coerce.number().int().min(2024).max(2030),
    month: z.coerce.number().int().min(1).max(12),
  });

  const parsed = schema.safeParse({ year: yearStr, month: monthStr });
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid year or month', parsed.error.flatten());
  }

  const product = await db.product.findUnique({ where: { id }, select: { id: true } });
  if (!product) {
    return error(c, 404, 'NOT_FOUND', 'Product not found');
  }

  const days = await getMonthAvailability(db, id, parsed.data.year, parsed.data.month);

  return success(c, {
    product_id: id,
    year: parsed.data.year,
    month: parsed.data.month,
    days,
  });
});

export default products;
