import { Hono } from 'hono';
import { z } from 'zod';
import { verify } from 'hono/jwt';
import { createClient } from '@supabase/supabase-js';

import { getDb } from '../lib/db';
import { getEnv } from '../lib/env';
import { success, created, error } from '../lib/response';
import { confirmHolds, createLifecycleBlocks, releaseTentativeHolds } from '../lib/availability';
import { calculateShippingFee, getShippingFeeEnabled } from '../lib/shipping';
import { getMessengerConfig, estimateMessenger, resolveReturnMethod } from '../lib/messenger';
import { getCartStore } from './cart';

function getJwtSecret(): string {
  return getEnv().JWT_SECRET || 'dev-secret-change-in-production';
}

function getSupabaseClient() {
  const env = getEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}

const orders = new Hono();

function generateOrderNumber(): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const seq = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
  return `ORD-${yy}${mm}${seq}`;
}

// C08b: POST /api/v1/orders — Place order from cart
orders.post('/', async (c) => {
  const db = getDb();

  const bodySchema = z.object({
    cart_token: z.string().uuid(),
    customer: z.object({
      name: z.string().min(1),
      phone: z.string().min(1),
      email: z.string().email().optional(),
    }),
    shipping_address: z.object({
      province_code: z.string().min(1),
      line1: z.string().min(1),
      city: z.string().optional(),
      postal_code: z.string().optional(),
    }),
    credit_applied: z.number().int().min(0).optional(),
    document_urls: z.array(z.object({
      url: z.string().url(),
      doc_type: z.string(),
    })).optional(),
    delivery_method: z.enum(['standard', 'messenger']).default('standard'),
    customer_coords: z.object({
      lat: z.number(),
      lng: z.number(),
    }).optional(),
  });

  const body = await c.req.json().catch(() => null);
  if (!body) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid request body');
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid order data', parsed.error.flatten());
  }

  const cartData = getCartStore().get(parsed.data.cart_token);
  if (!cartData) {
    return error(c, 404, 'CART_NOT_FOUND', 'Cart session expired or not found');
  }

  if (cartData.expiresAt <= Date.now()) {
    getCartStore().delete(parsed.data.cart_token);
    return error(c, 404, 'CART_EXPIRED', 'Cart session has expired');
  }

  // Clean up stale tentative holds older than 30 minutes
  await db.availabilityCalendar.deleteMany({
    where: {
      slotStatus: 'tentative',
      updatedAt: { lt: new Date(Date.now() - 30 * 60 * 1000) },
    },
  });

  try {
  // Calculate shipping. Honors the global `shipping_fee_enabled` toggle
  // (#36): when disabled, ALL orders compute shipping_cost = 0 regardless
  // of per-province config, including the nationwide fallback path.
  const feeEnabled = await getShippingFeeEnabled(db);
  const shippingResult = await calculateShippingFee(
    db,
    parsed.data.shipping_address.province_code,
    1,
    { feeEnabled },
  );
  const deliveryFee = feeEnabled ? (shippingResult?.totalFee ?? 150) : 0;

  // Messenger delivery handling
  const deliveryMethod = parsed.data.delivery_method;
  let messengerFeeSend = 0;
  let messengerFeeReturn = 0;
  let messengerDistanceKm: number | null = null;
  let messengerPaymentMode: string | null = null;
  let returnMethod: 'standard' | 'messenger' = 'standard';

  if (deliveryMethod === 'messenger') {
    const messengerConfig = await getMessengerConfig(db);
    if (!messengerConfig.enabled) {
      return error(c, 400, 'MESSENGER_DISABLED', 'Messenger delivery is not available');
    }

    if (parsed.data.customer_coords) {
      const estimate = estimateMessenger(
        parsed.data.customer_coords.lat,
        parsed.data.customer_coords.lng,
        messengerConfig,
      );

      if (!estimate.available) {
        return error(c, 400, 'MESSENGER_UNAVAILABLE', 'Messenger delivery unavailable for this location');
      }

      messengerFeeSend = estimate.fee;
      messengerDistanceKm = estimate.distanceKm;
    }

    messengerPaymentMode = 'cod';
  }

  // Determine return method based on rental days
  const maxRentalDays = Math.max(...cartData.items.map((i) => i.rental_days));
  returnMethod = resolveReturnMethod(maxRentalDays, deliveryMethod);

  if (returnMethod === 'messenger' && messengerDistanceKm !== null) {
    const messengerConfig = await getMessengerConfig(db);
    const returnEstimate = estimateMessenger(
      parsed.data.customer_coords!.lat,
      parsed.data.customer_coords!.lng,
      messengerConfig,
    );
    messengerFeeReturn = returnEstimate.available ? returnEstimate.fee : 0;
  }

  // If a valid customer JWT is present, use the registered customer directly.
  // Otherwise, fall through to the guest checkout find-or-create flow.
  let customer: { id: string; creditBalance: number } | null = null;
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const decoded = await verify(authHeader.slice(7), getJwtSecret(), 'HS256');
      if (decoded.type === 'customer' && typeof decoded.sub === 'string') {
        const existing = await db.customer.findUnique({ where: { id: decoded.sub } });
        if (existing) {
          customer = existing;
        }
      }
    } catch {
      // Invalid/expired token — fall through to guest flow
    }
  }

  if (!customer) {
    // Guest checkout: find by email, then phone, then create
    customer = parsed.data.customer.email
      ? await db.customer.findUnique({ where: { email: parsed.data.customer.email } })
      : null;

    if (!customer) {
      customer = await db.customer.findFirst({ where: { phone: parsed.data.customer.phone } });
    }

    if (!customer) {
      const nameParts = parsed.data.customer.name.split(' ');
      customer = await db.customer.create({
        data: {
          email: parsed.data.customer.email ?? `${Date.now()}@no-email.cutebunny.rental`,
          firstName: nameParts[0] ?? parsed.data.customer.name,
          lastName: nameParts.slice(1).join(' ') || '-',
          phone: parsed.data.customer.phone,
          address: {
            line1: parsed.data.shipping_address.line1,
            city: parsed.data.shipping_address.city ?? '',
            postalCode: parsed.data.shipping_address.postal_code ?? '',
            provinceCode: parsed.data.shipping_address.province_code,
            country: 'Thailand',
          },
        },
      });
    }
  }

  const subtotal = cartData.items.reduce((sum, i) => sum + i.subtotal, 0);
  const totalDeposit = cartData.items.reduce((sum, i) => sum + i.deposit, 0);

  // Handle credit application
  // Messenger fees are COD — not included in the transfer total
  const effectiveDeliveryFee = deliveryMethod === 'messenger' ? 0 : deliveryFee;
  let creditApplied = 0;
  if (parsed.data.credit_applied && parsed.data.credit_applied > 0) {
    const maxCredit = Math.min(parsed.data.credit_applied, customer.creditBalance, subtotal + totalDeposit + effectiveDeliveryFee);
    creditApplied = maxCredit;
  }

  const totalAmount = subtotal + totalDeposit + effectiveDeliveryFee - creditApplied;

  // Determine rental date range from cart items
  const startDates = cartData.items.map((i) => new Date(i.rental_start));
  const endDates = cartData.items.map((i) => {
    const d = new Date(i.rental_start);
    d.setDate(d.getDate() + i.rental_days - 1);
    return d;
  });
  const earliestStart = new Date(Math.min(...startDates.map((d) => d.getTime())));
  const latestEnd = new Date(Math.max(...endDates.map((d) => d.getTime())));
  const totalDays = Math.max(...cartData.items.map((i) => i.rental_days));

  const orderToken = crypto.randomUUID();
  const orderNumber = generateOrderNumber();

  const order = await db.order.create({
    data: {
      id: orderToken,
      orderNumber,
      customerId: customer.id,
      status: 'unpaid',
      rentalStartDate: earliestStart,
      rentalEndDate: latestEnd,
      totalDays,
      subtotal,
      deposit: totalDeposit,
      deliveryFee: effectiveDeliveryFee,
      creditApplied,
      totalAmount,
      deliveryMethod,
      returnMethod,
      messengerFeeSend,
      messengerFeeReturn,
      messengerDistanceKm,
      messengerPaymentMode,
      shippingSnapshot: {
        name: parsed.data.customer.name,
        phone: parsed.data.customer.phone,
        ...(parsed.data.customer.email ? { email: parsed.data.customer.email } : {}),
        address: parsed.data.shipping_address,
        zone: shippingResult?.zone ?? 'Nationwide',
        delivery_method: deliveryMethod,
        return_method: returnMethod,
        messenger_fee_send: messengerFeeSend,
        messenger_fee_return: messengerFeeReturn,
        messenger_distance_km: messengerDistanceKm,
        ...(parsed.data.customer_coords ? { customer_lat: parsed.data.customer_coords.lat, customer_lng: parsed.data.customer_coords.lng } : {}),
      },
    },
  });

  // Create order items and confirm availability holds
  for (const item of cartData.items) {
    if (item.is_combo && item.combo_components && item.combo_components.length > 0) {
      // Combo set: expand into component product OrderItems with revenue split
      for (const comp of item.combo_components) {
        const compSubtotal = Math.round(item.subtotal * comp.revenue_share_pct / 100);
        const compPricePerDay = Math.round(compSubtotal / item.rental_days);

        await db.orderItem.create({
          data: {
            orderId: order.id,
            productId: comp.product_id,
            productName: `${item.product_name} — ${comp.product_name}${comp.label ? ` (${comp.label})` : ''}`,
            size: item.size,
            quantity: 1,
            rentalPricePerDay: compPricePerDay,
            subtotal: compSubtotal,
            status: 'pending',
          },
        });

        // Confirm tentative holds for each component product
        const startDate = new Date(item.rental_start + 'T00:00:00.000Z');
        await confirmHolds(db, comp.product_id, startDate, item.rental_days, order.id);
      }
    } else {
      // Regular product
      await db.orderItem.create({
        data: {
          orderId: order.id,
          productId: item.product_id,
          productName: item.product_name,
          size: item.size,
          quantity: 1,
          rentalPricePerDay: item.price_per_day,
          subtotal: item.subtotal,
          status: 'pending',
        },
      });

      // Confirm tentative holds as booked
      const startDate = new Date(item.rental_start + 'T00:00:00.000Z');
      await confirmHolds(db, item.product_id, startDate, item.rental_days, order.id);
    }
  }

  // FEAT-402: Create lifecycle blocking windows (shipping + wash)
  const provinceCode = parsed.data.shipping_address.province_code;
  const provinceConfig = await db.shippingProvinceConfig.findFirst({
    where: { provinceCode },
  });
  const shippingDays = provinceConfig?.shippingDays ?? 2;

  const washConfig = await db.systemConfig.findUnique({
    where: { key: 'wash_duration_days' },
  });
  const washDurationDays = washConfig ? parseInt(String(washConfig.value), 10) || 1 : 1;

  for (const item of cartData.items) {
    const startDate = new Date(item.rental_start + 'T00:00:00.000Z');
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + item.rental_days - 1);

    if (item.is_combo && item.combo_components) {
      for (const comp of item.combo_components) {
        await createLifecycleBlocks(db, comp.product_id, startDate, endDate, shippingDays, washDurationDays, order.id);
      }
    } else {
      await createLifecycleBlocks(db, item.product_id, startDate, endDate, shippingDays, washDurationDays, order.id);
    }
  }

  // Create initial status log
  await db.orderStatusLog.create({
    data: {
      orderId: order.id,
      fromStatus: null,
      toStatus: 'unpaid',
      note: 'Order placed',
    },
  });

  // Deduct credit from customer balance
  if (creditApplied > 0) {
    await db.customer.update({
      where: { id: customer.id },
      data: { creditBalance: { decrement: creditApplied } },
    });
  }

  // Store customer documents linked to the order's customer
  if (parsed.data.document_urls && parsed.data.document_urls.length > 0) {
    const docTypeMap: Record<string, 'id_card_front' | 'id_card_back' | 'facebook' | 'instagram' | 'selfie_with_id'> = {
      id_card: 'id_card_front',
      social_media: 'facebook',
    };
    for (const doc of parsed.data.document_urls) {
      try {
        if (doc.doc_type === 'payment_slip') {
          await db.paymentSlip.create({
            data: {
              orderId: order.id,
              storageKey: doc.url,
              declaredAmount: 0,
              verificationStatus: 'pending',
            },
          });
        } else {
          const mappedType = docTypeMap[doc.doc_type] ?? 'id_card_front';
          await db.customerDocument.create({
            data: {
              customerId: customer.id,
              docType: mappedType,
              storageKey: doc.url,
              verified: false,
            },
          });
        }
      } catch {
        // Non-critical — continue if document creation fails
      }
    }
  }

  // Remove cart
  getCartStore().delete(parsed.data.cart_token);

  return created(c, {
    order_token: orderToken,
    order_number: orderNumber,
    payment_instructions: {
      bank_name: 'Kasikorn Bank (KBank)',
      account_number: 'XXX-X-XXXXX-X',
      account_name: 'CuteBunny Rental Co., Ltd.',
      amount: totalAmount,
      currency: 'THB',
      note: `Please transfer and upload payment slip. Reference: ${orderNumber}`,
    },
    summary: {
      subtotal,
      deposit: totalDeposit,
      delivery_fee: effectiveDeliveryFee,
      credit_applied: creditApplied,
      total: totalAmount,
    },
    delivery: {
      delivery_method: deliveryMethod,
      return_method: returnMethod,
      messenger_fee_send: messengerFeeSend,
      messenger_fee_return: messengerFeeReturn,
      messenger_distance_km: messengerDistanceKm,
      messenger_payment_mode: messengerPaymentMode,
      cod_total: messengerFeeSend + messengerFeeReturn,
    },
  });

  } catch (err) {
    // Release tentative holds for all cart items so dates become available again
    for (const item of cartData.items) {
      try {
        const startDate = new Date(item.rental_start + 'T00:00:00.000Z');
        if (item.is_combo && item.combo_components) {
          for (const comp of item.combo_components) {
            await releaseTentativeHolds(db, comp.product_id, startDate, item.rental_days);
          }
        } else {
          await releaseTentativeHolds(db, item.product_id, startDate, item.rental_days);
        }
      } catch {
        // Best-effort cleanup — continue releasing other items
      }
    }
    return error(c, 500, 'ORDER_CREATION_FAILED', 'Failed to create order. Please try again.');
  }
});

