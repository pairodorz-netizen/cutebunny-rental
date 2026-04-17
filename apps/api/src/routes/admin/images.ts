import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import { getDb } from '../../lib/db';
import { getEnv } from '../../lib/env';
import { success, error } from '../../lib/response';

const adminImages = new Hono();

function getSupabaseClient() {
  const env = getEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}

// POST /api/v1/admin/images/upload — Upload product image to Supabase Storage
adminImages.post('/upload', async (c) => {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return error(c, 500, 'CONFIG_ERROR', 'Supabase storage is not configured');
  }

  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  const productId = formData.get('product_id') as string | null;

  if (!file) {
    return error(c, 400, 'VALIDATION_ERROR', 'No file provided');
  }
  if (!productId) {
    return error(c, 400, 'VALIDATION_ERROR', 'product_id is required');
  }

  // Validate file type
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedTypes.includes(file.type)) {
    return error(c, 400, 'VALIDATION_ERROR', 'Only JPEG, PNG, WebP, and GIF images are allowed');
  }

  // Max 5MB
  if (file.size > 5 * 1024 * 1024) {
    return error(c, 400, 'VALIDATION_ERROR', 'File size must be less than 5MB');
  }

  const db = getDb();

  // Verify product exists
  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product) {
    return error(c, 404, 'NOT_FOUND', 'Product not found');
  }

  // Generate unique filename
  const ext = file.name.split('.').pop() ?? 'jpg';
  const timestamp = Date.now();
  const fileName = `${product.sku}/${timestamp}.${ext}`;

  // Upload to Supabase Storage
  const arrayBuffer = await file.arrayBuffer();
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('product-images')
    .upload(fileName, arrayBuffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    return error(c, 500, 'UPLOAD_ERROR', `Failed to upload: ${uploadError.message}`);
  }

  // Get public URL
  const { data: urlData } = supabase.storage
    .from('product-images')
    .getPublicUrl(uploadData.path);

  const publicUrl = urlData.publicUrl;

  // Get current max sortOrder for this product
  const maxSort = await db.productImage.aggregate({
    where: { productId },
    _max: { sortOrder: true },
  });
  const nextSort = (maxSort._max.sortOrder ?? -1) + 1;

  // Create ProductImage record
  const image = await db.productImage.create({
    data: {
      productId,
      url: publicUrl,
      altText: `${product.name} - image ${nextSort + 1}`,
      sortOrder: nextSort,
    },
  });

  return success(c, {
    id: image.id,
    url: image.url,
    alt_text: image.altText,
    sort_order: image.sortOrder,
  }, undefined, 201);
});

// DELETE /api/v1/admin/images/:id — Delete a product image
adminImages.delete('/:id', async (c) => {
  const db = getDb();
  const id = c.req.param('id');

  const image = await db.productImage.findUnique({ where: { id } });
  if (!image) {
    return error(c, 404, 'NOT_FOUND', 'Image not found');
  }

  // Try to delete from Supabase Storage if it's a Supabase URL
  const supabase = getSupabaseClient();
  if (supabase && image.url.includes('supabase')) {
    const pathMatch = image.url.match(/product-images\/(.+)$/);
    if (pathMatch) {
      await supabase.storage.from('product-images').remove([pathMatch[1]]);
    }
  }

  await db.productImage.delete({ where: { id } });

  return success(c, { deleted: true });
});

// GET /api/v1/admin/images/:productId — List images for a product
adminImages.get('/:productId', async (c) => {
  const db = getDb();
  const productId = c.req.param('productId');

  const images = await db.productImage.findMany({
    where: { productId },
    orderBy: { sortOrder: 'asc' },
  });

  return success(c, images.map((img) => ({
    id: img.id,
    url: img.url,
    alt_text: img.altText,
    sort_order: img.sortOrder,
  })));
});

export default adminImages;
