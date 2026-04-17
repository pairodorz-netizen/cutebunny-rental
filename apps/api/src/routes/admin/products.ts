import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../lib/db';
import { success, created, error } from '../../lib/response';
import { parseLocale, localizeField } from '../../lib/i18n';
import { getAdmin } from '../../middleware/auth';
import { Prisma, type ProductCategory } from '@prisma/client';

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
    name_i18n: (p.nameI18n as Record<string, string>) ?? {},
    category: p.category,
    brand: p.brand?.name ?? null,
    thumbnail: p.images[0]?.url ?? p.thumbnailUrl,
    size: p.size,
    color: p.color,
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
    cost_price: p.costPrice,
    selling_price: p.sellingPrice,
    product_status: p.productStatus,
    sold_at: p.soldAt?.toISOString() ?? null,
    variable_cost: p.variableCost,
    created_at: p.createdAt.toISOString(),
  }));

  return success(c, data, {
    page,
    per_page: perPage,
    total,
    total_pages: Math.ceil(total / perPage),
  });
});

// ─── Bulk Import/Export ───────────────────────────────────────────────────

const CSV_COLUMNS = [
  'product_name_en', 'product_name_th', 'product_name_zh',
  'category', 'size', 'color',
  'price_1day', 'price_3day', 'price_5day',
  'deposit', 'retail_price', 'cost_price',
  'description_en', 'description_th', 'description_zh',
  'image_urls',
];

const VALID_CATEGORIES = ['wedding', 'evening', 'cocktail', 'casual', 'costume', 'traditional', 'accessories'];

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

// GET /api/v1/admin/products/template — Download empty CSV template
adminProducts.get('/template', async (c) => {
  const headerRow = CSV_COLUMNS.join(',');
  const exampleRow = [
    'Ivory Lace Bridal Gown', 'ชุดเจ้าสาวลูกไม้สีงาช้าง', '象牙色蕾丝婚纱',
    'wedding', 'S;M;L', 'ivory;white',
    '3500', '9000', '13000',
    '10000', '45000', '18000',
    'Beautiful ivory lace bridal gown', 'ชุดเจ้าสาวลูกไม้สีงาช้างสวยงาม', '精美的象牙色蕾丝婚纱',
    'https://example.com/img1.jpg;https://example.com/img2.jpg',
  ].map(escapeCsv).join(',');

  const csv = `${headerRow}\n${exampleRow}\n`;

  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', 'attachment; filename="cutebunny-products-template.csv"');
  return c.body(csv);
});

