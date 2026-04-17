export interface Customer {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  avatarUrl?: string;
  locale: SupportedLocale;
  addresses: Address[];
  totalOrders: number;
  totalSpent: number;
  createdAt: string;
  updatedAt: string;
}

export interface Address {
  id: string;
  label: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
}

export type SupportedLocale = 'en' | 'th' | 'zh';

export interface CustomerFilter {
  search?: string;
  locale?: SupportedLocale;
  page?: number;
  limit?: number;
}

export interface CustomerListResponse {
  items: Customer[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