// GET /api/v1/orders/customer/lookup?email=xxx — Look up customer by email for credit balance
orders.get('/customer/lookup', async (c) => {
  const db = getDb();
  const email = c.req.query('email');

  if (!email) {
    return error(c, 400, 'VALIDATION_ERROR', 'Email query parameter is required');
  }

  const customer = await db.customer.findUnique({
    where: { email },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      creditBalance: true,
    },
  });

  if (!customer) {
    return success(c, { found: false, credit_balance: 0 });
  }

  return success(c, {
    found: true,
    name: `${customer.firstName} ${customer.lastName}`,
    phone: customer.phone,
    credit_balance: customer.creditBalance,
  });
});

// POST /api/v1/orders/upload-document — Upload customer document (ID card, social media screenshot)
orders.post('/upload-document', async (c) => {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return error(c, 500, 'CONFIG_ERROR', 'Storage is not configured');
  }

  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  const docType = (formData.get('doc_type') as string) || 'general';

  if (!file) {
    return error(c, 400, 'VALIDATION_ERROR', 'No file provided');
  }

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!allowedTypes.includes(file.type)) {
    return error(c, 400, 'VALIDATION_ERROR', 'Only JPEG, PNG, WebP, and PDF files are allowed');
  }

  if (file.size > 10 * 1024 * 1024) {
    return error(c, 400, 'VALIDATION_ERROR', 'File size must be less than 10MB');
  }

  const ext = file.name.split('.').pop() ?? 'jpg';
  const timestamp = Date.now();
  const rand = Math.random().toString(36).substring(2, 8);
  const fileName = `customer-documents/${docType}/${timestamp}-${rand}.${ext}`;

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

  const { data: urlData } = supabase.storage
    .from('product-images')
    .getPublicUrl(uploadData.path);

  return success(c, { url: urlData.publicUrl, doc_type: docType }, undefined, 201);
});

