import { z } from 'zod';

export const orderStatusSchema = z.enum([
  'pending',
  'confirmed',
  'shipped',
  'delivered',
  'returned',
  'cancelled',
  'overdue',
]);

export const paymentStatusSchema = z.enum(['pending', 'paid', 'refunded', 'failed']);

export const createOrderItemSchema = z.object({
  productId: z.string().uuid(),
  size: z.string().min(1),
  quantity: z.number().int().positive(),
});

export const createOrderSchema = z.object({
  customerId: z.string().uuid(),
  items: z.array(createOrderItemSchema).min(1),
  rentalStartDate: z.string().datetime(),
  rentalEndDate: z.string().datetime(),
  shippingAddressId: z.string().uuid(),
  notes: z.string().max(500).default(''),
});

export const updateOrderStatusSchema = z.object({
  status: orderStatusSchema,
});

export const orderFilterSchema = z.object({
  status: orderStatusSchema.optional(),
  paymentStatus: paymentStatusSchema.optional(),
  customerId: z.string().uuid().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  search: z.string().optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});
