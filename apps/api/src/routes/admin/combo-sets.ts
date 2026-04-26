import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../lib/db';
import { success, created, error } from '../../lib/response';
import { getAdmin } from '../../middleware/auth';

const adminComboSets = new Hono();

// GET /api/v1/admin/combo-sets — List all combo sets
adminComboSets.get('/', async (c) => {
  const db = getDb();
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
  const perPage = Math.min(100, Math.max(1, parseInt(c.req.query('per_page') ?? '20', 10)));
  const search = c.req.query('search');

  const where: Record<string, unknown> = {};
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [comboSets, total] = await Promise.all([
    db.comboSet.findMany({
      where,
      include: {
        brand: true,
        items: {
          include: {
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                thumbnailUrl: true,
                images: { orderBy: { sortOrder: 'asc' as const }, take: 1 },
              },
            },
          },
        },
      },
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy: { createdAt: 'desc' as const },
    }),
    db.comboSet.count({ where }),
  ]);

  const data = comboSets.map((cs) => ({
    id: cs.id,
    sku: cs.sku,
    name: cs.name,
    description: cs.description ?? '',
    brand: cs.brand?.name ?? null,
    thumbnail: cs.thumbnailUrl,
    color: cs.color,
    size: cs.size,
    rental_prices: {
      '1day': cs.rentalPrice1Day,
      '3day': cs.rentalPrice3Day,
      '5day': cs.rentalPrice5Day,
    },
    variable_cost: cs.variableCost,
    extra_day_rate: cs.extraDayRate ?? 0,
    available: cs.available,
    rental_count: cs.rentalCount,
    items: cs.items.map((item) => ({
      id: item.id,
      product_id: item.productId,
      product_sku: item.product.sku,
      product_name: item.product.name,
      product_thumbnail: item.product.images[0]?.url ?? item.product.thumbnailUrl,
      revenue_share_pct: item.revenueSharePct,
      label: item.label,
    })),
    created_at: cs.createdAt.toISOString(),
  }));

  return success(c, data, {
    page,
    per_page: perPage,
    total,
    total_pages: Math.ceil(total / perPage),
  });
});

// GET /api/v1/admin/combo-sets/:id — Detail
adminComboSets.get('/:id', async (c) => {
  const db = getDb();
  const id = c.req.param('id');

  const cs = await db.comboSet.findUnique({
    where: { id },
    include: {
      brand: true,
      items: {
        include: {
          product: {
            select: {
              id: true,
              sku: true,
              name: true,
              thumbnailUrl: true,
              rentalPrice1Day: true,
              costPrice: true,
              images: { orderBy: { sortOrder: 'asc' as const }, take: 1 },
            },
          },
        },
      },
    },
  });

  if (!cs) {
    return error(c, 404, 'NOT_FOUND', 'Combo set not found');
  }

  return success(c, {
    id: cs.id,
    sku: cs.sku,
    name: cs.name,
    description: cs.description ?? '',
    brand: cs.brand?.name ?? null,
    brand_id: cs.brandId,
    thumbnail: cs.thumbnailUrl,
    color: cs.color,
    size: cs.size,
    rental_prices: {
      '1day': cs.rentalPrice1Day,
      '3day': cs.rentalPrice3Day,
      '5day': cs.rentalPrice5Day,
    },
    variable_cost: cs.variableCost,
    extra_day_rate: cs.extraDayRate ?? 0,
    available: cs.available,
    rental_count: cs.rentalCount,
    items: cs.items.map((item) => ({
      id: item.id,
      product_id: item.productId,
      product_sku: item.product.sku,
      product_name: item.product.name,
      product_thumbnail: item.product.images[0]?.url ?? item.product.thumbnailUrl,
      product_cost: item.product.costPrice,
      revenue_share_pct: item.revenueSharePct,
      label: item.label,
    })),
    created_at: cs.createdAt.toISOString(),
  });
});

