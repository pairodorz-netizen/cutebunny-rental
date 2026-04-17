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
  const category = c.req.query('category');
  const availableStart = c.req.query('available_start');
  const availableEnd = c.req.query('available_end');

  const where: Prisma.ProductWhereInput = { available: true };

  if (color) {
    where.color = { has: color };
  }
  if (size) {
    where.size = { has: size };
  }
  if (category) {
    where.category = category as Prisma.ProductWhereInput['category'];
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

  // Fetch products
  const [items, productTotal] = await Promise.all([
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

  const productData = items.map((p) => ({
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
    extra_day_rate: p.extraDayRate ?? 0,
    deposit: p.deposit,
    is_popular: (p.rentalCount ?? 0) > 10,
    currency: p.currency,
    is_combo: false,
  }));

  // Fetch combo sets and merge into listing
  let comboData: typeof productData = [];
  try {
    const comboSets = await db.comboSet.findMany({
      where: { available: true },
      include: { brand: true },
      orderBy: { createdAt: 'desc' },
    });
    comboData = comboSets.map((cs) => ({
      id: cs.id,
      sku: cs.sku,
      name: cs.name,
      category: 'combo' as string,
      brand: cs.brand ? localizeField(cs.brand.nameI18n as Record<string, string> | null, cs.brand.name, locale) : null,
      thumbnail: cs.thumbnailUrl,
      size: cs.size,
      color: cs.color,
      rental_prices: {
        '1day': cs.rentalPrice1Day,
        '3day': cs.rentalPrice3Day,
        '5day': cs.rentalPrice5Day,
      },
      extra_day_rate: cs.extraDayRate ?? 0,
      deposit: 0,
      is_popular: (cs.rentalCount ?? 0) > 10,
      currency: 'THB',
      is_combo: true,
    }));
  } catch {
    // combo_sets table may not exist yet — skip gracefully
  }

  const allData = [...productData, ...comboData];
  const total = productTotal + comboData.length;

  return success(c, allData, {
    page,
    per_page: perPage,
    total,
    total_pages: Math.ceil(total / perPage),
  });
});

// C02: GET /api/v1/products/:id — Product detail (checks both products and combo_sets)
products.get('/:id', async (c) => {
  const db = getDb();
  const locale = parseLocale(c.req.query('locale'));
  const id = c.req.param('id');

  // Try product first
  const product = await db.product.findUnique({
    where: { id },
    include: {
      images: { orderBy: { sortOrder: 'asc' } },
      brand: true,
    },
  });

  if (product) {
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
        ? localizeField(product.brand.nameI18n as Record<string, string> | null, product.brand.name, locale)
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
      extra_day_rate: product.extraDayRate ?? 0,
      ref_price: product.retailPrice,
      deposit: product.deposit,
      is_popular: (product.rentalCount ?? 0) > 10,
      currency: product.currency,
      is_combo: false,
      related_skus: relatedProducts.map((rp) => ({
        id: rp.id,
        sku: rp.sku,
        name: localizeField(rp.nameI18n as Record<string, string> | null, rp.name, locale),
        thumbnail: rp.thumbnailUrl,
        price_1day: rp.rentalPrice1Day,
      })),
    };

    return success(c, data);
  }

  // Try combo set
  try {
    const comboSet = await db.comboSet.findUnique({
      where: { id },
      include: {
        brand: true,
        items: {
          include: {
            product: {
              select: {
                id: true, sku: true, name: true, nameI18n: true,
                thumbnailUrl: true,
                images: { orderBy: { sortOrder: 'asc' }, take: 1 },
                rentalPrice1Day: true, rentalPrice3Day: true, rentalPrice5Day: true,
              },
            },
          },
        },
      },
    });

    if (!comboSet) {
      return error(c, 404, 'NOT_FOUND', 'Product not found');
    }

    const data = {
      id: comboSet.id,
      sku: comboSet.sku,
      name: comboSet.name,
      description: '',
      category: 'combo',
      brand: comboSet.brand
        ? localizeField(comboSet.brand.nameI18n as Record<string, string> | null, comboSet.brand.name, locale)
        : null,
      images: comboSet.thumbnailUrl ? [{ id: 'thumb', url: comboSet.thumbnailUrl, alt_text: comboSet.name }] : [],
      size: comboSet.size,
      color: comboSet.color,
      rental_prices: {
        '1day': comboSet.rentalPrice1Day,
        '3day': comboSet.rentalPrice3Day,
        '5day': comboSet.rentalPrice5Day,
      },
      extra_day_rate: comboSet.extraDayRate ?? 0,
      ref_price: 0,
      deposit: 0,
      is_popular: (comboSet.rentalCount ?? 0) > 10,
      currency: 'THB',
      is_combo: true,
      combo_items: comboSet.items.map((item) => ({
        id: item.id,
        product_id: item.product.id,
        product_sku: item.product.sku,
        product_name: localizeField(item.product.nameI18n as Record<string, string> | null, item.product.name, locale),
        product_thumbnail: item.product.images[0]?.url ?? item.product.thumbnailUrl,
        revenue_share_pct: item.revenueSharePct,
        label: item.label,
      })),
      related_skus: [],
    };

    return success(c, data);
  } catch {
    // combo_sets table may not exist
  }

  return error(c, 404, 'NOT_FOUND', 'Product not found');
});