// C10: POST /api/v1/orders/:order_token/payment-slip — Upload payment slip
orders.post('/:order_token/payment-slip', async (c) => {
  const db = getDb();
  const orderToken = c.req.param('order_token');

  const order = await db.order.findUnique({ where: { id: orderToken } });
  if (!order) {
    return error(c, 404, 'NOT_FOUND', 'Order not found');
  }

  const formData = await c.req.formData().catch(() => null);
  if (!formData) {
    return error(c, 400, 'VALIDATION_ERROR', 'Multipart form data required');
  }

  const file = formData.get('file') as File | null;
  const declaredAmountStr = formData.get('declared_amount') as string | null;
  const bankName = formData.get('bank_name') as string | null;

  if (!file) {
    return error(c, 400, 'VALIDATION_ERROR', 'File is required');
  }

  // Validate file type by checking magic bytes
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (bytes.length > 10 * 1024 * 1024) {
    return error(c, 400, 'FILE_TOO_LARGE', 'File must be under 10MB');
  }

  const isJpeg = bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;

  if (!isJpeg && !isPng) {
    return error(c, 400, 'INVALID_FILE_TYPE', 'Only JPEG and PNG files are accepted');
  }

  const declaredAmount = parseInt(declaredAmountStr ?? '0', 10);
  if (!declaredAmount || declaredAmount <= 0) {
    return error(c, 400, 'VALIDATION_ERROR', 'Valid declared_amount is required');
  }

  // Upload to Supabase Storage
  const ext = isJpeg ? 'jpg' : 'png';
  const storageKey = `payments/${order.orderNumber}/slip-${Date.now()}.${ext}`;

  let imageUrl = storageKey; // fallback if Supabase not configured

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = (c.env as Record<string, string>)?.SUPABASE_URL;
    const supabaseKey = (c.env as Record<string, string>)?.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('product-images')
        .upload(storageKey, buffer, {
          contentType: isJpeg ? 'image/jpeg' : 'image/png',
          upsert: false,
        });
      if (!uploadError && uploadData) {
        const { data: urlData } = supabase.storage
          .from('product-images')
          .getPublicUrl(uploadData.path);
        imageUrl = urlData.publicUrl;
      }
    }
  } catch { /* Supabase upload failed — use storageKey as fallback */ }

  const slip = await db.paymentSlip.create({
    data: {
      orderId: order.id,
      storageKey: imageUrl,
      declaredAmount,
      bankName: bankName ?? null,
      verificationStatus: 'pending',
    },
  });

  return created(c, {
    id: slip.id,
    storage_key: imageUrl,
    declared_amount: declaredAmount,
    bank_name: bankName,
    verification_status: 'pending',
  });
});

