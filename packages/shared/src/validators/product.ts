import { z } from 'zod';

export const productCategorySchema = z.enum([
  'wedding',
  'evening',
  'cocktail',
  'casual',
  'costume',
  'traditional',
  'accessories',
]);

export const createProductSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  category: productCategorySchema,
  size: z.array(z.string()).min(1),
  color: z.array(z.string()).min(1),
  rentalPricePerDay: z.number().positive(),
  retailPrice: z.number().positive(),
  currency: z.string().default('THB'),
  images: z.array(z.string().url()).default([]),
  thumbnailUrl: z.string().url().optional().default(''),
  available: z.boolean().default(true),
  stockQuantity: z.number().int().min(0).default(0),
  tags: z.array(z.string()).default([]),
});

export const updateProductSchema = createProductSchema.partial();

export const productFilterSchema = z.object({
  category: productCategorySchema.optional(),
  minPrice: z.number().positive().optional(),
  maxPrice: z.number().positive().optional(),
  size: z.string().optional(),
  color: z.string().optional(),
  available: z.boolean().optional(),
  search: z.string().optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});