// C03: GET /api/v1/products/:id/calendar — Availability calendar
// Supports size & color query params to filter by inventory unit variant
products.get('/:id/calendar', async (c) => {
  const db = getDb();
  const id = c.req.param('id');
  const yearStr = c.req.query('year');
  const monthStr = c.req.query('month');
  const sizeFilter = c.req.query('size') || undefined;
  const colorFilter = c.req.query('color') || undefined;

  const schema = z.object({
    year: z.coerce.number().int().min(2024).max(2030),
    month: z.coerce.number().int().min(1).max(12),
  });

  const parsed = schema.safeParse({ year: yearStr, month: monthStr });
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid year or month', parsed.error.flatten());
  }

  const filters = (sizeFilter || colorFilter) ? { size: sizeFilter, color: colorFilter } : undefined;

  // Check if it's a regular product
  const product = await db.product.findUnique({ where: { id }, select: { id: true } });

  if (product) {
    const days = await getMonthAvailability(db, id, parsed.data.year, parsed.data.month, filters);
    return success(c, {
      product_id: id,
      year: parsed.data.year,
      month: parsed.data.month,
      days,
    });
  }

  // Check if it's a combo set — aggregate availability of all component products
  try {
    const comboSet = await db.comboSet.findUnique({
      where: { id },
      select: {
        id: true,
        items: { select: { productId: true } },
      },
    });

    if (!comboSet || comboSet.items.length === 0) {
      return error(c, 404, 'NOT_FOUND', 'Product not found');
    }

    // Get availability for each component product (with filters)
    const componentDays = await Promise.all(
      comboSet.items.map((item) =>
        getMonthAvailability(db, item.productId, parsed.data.year, parsed.data.month, filters)
      )
    );

    // Merge: a day is unavailable if ANY component is not available
    const mergedDays = componentDays[0].map((day, idx) => {
      const allAvailable = componentDays.every(
        (cd) => cd[idx]?.status === 'available'
      );
      return {
        date: day.date,
        status: allAvailable ? day.status : (
          componentDays.find((cd) => cd[idx]?.status !== 'available')?.[idx]?.status ?? 'booked'
        ),
      };
    });

    return success(c, {
      product_id: id,
      year: parsed.data.year,
      month: parsed.data.month,
      days: mergedDays,
    });
  } catch {
    // combo_sets table may not exist
  }

  return error(c, 404, 'NOT_FOUND', 'Product not found');
});

export default products;