// POST /api/v1/admin/combo-sets — Create combo set
const createComboSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  brand_name: z.string().optional(),
  brand_id: z.string().uuid().optional(),
  color: z.array(z.string()).default([]),
  size: z.array(z.string()).default([]),
  rental_price_1day: z.number().int().min(0),
  rental_price_3day: z.number().int().min(0),
  rental_price_5day: z.number().int().min(0),
  extra_day_rate: z.number().int().min(0).default(0),
  variable_cost: z.number().int().min(0).default(0),
  thumbnail_url: z.string().url().optional(),
  items: z.array(z.object({
    product_id: z.string().uuid(),
    revenue_share_pct: z.number().min(0).max(100).default(50),
    label: z.string().optional(),
  })).min(1),
});

adminComboSets.post('/', async (c) => {
  const db = getDb();
  const admin = getAdmin(c);

  const body = await c.req.json().catch(() => null);
  const parsed = createComboSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid combo set data', parsed.error.flatten());
  }

  // Check SKU uniqueness
  const existing = await db.comboSet.findUnique({ where: { sku: parsed.data.sku } });
  if (existing) {
    return error(c, 409, 'DUPLICATE_SKU', `SKU "${parsed.data.sku}" already exists`);
  }

  // Resolve brand
  let brandId: string | null = parsed.data.brand_id ?? null;
  if (!brandId && parsed.data.brand_name) {
    let brand = await db.brand.findFirst({ where: { name: { equals: parsed.data.brand_name, mode: 'insensitive' } } });
    if (!brand) brand = await db.brand.create({ data: { name: parsed.data.brand_name } });
    brandId = brand.id;
  }

  const comboSet = await db.comboSet.create({
    data: {
      sku: parsed.data.sku,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      brandId,
      color: parsed.data.color,
      size: parsed.data.size,
      rentalPrice1Day: parsed.data.rental_price_1day,
      rentalPrice3Day: parsed.data.rental_price_3day,
      rentalPrice5Day: parsed.data.rental_price_5day,
      extraDayRate: parsed.data.extra_day_rate ?? 0,
      variableCost: parsed.data.variable_cost,
      thumbnailUrl: parsed.data.thumbnail_url ?? null,
      items: {
        create: parsed.data.items.map((item) => ({
          productId: item.product_id,
          revenueSharePct: item.revenue_share_pct,
          label: item.label ?? null,
        })),
      },
    },
    include: { items: true },
  });

  // Audit log
  try {
    await db.auditLog.create({
      data: {
        adminId: admin.sub,
        action: 'CREATE',
        resource: 'combo_set',
        resourceId: comboSet.id,
        details: { sku: comboSet.sku, name: comboSet.name, items_count: parsed.data.items.length },
      },
    });
  } catch { /* audit failure should not block */ }

  return created(c, {
    id: comboSet.id,
    sku: comboSet.sku,
    name: comboSet.name,
  });
});

// PATCH /api/v1/admin/combo-sets/:id — Update combo set
const updateComboSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  brand_name: z.string().optional(),
  brand_id: z.string().uuid().nullable().optional(),
  color: z.array(z.string()).optional(),
  size: z.array(z.string()).optional(),
  rental_price_1day: z.number().int().min(0).optional(),
  rental_price_3day: z.number().int().min(0).optional(),
  rental_price_5day: z.number().int().min(0).optional(),
  extra_day_rate: z.number().int().min(0).optional(),
  variable_cost: z.number().int().min(0).optional(),
  thumbnail_url: z.string().url().nullable().optional(),
  available: z.boolean().optional(),
  items: z.array(z.object({
    product_id: z.string().uuid(),
    revenue_share_pct: z.number().min(0).max(100).default(50),
    label: z.string().optional(),
  })).optional(),
});

