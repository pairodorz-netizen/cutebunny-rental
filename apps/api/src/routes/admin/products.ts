import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../lib/db';
import { success, created, error } from '../../lib/response';
import { parseLocale, localizeField } from '../../lib/i18n';
import { getAdmin } from '../../middleware/auth';
import { Prisma } from '@prisma/client';

const adminProducts = new Hono();

// A02: GET /api/v1/admin/products — Product list
adminProducts.get('/', async (c) => {
  const db = getDb();
  const locale = parseLocale(c.req.query('locale'));
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
  const perPage = Math.min(100, Math.max(1, parseInt(c.req.query('per_page') ?? '20', 10)));
  const search = c.req.query('search');
  const category = c.req.query('category');

  const where: Prisma.ProductWhereInput = {};

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (category) {
    where.category = category as Prisma.EnumProductCategoryFilter;
  }

  const [products, total] = await Promise.all([
    db.product.findMany({
      where,
      include: {
        brand: true,
        images: { orderBy: { sortOrder: 'asc' }, take: 1 },
      },
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy: { createdAt: 'desc' },
    }),
    db.product.count({ where }),
  ]);

  const data = products.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: localizeField(p.nameI18n as Record<string, string> | null, p.name, locale),
    category: p.category,
    brand: p.brand?.name ?? null,
    thumbnail: p.images[0]?.url ?? p.thumbnailUrl,
    rental_prices: {
      '1day': p.rentalPrice1Day,
      '3day': p.rentalPrice3Day,
      '5day': p.rentalPrice5Day,
    },
    retail_price: p.retailPrice,
    deposit: p.deposit,
    stock: p.stockQuantity,
    rental_count: p.rentalCount,
    available: p.available,
    created_at: p.createdAt.toISOString(),
  }));

  return success(c, data, {
    page,
    per_page: perPage,
    total,
    total_pages: Math.ceil(total / perPage),
  });
});

// A02: POST /api/v1/admin/products — Create product
adminProducts.post('/', async (c) => {
  const db = getDb();

  const bodySchema = z.object({
    sku: z.string().min(1),
    name: z.string().min(1),
    name_i18n: z.record(z.string()).optional(),
    description: z.string().optional(),
    description_i18n: z.record(z.string()).optional(),
    category: z.enum(['wedding', 'evening', 'cocktail', 'casual', 'costume', 'traditional', 'accessories']),
    brand_id: z.string().uuid().optional(),
    size: z.array(z.string()).min(1),
    color: z.array(z.string()).min(1),
    rental_price_1day: z.number().int().min(0),
    rental_price_3day: z.number().int().min(0),
    rental_price_5day: z.number().int().min(0),
    retail_price: z.number().int().min(0).optional(),
    variable_cost: z.number().int().min(0).optional(),
    deposit: z.number().int().min(0),
    stock_quantity: z.number().int().min(0).optional(),
  });

  const body = await c.req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid product data', parsed.error.flatten());
  }

  // Check SKU uniqueness
  const existing = await db.product.findUnique({ where: { sku: parsed.data.sku } });
  if (existing) {
    return error(c, 409, 'DUPLICATE_SKU', `SKU "${parsed.data.sku}" already exists`);
  }

  const product = await db.product.create({
    data: {
      sku: parsed.data.sku,
      name: parsed.data.name,
      nameI18n: parsed.data.name_i18n ?? Prisma.JsonNull,
      description: parsed.data.description ?? '',
      descriptionI18n: parsed.data.description_i18n ?? Prisma.JsonNull,
      category: parsed.data.category,
      brandId: parsed.data.brand_id ?? null,
      size: parsed.data.size,
      color: parsed.data.color,
      rentalPrice1Day: parsed.data.rental_price_1day,
      rentalPrice3Day: parsed.data.rental_price_3day,
      rentalPrice5Day: parsed.data.rental_price_5day,
      retailPrice: parsed.data.retail_price ?? 0,
      variableCost: parsed.data.variable_cost ?? 0,
      deposit: parsed.data.deposit,
      stockQuantity: parsed.data.stock_quantity ?? 1,
    },
  });

  return created(c, {
    id: product.id,
    sku: product.sku,
    name: product.name,
    category: product.category,
  });
});

