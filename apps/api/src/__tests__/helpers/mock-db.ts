import { vi } from 'vitest';

const DB_MODELS = [
  'product', 'brand', 'productImage', 'order', 'orderItem', 'orderStatusLog',
  'paymentSlip', 'customer', 'customerDocument', 'availabilityCalendar',
  'inventoryStatusLog', 'shippingZone', 'shippingProvinceConfig',
  'financeTransaction', 'afterSalesEvent', 'i18nString', 'adminUser',
] as const;

/**
 * Creates a mock PrismaClient. Must be called inside vi.hoisted() or beforeEach.
 */
export function createMockDb() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: Record<string, any> = {
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
  };

  for (const model of DB_MODELS) {
    db[model] = {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: 'mock-id' }),
      update: vi.fn().mockResolvedValue({ id: 'mock-id' }),
      delete: vi.fn().mockResolvedValue({ id: 'mock-id' }),
      upsert: vi.fn().mockResolvedValue({ id: 'mock-id' }),
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 } }),
    };
  }

  return db;
}

// ─── Test fixtures ──────────────────────────────────────────────────────

export const MOCK_ADMIN = {
  id: '00000000-0000-0000-0000-000000000099',
  email: 'admin@cutebunny.rental',
  name: 'Test Admin',
  role: 'superadmin' as const,
  passwordHash: '$2a$10$dummyhashfortest',
  lastLoginAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

export const MOCK_PRODUCT = {
  id: '00000000-0000-0000-0000-000000000001',
  sku: 'WED-001',
  name: 'Crystal Wedding Dress',
  nameI18n: { en: 'Crystal Wedding Dress', th: 'ชุดเจ้าสาวคริสตัล', zh: '水晶婚纱' },
  description: 'Beautiful crystal wedding dress',
  descriptionI18n: { en: 'Beautiful crystal wedding dress', th: 'ชุดเจ้าสาวคริสตัลสวยงาม', zh: '美丽的水晶婚纱' },
  category: 'wedding',
  brandId: '00000000-0000-0000-0000-000000000002',
  thumbnailUrl: 'https://example.com/thumb.jpg',
  size: ['S', 'M', 'L'],
  color: ['white', 'ivory'],
  rentalPrice1Day: 1500,
  rentalPrice3Day: 3500,
  rentalPrice5Day: 5000,
  retailPrice: 25000,
  variableCost: 500,
  deposit: 3000,
  stockQuantity: 2,
  rentalCount: 15,
  currency: 'THB',
  available: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  brand: {
    id: '00000000-0000-0000-0000-000000000002',
    name: 'Thai Bridal',
    nameI18n: { en: 'Thai Bridal', th: 'ไทย ไบรดัล', zh: '泰国新娘' },
  },
  images: [
    { id: '00000000-0000-0000-0000-000000000003', url: 'https://example.com/img1.jpg', altText: 'Front view', sortOrder: 1 },
    { id: '00000000-0000-0000-0000-000000000004', url: 'https://example.com/img2.jpg', altText: 'Side view', sortOrder: 2 },
  ],
};

export const MOCK_CUSTOMER = {
  id: '00000000-0000-0000-0000-000000000005',
  firstName: 'Somjai',
  lastName: 'Suksawat',
  email: 'somjai@example.com',
  phone: '0812345678',
  tier: 'silver' as const,
  rentalCount: 5,
  totalPayment: 15000,
  creditBalance: 500,
  tags: [],
  address: { line1: '123 Sukhumvit', city: 'Bangkok', postalCode: '10110', provinceCode: 'BKK', country: 'Thailand' },
  locale: 'th',
  avatarUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

export const MOCK_ORDER = {
  id: '00000000-0000-0000-0000-000000000006',
  orderNumber: 'ORD-240601',
  customerId: '00000000-0000-0000-0000-000000000005',
  status: 'unpaid' as const,
  rentalStartDate: new Date('2026-07-01'),
  rentalEndDate: new Date('2026-07-03'),
  totalDays: 3,
  subtotal: 3500,
  deposit: 3000,
  deliveryFee: 100,
  discount: 0,
  creditApplied: 0,
  totalAmount: 6600,
  shippingSnapshot: { name: 'Somjai', phone: '0812345678', address: { province_code: 'BKK', line1: '123 Sukhumvit' } },
  trackingNumber: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  customer: {
    firstName: 'Somjai',
    lastName: 'Suksawat',
    email: 'somjai@example.com',
    phone: '0812345678',
  },
  items: [
    {
      id: '00000000-0000-0000-0000-000000000007',
      productName: 'Crystal Wedding Dress',
      size: 'M',
      quantity: 1,
      status: 'pending',
      rentalPricePerDay: 1167,
      subtotal: 3500,
      lateFee: 0,
      damageFee: 0,
      product: { sku: 'WED-001', thumbnailUrl: 'https://example.com/thumb.jpg' },
    },
  ],
  paymentSlips: [],
};

export const MOCK_PAYMENT_SLIP = {
  id: '00000000-0000-0000-0000-000000000010',
  orderId: '00000000-0000-0000-0000-000000000006',
  storageKey: 'payments/ORD-240601/slip-1.jpg',
  declaredAmount: 6600,
  bankName: 'KBank',
  verificationStatus: 'pending' as const,
  verifiedBy: null,
  verifiedAt: null,
  note: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

export const MOCK_SHIPPING_PROVINCE = {
  id: '00000000-0000-0000-0000-000000000011',
  provinceCode: 'BKK',
  zoneId: '00000000-0000-0000-0000-000000000012',
  addonFee: 0,
  zone: {
    id: '00000000-0000-0000-0000-000000000012',
    zoneName: 'Bangkok',
    baseFee: 50,
    nameI18n: { en: 'Bangkok', th: 'กรุงเทพ', zh: '曼谷' },
  },
};