adminComboSets.patch('/:id', async (c) => {
  const db = getDb();
  const admin = getAdmin(c);
  const id = c.req.param('id');

  const cs = await db.comboSet.findUnique({ where: { id } });
  if (!cs) {
    return error(c, 404, 'NOT_FOUND', 'Combo set not found');
  }

  const body = await c.req.json().catch(() => null);
  const parsed = updateComboSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid update data', parsed.error.flatten());
  }

  // Resolve brand
  let brandId = cs.brandId;
  if (parsed.data.brand_id !== undefined) {
    brandId = parsed.data.brand_id;
  } else if (parsed.data.brand_name) {
    let brand = await db.brand.findFirst({ where: { name: { equals: parsed.data.brand_name, mode: 'insensitive' } } });
    if (!brand) brand = await db.brand.create({ data: { name: parsed.data.brand_name } });
    brandId = brand.id;
  }

  const updateData: Record<string, unknown> = { brandId };
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.color !== undefined) updateData.color = parsed.data.color;
  if (parsed.data.size !== undefined) updateData.size = parsed.data.size;
  if (parsed.data.rental_price_1day !== undefined) updateData.rentalPrice1Day = parsed.data.rental_price_1day;
  if (parsed.data.rental_price_3day !== undefined) updateData.rentalPrice3Day = parsed.data.rental_price_3day;
  if (parsed.data.rental_price_5day !== undefined) updateData.rentalPrice5Day = parsed.data.rental_price_5day;
  if (parsed.data.extra_day_rate !== undefined) updateData.extraDayRate = parsed.data.extra_day_rate;
  if (parsed.data.variable_cost !== undefined) updateData.variableCost = parsed.data.variable_cost;
  if (parsed.data.thumbnail_url !== undefined) updateData.thumbnailUrl = parsed.data.thumbnail_url;
  if (parsed.data.available !== undefined) updateData.available = parsed.data.available;

  await db.comboSet.update({ where: { id }, data: updateData });

  // Replace items if provided
  if (parsed.data.items) {
    await db.comboSetItem.deleteMany({ where: { comboSetId: id } });
    await Promise.all(
      parsed.data.items.map((item) =>
        db.comboSetItem.create({
          data: {
            comboSetId: id,
            productId: item.product_id,
            revenueSharePct: item.revenue_share_pct,
            label: item.label ?? null,
          },
        })
      )
    );
  }

  // Audit log
  try {
    await db.auditLog.create({
      data: {
        adminId: admin.sub,
        action: 'UPDATE',
        resource: 'combo_set',
        resourceId: id,
        details: { sku: cs.sku, changes: parsed.data },
      },
    });
  } catch { /* audit failure should not block */ }

  return success(c, { id, updated: true });
});

// DELETE /api/v1/admin/combo-sets/:id — Delete combo set
// Semantics:
//   • 404 when combo set id does not exist
//   • 409 ACTIVE_RENTALS when rentalCount > 0 (no state change, no audit)
//   • 200 hard-delete when rentalCount === 0 (ComboSetItem cascades via
//     Prisma onDelete: Cascade on the comboSet relation)
adminComboSets.delete('/:id', async (c) => {
  const db = getDb();
  const admin = getAdmin(c);
  const id = c.req.param('id');

  const cs = await db.comboSet.findUnique({ where: { id } });
  if (!cs) {
    return error(c, 404, 'NOT_FOUND', 'Combo set not found');
  }

  if (cs.rentalCount > 0) {
    return error(
      c,
      409,
      'ACTIVE_RENTALS',
      `Cannot delete combo set with ${cs.rentalCount} active rental${cs.rentalCount === 1 ? '' : 's'}`,
      { rentalCount: cs.rentalCount },
    );
  }

  await db.comboSet.delete({ where: { id } });

  // Audit log
  try {
    await db.auditLog.create({
      data: {
        adminId: admin.sub,
        action: 'DELETE',
        resource: 'combo_set',
        resourceId: id,
        details: { sku: cs.sku, name: cs.name, mode: 'hard' },
      },
    });
  } catch { /* audit failure should not block */ }

  return success(c, { id, deleted: true, mode: 'hard' });
});

export default adminComboSets;