// GET /api/v1/admin/products/export — Export all products as CSV
adminProducts.get('/export', async (c) => {
  const db = getDb();

  const products = await db.product.findMany({
    include: { images: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  });

  const headerRow = CSV_COLUMNS.join(',');
  const rows = products.map((p) => {
    const nameI18n = (p.nameI18n as Record<string, string>) ?? {};
    const descI18n = (p.descriptionI18n as Record<string, string>) ?? {};
    return [
      nameI18n.en ?? p.name,
      nameI18n.th ?? '',
      nameI18n.zh ?? '',
      p.category,
      p.size.join(';'),
      p.color.join(';'),
      String(p.rentalPrice1Day),
      String(p.rentalPrice3Day),
      String(p.rentalPrice5Day),
      String(p.deposit),
      String(p.retailPrice),
      String(p.costPrice),
      descI18n.en ?? p.description ?? '',
      descI18n.th ?? '',
      descI18n.zh ?? '',
      p.images.map((img) => img.url).join(';'),
    ].map(escapeCsv).join(',');
  });

  const csv = [headerRow, ...rows].join('\n') + '\n';

  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', 'attachment; filename="cutebunny-products-export.csv"');
  return c.body(csv);
});

// POST /api/v1/admin/products/import — Bulk import from CSV
adminProducts.post('/import', async (c) => {
  const db = getDb();
  const body = await c.req.json().catch(() => null);

  if (!body || !body.csv_data || typeof body.csv_data !== 'string') {
    return error(c, 400, 'VALIDATION_ERROR', 'csv_data field is required (CSV string)');
  }

  const dryRun = body.dry_run === true;
  const lines = body.csv_data.split('\n').filter((l: string) => l.trim() !== '');

  if (lines.length < 2) {
    return error(c, 400, 'VALIDATION_ERROR', 'CSV must have a header row and at least one data row');
  }

  // Parse header
  const headers = parseCsvLine(lines[0]).map((h: string) => h.toLowerCase().trim());
  const requiredCols = ['product_name_en', 'category', 'price_1day', 'deposit'];
  const missingCols = requiredCols.filter((col) => !headers.includes(col));
  if (missingCols.length > 0) {
    return error(c, 400, 'VALIDATION_ERROR', `Missing required columns: ${missingCols.join(', ')}`);
  }

  const colIndex = (name: string) => headers.indexOf(name);

  // Parse and validate rows
  const validationErrors: Array<{ row: number; field: string; message: string }> = [];
  const parsedRows: Array<{
    row: number;
    name_en: string; name_th: string; name_zh: string;
    category: string; size: string[]; color: string[];
    price_1day: number; price_3day: number; price_5day: number;
    deposit: number; retail_price: number; cost_price: number;
    desc_en: string; desc_th: string; desc_zh: string;
    image_urls: string[];
    action: 'create' | 'update';
    existing_id?: string;
  }> = [];

  // Fetch existing products for update matching
  const existingProducts = await db.product.findMany({
    select: { id: true, name: true, nameI18n: true },
  });

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const rowNum = i + 1;

    const getField = (name: string) => {
      const idx = colIndex(name);
      return idx >= 0 && idx < fields.length ? fields[idx] : '';
    };

    const nameEn = getField('product_name_en');
    const nameTh = getField('product_name_th');
    const nameZh = getField('product_name_zh');
    const category = getField('category').toLowerCase();
    const sizeStr = getField('size');
    const colorStr = getField('color');
    const price1day = parseInt(getField('price_1day'), 10);
    const price3day = parseInt(getField('price_3day') || '0', 10);
    const price5day = parseInt(getField('price_5day') || '0', 10);
    const deposit = parseInt(getField('deposit'), 10);
    const retailPrice = parseInt(getField('retail_price') || '0', 10);
    const costPrice = parseInt(getField('cost_price') || '0', 10);
    const descEn = getField('description_en');
    const descTh = getField('description_th');
    const descZh = getField('description_zh');
    const imageUrlsStr = getField('image_urls');

    // Validate required fields
    if (!nameEn) validationErrors.push({ row: rowNum, field: 'product_name_en', message: 'Product name (EN) is required' });
    if (!category) validationErrors.push({ row: rowNum, field: 'category', message: 'Category is required' });
    else if (!VALID_CATEGORIES.includes(category)) validationErrors.push({ row: rowNum, field: 'category', message: `Invalid category "${category}". Valid: ${VALID_CATEGORIES.join(', ')}` });
    if (isNaN(price1day) || price1day < 0) validationErrors.push({ row: rowNum, field: 'price_1day', message: 'Valid 1-day price is required' });
    if (isNaN(deposit) || deposit < 0) validationErrors.push({ row: rowNum, field: 'deposit', message: 'Valid deposit amount is required' });

    // Check if product exists (match by EN name)
    const existing = existingProducts.find((p) => {
      const i18n = p.nameI18n as Record<string, string> | null;
      return p.name.toLowerCase() === nameEn.toLowerCase() || (i18n?.en?.toLowerCase() === nameEn.toLowerCase());
    });

    parsedRows.push({
      row: rowNum,
      name_en: nameEn,
      name_th: nameTh,
      name_zh: nameZh,
      category,
      size: sizeStr ? sizeStr.split(';').map((s) => s.trim()).filter(Boolean) : ['ONE'],
      color: colorStr ? colorStr.split(';').map((s) => s.trim()).filter(Boolean) : ['default'],
      price_1day: isNaN(price1day) ? 0 : price1day,
      price_3day: isNaN(price3day) ? 0 : price3day,
      price_5day: isNaN(price5day) ? 0 : price5day,
      deposit: isNaN(deposit) ? 0 : deposit,
      retail_price: isNaN(retailPrice) ? 0 : retailPrice,
      cost_price: isNaN(costPrice) ? 0 : costPrice,
      desc_en: descEn,
      desc_th: descTh,
      desc_zh: descZh,
      image_urls: imageUrlsStr ? imageUrlsStr.split(';').map((u) => u.trim()).filter(Boolean) : [],
      action: existing ? 'update' : 'create',
      existing_id: existing?.id,
    });
  }

  if (validationErrors.length > 0) {
    return error(c, 422, 'VALIDATION_ERRORS', `${validationErrors.length} validation error(s) found`, {
      errors: validationErrors,
      preview: parsedRows.map((r) => ({
        row: r.row,
        name: r.name_en,
        category: r.category,
        price_1day: r.price_1day,
        action: r.action,
      })),
    });
  }

  // Dry run: return preview without saving
  if (dryRun) {
    return success(c, {
      total: parsedRows.length,
      creates: parsedRows.filter((r) => r.action === 'create').length,
      updates: parsedRows.filter((r) => r.action === 'update').length,
      preview: parsedRows.map((r) => ({
        row: r.row,
        name: r.name_en,
        category: r.category,
        size: r.size,
        color: r.color,
        price_1day: r.price_1day,
        deposit: r.deposit,
        action: r.action,
      })),
    });
  }

  // Execute import
  let createdCount = 0;
  let updatedCount = 0;
  const results: Array<{ row: number; action: string; id: string; name: string }> = [];

  for (const row of parsedRows) {
    const nameI18n = { en: row.name_en, th: row.name_th || row.name_en, zh: row.name_zh || row.name_en };
    const descI18n = { en: row.desc_en, th: row.desc_th || row.desc_en, zh: row.desc_zh || row.desc_en };

    if (row.action === 'update' && row.existing_id) {
      await db.product.update({
        where: { id: row.existing_id },
        data: {
          nameI18n,
          description: row.desc_en || undefined,
          descriptionI18n: descI18n,
          category: row.category as ProductCategory,
          size: row.size,
          color: row.color,
          rentalPrice1Day: row.price_1day,
          rentalPrice3Day: row.price_3day,
          rentalPrice5Day: row.price_5day,
          deposit: row.deposit,
          retailPrice: row.retail_price,
          costPrice: row.cost_price,
        },
      });
      updatedCount++;
      results.push({ row: row.row, action: 'updated', id: row.existing_id, name: row.name_en });
    } else {
      // Generate SKU from category + sequence
      const catPrefix = row.category.substring(0, 2).toUpperCase();
      const count = await db.product.count({ where: { category: row.category as ProductCategory } });
      const sku = `CB-${catPrefix}-${String(count + 1).padStart(3, '0')}`;

      const product = await db.product.create({
        data: {
          sku,
          name: row.name_en,
          nameI18n,
          description: row.desc_en || `${row.name_en} available for rental.`,
          descriptionI18n: descI18n,
          category: row.category as ProductCategory,
          size: row.size,
          color: row.color,
          rentalPrice1Day: row.price_1day,
          rentalPrice3Day: row.price_3day,
          rentalPrice5Day: row.price_5day,
          deposit: row.deposit,
          retailPrice: row.retail_price,
          costPrice: row.cost_price,
          stockQuantity: 1,
        },
      });

      // Create ProductImage records from image_urls
      for (let imgIdx = 0; imgIdx < row.image_urls.length; imgIdx++) {
        await db.productImage.create({
          data: {
            productId: product.id,
            url: row.image_urls[imgIdx],
            altText: `${row.name_en} - image ${imgIdx + 1}`,
            sortOrder: imgIdx,
          },
        });
      }

      createdCount++;
      results.push({ row: row.row, action: 'created', id: product.id, name: row.name_en });
    }
  }

  return success(c, {
    total: parsedRows.length,
    created: createdCount,
    updated: updatedCount,
    results,
  });
});