// C13: GET /api/v1/orders/:order_token — Order status lookup
orders.get('/:order_token', async (c) => {
  const db = getDb();
  const orderToken = c.req.param('order_token');

  const order = await db.order.findUnique({
    where: { id: orderToken },
    include: {
      items: {
        include: { product: { select: { sku: true, thumbnailUrl: true } } },
      },
      paymentSlips: {
        select: {
          id: true,
          declaredAmount: true,
          bankName: true,
          verificationStatus: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      },
      customer: {
        select: { firstName: true, lastName: true, email: true },
      },
    },
  });

  if (!order) {
    return error(c, 404, 'NOT_FOUND', 'Order not found');
  }

  return success(c, {
    order_number: order.orderNumber,
    status: order.status,
    rental_period: {
      start: order.rentalStartDate.toISOString().split('T')[0],
      end: order.rentalEndDate.toISOString().split('T')[0],
      days: order.totalDays,
    },
    items: order.items.map((item) => ({
      product_name: item.productName,
      sku: item.product.sku,
      size: item.size,
      quantity: item.quantity,
      price_per_day: item.rentalPricePerDay,
      subtotal: item.subtotal,
      status: item.status,
      thumbnail: item.product.thumbnailUrl,
      late_fee: item.lateFee,
      damage_fee: item.damageFee,
    })),
    summary: {
      subtotal: order.subtotal,
      deposit: order.deposit,
      delivery_fee: order.deliveryFee,
      discount: order.discount,
      credit_applied: order.creditApplied,
      total: order.totalAmount,
    },
    payment_slips: order.paymentSlips.map((slip) => ({
      id: slip.id,
      declared_amount: slip.declaredAmount,
      bank_name: slip.bankName,
      verification_status: slip.verificationStatus,
      submitted_at: slip.createdAt.toISOString(),
    })),
    shipping: order.shippingSnapshot,
    created_at: order.createdAt.toISOString(),
  });
});

export default orders;
