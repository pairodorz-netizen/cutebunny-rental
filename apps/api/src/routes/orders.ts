import { Hono } from 'hono';
import { z } from 'zod';

import { getDb } from '../lib/db';
import { success, created, error } from '../lib/response';
import { confirmHolds } from '../lib/availability';
import { calculateShippingFee } from '../lib/shipping';
import { getCartStore } from './cart';

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
      email: z.string().email(),
    }),
    shipping_address: z.object({
      province_code: z.string().min(1),
      line1: z.string().min(1),
      city: z.string().optional(),
      postal_code: z.string().optional(),
    }),
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

  // Calculate shipping
  const shippingResult = await calculateShippingFee(db, parsed.data.shipping_address.province_code);
  const deliveryFee = shippingResult?.totalFee ?? 150; // fallback to nationwide

  // Find or create customer
  let customer = await db.customer.findUnique({
    where: { email: parsed.data.customer.email },
  });

  if (!customer) {
    const nameParts = parsed.data.customer.name.split(' ');
    customer = await db.customer.create({
      data: {
        email: parsed.data.customer.email,
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

  const subtotal = cartData.items.reduce((sum, i) => sum + i.subtotal, 0);
  const totalDeposit = cartData.items.reduce((sum, i) => sum + i.deposit, 0);
  const totalAmount = subtotal + totalDeposit + deliveryFee;

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
      deliveryFee,
      totalAmount,
      shippingSnapshot: {
        name: parsed.data.customer.name,
        phone: parsed.data.customer.phone,
        email: parsed.data.customer.email,
        address: parsed.data.shipping_address,
        zone: shippingResult?.zone ?? 'Nationwide',
      },
    },
  });

  // Create order items and confirm availability holds
  for (const item of cartData.items) {
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

  // Create initial status log
  await db.orderStatusLog.create({
    data: {
      orderId: order.id,
      fromStatus: null,
      toStatus: 'unpaid',
      note: 'Order placed',
    },
  });

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
      delivery_fee: deliveryFee,
      total: totalAmount,
    },
  });
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

  // Generate storage key (in production, upload to R2/S3)
  const ext = isJpeg ? 'jpg' : 'png';
  const storageKey = `payments/${order.orderNumber}/slip-${Date.now()}.${ext}`;

  const slip = await db.paymentSlip.create({
    data: {
      orderId: order.id,
      storageKey,
      declaredAmount,
      bankName: bankName ?? null,
      verificationStatus: 'pending',
    },
  });

  return created(c, {
    id: slip.id,
    storage_key: storageKey,
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