// A02: PATCH /api/v1/admin/products/:id — Update product
adminProducts.patch('/:id', async (c) => {
  const db = getDb();
  const id = c.req.param('id');

  const product = await db.product.findUnique({ where: { id } });
  if (!product) {
    return error(c, 404, 'NOT_FOUND', 'Product not found');
  }

  const bodySchema = z.object({
    name: z.string().min(1).optional(),
    name_i18n: z.record(z.string()).optional(),
    description: z.string().optional(),
    description_i18n: z.record(z.string()).optional(),
    category: z.enum(['wedding', 'evening', 'cocktail', 'casual', 'costume', 'traditional', 'accessories']).optional(),
    brand_id: z.string().uuid().nullable().optional(),
    size: z.array(z.string()).min(1).optional(),
    color: z.array(z.string()).min(1).optional(),
    rental_price_1day: z.number().int().min(0).optional(),
    rental_price_3day: z.number().int().min(0).optional(),
    rental_price_5day: z.number().int().min(0).optional(),
    retail_price: z.number().int().min(0).optional(),
    variable_cost: z.number().int().min(0).optional(),
    deposit: z.number().int().min(0).optional(),
    stock_quantity: z.number().int().min(0).optional(),
    available: z.boolean().optional(),
  });

  const body = await c.req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid update data', parsed.error.flatten());
  }

  const updateData: Prisma.ProductUpdateInput = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.name_i18n !== undefined) updateData.nameI18n = parsed.data.name_i18n;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.description_i18n !== undefined) updateData.descriptionI18n = parsed.data.description_i18n;
  if (parsed.data.category !== undefined) updateData.category = parsed.data.category;
  if (parsed.data.brand_id !== undefined) updateData.brand = parsed.data.brand_id ? { connect: { id: parsed.data.brand_id } } : { disconnect: true };
  if (parsed.data.size !== undefined) updateData.size = parsed.data.size;
  if (parsed.data.color !== undefined) updateData.color = parsed.data.color;
  if (parsed.data.rental_price_1day !== undefined) updateData.rentalPrice1Day = parsed.data.rental_price_1day;
  if (parsed.data.rental_price_3day !== undefined) updateData.rentalPrice3Day = parsed.data.rental_price_3day;
  if (parsed.data.rental_price_5day !== undefined) updateData.rentalPrice5Day = parsed.data.rental_price_5day;
  if (parsed.data.retail_price !== undefined) updateData.retailPrice = parsed.data.retail_price;
  if (parsed.data.variable_cost !== undefined) updateData.variableCost = parsed.data.variable_cost;
  if (parsed.data.deposit !== undefined) updateData.deposit = parsed.data.deposit;
  if (parsed.data.stock_quantity !== undefined) updateData.stockQuantity = parsed.data.stock_quantity;
  if (parsed.data.available !== undefined) updateData.available = parsed.data.available;

  const updated = await db.product.update({
    where: { id },
    data: updateData,
  });

  return success(c, {
    id: updated.id,
    sku: updated.sku,
    name: updated.name,
    updated_at: updated.updatedAt.toISOString(),
  });
});

// A02: DELETE /api/v1/admin/products/:id — Soft delete (mark unavailable)
adminProducts.delete('/:id', async (c) => {
  const db = getDb();
  const id = c.req.param('id');
  const admin = getAdmin(c);

  const product = await db.product.findUnique({ where: { id } });
  if (!product) {
    return error(c, 404, 'NOT_FOUND', 'Product not found');
  }

  await db.product.update({
    where: { id },
    data: { available: false },
  });

  // Audit log via inventory status
  await db.inventoryStatusLog.create({
    data: {
      productId: id,
      status: 'decommissioned',
      note: `Soft deleted by admin`,
      changedBy: admin.sub,
    },
  });

  return success(c, { id, deleted: true });
});

export default adminProducts;