// A02: POST /api/v1/admin/products — Create product
adminProducts.post('/', async (c) => {
  const db = getDb();
  const admin = getAdmin(c);

  const bodySchema = z.object({
    sku: z.string().min(1),
    name: z.string().min(1),
    name_i18n: z.record(z.string()).optional(),
    description: z.string().optional(),
    description_i18n: z.record(z.string()).optional(),
    category: z.enum(['wedding', 'evening', 'cocktail', 'casual', 'costume', 'traditional', 'accessories']),
    brand_id: z.string().uuid().optional(),
    brand_name: z.string().optional(),
    size: z.array(z.string()).min(1),
    color: z.array(z.string()).min(1),
    rental_price_1day: z.number().int().min(0),
    rental_price_3day: z.number().int().min(0),
    rental_price_5day: z.number().int().min(0),
    retail_price: z.number().int().min(0).optional(),
    variable_cost: z.number().int().min(0).optional(),
    cost_price: z.number().int().min(0).optional(),
    deposit: z.number().int().min(0).optional(),
    stock_quantity: z.number().int().min(0).optional(),
    image_urls: z.array(z.string().url()).optional(),
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

  // Resolve brand: brand_id takes priority, then brand_name (find-or-create)
  let resolvedBrandId = parsed.data.brand_id ?? null;
  if (!resolvedBrandId && parsed.data.brand_name) {
    let brand = await db.brand.findFirst({ where: { name: { equals: parsed.data.brand_name, mode: 'insensitive' } } });
    if (!brand) {
      brand = await db.brand.create({ data: { name: parsed.data.brand_name } });
    }
    resolvedBrandId = brand.id;
  }

  const product = await db.product.create({
    data: {
      sku: parsed.data.sku,
      name: parsed.data.name,
      nameI18n: parsed.data.name_i18n ?? Prisma.JsonNull,
      description: parsed.data.description ?? '',
      descriptionI18n: parsed.data.description_i18n ?? Prisma.JsonNull,
      category: parsed.data.category,
      brandId: resolvedBrandId,
      size: parsed.data.size,
      color: parsed.data.color,
      rentalPrice1Day: parsed.data.rental_price_1day,
      rentalPrice3Day: parsed.data.rental_price_3day,
      rentalPrice5Day: parsed.data.rental_price_5day,
      retailPrice: parsed.data.retail_price ?? 0,
      variableCost: parsed.data.variable_cost ?? 100,
      costPrice: parsed.data.cost_price ?? 0,
      deposit: parsed.data.deposit ?? parsed.data.cost_price ?? 0,
      stockQuantity: parsed.data.stock_quantity ?? 1,
    },
  });

  // Create product images if URLs provided
  if (parsed.data.image_urls && parsed.data.image_urls.length > 0) {
    await Promise.all(
      parsed.data.image_urls.map((url, idx) =>
        db.productImage.create({
          data: { productId: product.id, url, sortOrder: idx },
        })
      )
    );
  }

  // Audit log for product creation (non-blocking)
  try {
    if (db.auditLog?.create) {
      await db.auditLog.create({
        data: {
          adminId: admin.sub,
          action: 'CREATE',
          resource: 'product',
          resourceId: product.id,
          details: { sku: product.sku, name: product.name, category: product.category },
        },
      });
    }
  } catch { /* audit failure should not block */ }

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
  const admin = getAdmin(c);
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
    brand_name: z.string().optional(),
    size: z.array(z.string()).min(1).optional(),
    color: z.array(z.string()).min(1).optional(),
    rental_price_1day: z.number().int().min(0).optional(),
    rental_price_3day: z.number().int().min(0).optional(),
    rental_price_5day: z.number().int().min(0).optional(),
    retail_price: z.number().int().min(0).optional(),
    variable_cost: z.number().int().min(0).optional(),
    cost_price: z.number().int().min(0).optional(),
    deposit: z.number().int().min(0).optional(),
    stock_quantity: z.number().int().min(0).optional(),
    available: z.boolean().optional(),
    product_status: z.enum(['active', 'sold', 'decommissioned']).optional(),
    selling_price: z.number().int().min(0).optional(),
    image_urls: z.array(z.string().url()).optional(),
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
  if (!parsed.data.brand_id && parsed.data.brand_name) {
    let brand = await db.brand.findFirst({ where: { name: { equals: parsed.data.brand_name, mode: 'insensitive' } } });
    if (!brand) brand = await db.brand.create({ data: { name: parsed.data.brand_name } });
    updateData.brand = { connect: { id: brand.id } };
  }
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
  if (parsed.data.cost_price !== undefined) updateData.costPrice = parsed.data.cost_price;
  if (parsed.data.product_status !== undefined) {
    updateData.productStatus = parsed.data.product_status;
    if (parsed.data.product_status === 'sold') {
      updateData.soldAt = new Date();
      updateData.available = false;
      updateData.stockQuantity = 0;
    }
  }
  if (parsed.data.selling_price !== undefined) updateData.sellingPrice = parsed.data.selling_price;

  const updated = await db.product.update({
    where: { id },
    data: updateData,
  });

  // Audit log for product update (non-blocking)
  try {
    if (db.auditLog?.create) {
      await db.auditLog.create({
        data: {
          adminId: admin.sub,
          action: 'UPDATE',
          resource: 'product',
          resourceId: id,
          details: { sku: product.sku, changes: parsed.data },
        },
      });
    }
  } catch { /* audit failure should not block */ }

  // Handle image URLs if provided
  if (parsed.data.image_urls && parsed.data.image_urls.length > 0) {
    // Delete existing images and re-create
    await db.productImage.deleteMany({ where: { productId: id } });
    await Promise.all(
      parsed.data.image_urls.map((url, idx) =>
        db.productImage.create({ data: { productId: id, url, sortOrder: idx } })
      )
    );
  }

  // Create finance transaction if marked as sold
  if (parsed.data.product_status === 'sold' && parsed.data.selling_price) {
    try {
      await db.financeTransaction.create({
        data: {
          txType: 'force_buy',
          amount: parsed.data.selling_price,
          note: `Product sold: ${product.sku} - ${product.name}`,
          createdBy: admin.sub,
        },
      });
    } catch { /* finance failure should not block */ }
  }

  return success(c, {
    id: updated.id,
    sku: updated.sku,
    name: updated.name,
    updated_at: updated.updatedAt.toISOString(),
  });
});

// GET /api/v1/admin/products/:id/detail — Full product detail with images, rental history, calendar
adminProducts.get('/:id/detail', async (c) => {
  const db = getDb();
  const id = c.req.param('id');

  const product = await db.product.findUnique({
    where: { id },
    include: {
      brand: true,
      images: { orderBy: { sortOrder: 'asc' } },
      orderItems: {
        include: {
          order: {
            select: {
              id: true,
              orderNumber: true,
              status: true,
              rentalStartDate: true,
              rentalEndDate: true,
              totalDays: true,
              createdAt: true,
              customer: { select: { firstName: true, lastName: true, phone: true } },
            },
          },
        },
        orderBy: { order: { createdAt: 'desc' } },
      },
    },
  });

  if (!product) {
    return error(c, 404, 'NOT_FOUND', 'Product not found');
  }

  // Calculate P&L
  const completedStatuses = ['returned', 'cleaning', 'repair', 'finished'];
  const completedItems = product.orderItems.filter((oi) => completedStatuses.includes(oi.order.status));
  const totalRentalRevenue = completedItems.reduce((sum, oi) => sum + oi.subtotal, 0);

  return success(c, {
    id: product.id,
    sku: product.sku,
    name: product.name,
    name_i18n: product.nameI18n,
    description: product.description,
    category: product.category,
    brand: product.brand?.name ?? null,
    brand_id: product.brandId,
    thumbnail: product.images[0]?.url ?? product.thumbnailUrl,
    images: product.images.map((img) => ({ id: img.id, url: img.url, alt: img.altText })),
    size: product.size,
    color: product.color,
    rental_prices: {
      '1day': product.rentalPrice1Day,
      '3day': product.rentalPrice3Day,
      '5day': product.rentalPrice5Day,
    },
    retail_price: product.retailPrice,
    cost_price: product.costPrice,
    variable_cost: product.variableCost,
    deposit: product.deposit,
    selling_price: product.sellingPrice,
    product_status: product.productStatus,
    sold_at: product.soldAt?.toISOString() ?? null,
    stock: product.stockQuantity,
    rental_count: product.rentalCount,
    available: product.available,
    rental_history: product.orderItems.map((oi) => ({
      order_id: oi.order.id,
      order_number: oi.order.orderNumber,
      customer_name: `${oi.order.customer.firstName} ${oi.order.customer.lastName}`,
      customer_phone: oi.order.customer.phone,
      rental_start: oi.order.rentalStartDate.toISOString().split('T')[0],
      rental_end: oi.order.rentalEndDate.toISOString().split('T')[0],
      rental_days: oi.order.totalDays,
      revenue: oi.subtotal,
      status: oi.order.status,
      date: oi.order.createdAt.toISOString(),
    })),
    calendar: product.orderItems.map((oi) => ({
      start: oi.order.rentalStartDate.toISOString().split('T')[0],
      end: oi.order.rentalEndDate.toISOString().split('T')[0],
      status: oi.order.status,
      order_number: oi.order.orderNumber,
    })),
    profit_summary: {
      buying_cost: product.costPrice,
      total_rental_revenue: totalRentalRevenue,
      selling_price: product.sellingPrice,
      net_pl: totalRentalRevenue + product.sellingPrice - product.costPrice,
    },
  });
});

// ─── M03: ROI Per Dress ──────────────────────────────────────────────────

// GET /api/v1/admin/products/:id/roi
adminProducts.get('/:id/roi', async (c) => {
  const db = getDb();
  const id = c.req.param('id');

  const product = await db.product.findUnique({
    where: { id },
    include: {
      orderItems: {
        include: {
          order: { select: { status: true, totalAmount: true, createdAt: true } },
        },
      },
      financeTransactions: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!product) {
    return error(c, 404, 'NOT_FOUND', 'Product not found');
  }

  const purchaseCost = product.costPrice;
  const completedOrders = product.orderItems.filter((oi) =>
    ['returned', 'cleaning', 'repair', 'finished'].includes(oi.order.status)
  );
  const totalRentals = completedOrders.length;

  // Revenue from finance transactions linked to this product
  const revenueTypes = ['rental_revenue', 'late_fee', 'damage_fee', 'force_buy', 'deposit_forfeited'];
  const expenseTypes = ['cleaning', 'repair', 'cogs', 'shipping'];

  let totalRevenue = 0;
  let totalExpenses = 0;

  for (const tx of product.financeTransactions) {
    if (revenueTypes.includes(tx.txType)) {
      totalRevenue += tx.amount;
    } else if (expenseTypes.includes(tx.txType)) {
      totalExpenses += Math.abs(tx.amount);
    }
  }

  // If no product-linked transactions, estimate from order item subtotals
  if (totalRevenue === 0 && totalRentals > 0) {
    totalRevenue = completedOrders.reduce((sum, oi) => sum + oi.subtotal, 0);
  }

  const netProfit = totalRevenue - totalExpenses;
  const roi = purchaseCost > 0 ? ((totalRevenue - totalExpenses - purchaseCost) / purchaseCost) * 100 : 0;
  const revenuePerRental = totalRentals > 0 ? Math.round(totalRevenue / totalRentals) : 0;
  const breakEvenRentals = revenuePerRental > 0 ? Math.ceil(purchaseCost / revenuePerRental) : 0;

  const costHistory = product.financeTransactions.map((tx) => ({
    date: tx.createdAt.toISOString().split('T')[0],
    type: tx.txType,
    amount: tx.amount,
    note: tx.note,
  }));

  return success(c, {
    product_id: product.id,
    product_name: product.name,
    sku: product.sku,
    purchase_cost: purchaseCost,
    total_revenue: totalRevenue,
    total_expenses: totalExpenses,
    net_profit: netProfit,
    roi: Math.round(roi * 100) / 100,
    total_rentals: totalRentals,
    revenue_per_rental: revenuePerRental,
    break_even_rentals: breakEvenRentals,
    cost_history: costHistory,
  });
});

// GET /api/v1/admin/products/roi/summary
adminProducts.get('/roi/summary', async (c) => {
  const db = getDb();

  const products = await db.product.findMany({
    include: {
      orderItems: {
        include: {
          order: { select: { status: true } },
        },
      },
      financeTransactions: true,
    },
  });

  const revenueTypes = ['rental_revenue', 'late_fee', 'damage_fee', 'force_buy', 'deposit_forfeited'];
  const expenseTypes = ['cleaning', 'repair', 'cogs', 'shipping'];

  const roiData = products.map((product) => {
    const purchaseCost = product.costPrice;
    const completedOrders = product.orderItems.filter((oi) =>
      ['returned', 'cleaning', 'repair', 'finished'].includes(oi.order.status)
    );
    const totalRentals = completedOrders.length;

    let totalRevenue = 0;
    let totalExpenses = 0;

    for (const tx of product.financeTransactions) {
      if (revenueTypes.includes(tx.txType)) totalRevenue += tx.amount;
      else if (expenseTypes.includes(tx.txType)) totalExpenses += Math.abs(tx.amount);
    }

    if (totalRevenue === 0 && totalRentals > 0) {
      totalRevenue = completedOrders.reduce((sum, oi) => sum + oi.subtotal, 0);
    }

    const roi = purchaseCost > 0 ? ((totalRevenue - totalExpenses - purchaseCost) / purchaseCost) * 100 : 0;

    return {
      product_id: product.id,
      product_name: product.name,
      sku: product.sku,
      purchase_cost: purchaseCost,
      total_revenue: totalRevenue,
      total_expenses: totalExpenses,
      net_profit: totalRevenue - totalExpenses,
      roi: Math.round(roi * 100) / 100,
      total_rentals: totalRentals,
    };
  });

  roiData.sort((a, b) => b.roi - a.roi);

  return success(c, roiData);
});

// ─── M04: Popularity/Utilization Metrics ─────────────────────────────────

// GET /api/v1/admin/products/:id/metrics
adminProducts.get('/:id/metrics', async (c) => {
  const db = getDb();
  const id = c.req.param('id');

  const product = await db.product.findUnique({
    where: { id },
    include: {
      orderItems: {
        include: {
          order: {
            select: {
              status: true,
              rentalStartDate: true,
              rentalEndDate: true,
              totalDays: true,
              createdAt: true,
            },
          },
        },
      },
    },
  });

  if (!product) {
    return error(c, 404, 'NOT_FOUND', 'Product not found');
  }

  const completedItems = product.orderItems.filter((oi) =>
    ['returned', 'cleaning', 'repair', 'finished', 'shipped'].includes(oi.order.status)
  );

  const rentalCount = completedItems.length;

  // Occupancy rate
  const firstRentalDate = completedItems.length > 0
    ? new Date(Math.min(...completedItems.map((oi) => oi.order.createdAt.getTime())))
    : null;
  const now = new Date();
  const totalDaysSinceFirst = firstRentalDate
    ? Math.max(1, Math.ceil((now.getTime() - firstRentalDate.getTime()) / (1000 * 60 * 60 * 24)))
    : 1;
  const totalDaysRented = completedItems.reduce((sum, oi) => sum + oi.order.totalDays, 0);
  const occupancyRate = Math.min(100, Math.round((totalDaysRented / totalDaysSinceFirst) * 10000) / 100);

  // Average rental duration
  const averageRentalDuration = rentalCount > 0
    ? Math.round((totalDaysRented / rentalCount) * 10) / 10
    : 0;

  // Last rented date
  const lastRentedDate = completedItems.length > 0
    ? new Date(Math.max(...completedItems.map((oi) => oi.order.createdAt.getTime()))).toISOString().split('T')[0]
    : null;

  // Trend (last 30 days vs previous 30 days)
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sixtyDaysAgo = new Date(now);
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const recentCount = completedItems.filter((oi) => oi.order.createdAt >= thirtyDaysAgo).length;
  const previousCount = completedItems.filter((oi) => oi.order.createdAt >= sixtyDaysAgo && oi.order.createdAt < thirtyDaysAgo).length;

  let trend: 'up' | 'down' | 'stable' = 'stable';
  if (recentCount > previousCount) trend = 'up';
  else if (recentCount < previousCount) trend = 'down';

  // Monthly breakdown (last 12 months)
  const monthlyBreakdown: Array<{ month: string; rental_count: number; revenue: number }> = [];
  for (let i = 11; i >= 0; i--) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
    const monthKey = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
    const monthItems = completedItems.filter(
      (oi) => oi.order.createdAt >= monthDate && oi.order.createdAt <= monthEnd
    );
    monthlyBreakdown.push({
      month: monthKey,
      rental_count: monthItems.length,
      revenue: monthItems.reduce((sum, oi) => sum + oi.subtotal, 0),
    });
  }

  return success(c, {
    product_id: product.id,
    product_name: product.name,
    rental_count: rentalCount,
    occupancy_rate: occupancyRate,
    average_rental_duration: averageRentalDuration,
    last_rented_date: lastRentedDate,
    trend,
    monthly_breakdown: monthlyBreakdown,
  });
});

// GET /api/v1/admin/products/popularity
adminProducts.get('/popularity', async (c) => {
  const db = getDb();
  const locale = parseLocale(c.req.query('locale'));
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
  const perPage = Math.min(100, Math.max(1, parseInt(c.req.query('per_page') ?? '20', 10)));

  const [products, total] = await Promise.all([
    db.product.findMany({
      include: {
        brand: { select: { name: true } },
        images: { orderBy: { sortOrder: 'asc' }, take: 1 },
      },
      orderBy: { rentalCount: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    db.product.count(),
  ]);

  return success(c, products.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: localizeField(p.nameI18n as Record<string, string> | null, p.name, locale),
    category: p.category,
    brand: p.brand?.name ?? null,
    thumbnail: p.images[0]?.url ?? p.thumbnailUrl,
    rental_count: p.rentalCount,
    rental_price_1day: p.rentalPrice1Day,
    cost_price: p.costPrice,
    available: p.available,
  })), { page, per_page: perPage, total, total_pages: Math.ceil(total / perPage) });
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

  // Audit log for product deletion (non-blocking)
  try {
    if (db.auditLog?.create) {
      await db.auditLog.create({
        data: {
          adminId: admin.sub,
          action: 'DELETE',
          resource: 'product',
          resourceId: id,
          details: { sku: product.sku, name: product.name },
        },
      });
    }
  } catch { /* audit failure should not block */ }

  return success(c, { id, deleted: true });
});

export default adminProducts;
