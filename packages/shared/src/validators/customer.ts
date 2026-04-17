import { z } from 'zod';

export const supportedLocaleSchema = z.enum(['en', 'th', 'zh']);

export const addressSchema = z.object({
  label: z.string().min(1).max(100),
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(1).max(100),
  state: z.string().min(1).max(100),
  postalCode: z.string().min(1).max(20),
  country: z.string().min(1).max(100),
  isDefault: z.boolean().default(false),
});

export const createCustomerSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: z.string().min(1).max(20),
  locale: supportedLocaleSchema.default('en'),
  addresses: z.array(addressSchema).default([]),
});

export const updateCustomerSchema = createCustomerSchema.partial();

export const customerFilterSchema = z.object({
  search: z.string().optional(),
  locale: supportedLocaleSchema.optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});
