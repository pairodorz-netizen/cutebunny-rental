const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error?.message || `API error: ${res.status}`);
  }
  return json;
}

export interface ProductListItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  brand: string | null;
  thumbnail: string | null;
  size: string[];
  color: string[];
  rental_prices: { '1day': number; '3day': number; '5day': number };
  deposit: number;
  is_popular?: boolean;
  currency: string;
  is_combo?: boolean;
}

export interface ProductDetail extends ProductListItem {
  description: string;
  images: Array<{ id: string; url: string; alt_text: string | null }>;
  ref_price: number;
  extra_day_rate: number;
  related_skus: Array<{ id: string; sku: string; name: string; thumbnail: string | null; price_1day: number }>;
  combo_items?: Array<{
    id: string;
    product_id: string;
    product_sku: string;
    product_name: string;
    product_thumbnail: string | null;
    revenue_share_pct: number;
    label: string | null;
  }>;
}

export interface CalendarDay {
  date: string;
  status: string;
}

export interface CartResponse {
  cart_token: string;
  items: Array<{
    product_id: string;
    rental_days: number;
    rental_start: string;
    product_name: string;
    size: string;
    price_per_day: number;
    subtotal: number;
    deposit: number;
  }>;
  summary: { item_count: number; subtotal: number; deposit: number; estimated_total: number };
  expires_at: string;
}

export interface OrderResponse {
  order_token: string;
  order_number: string;
  payment_instructions: {
    bank_name: string;
    account_number: string;
    account_name: string;
    amount: number;
    currency: string;
    note: string;
  };
  summary: { subtotal: number; deposit: number; delivery_fee: number; total: number };
}

export interface OrderDetail {
  order_number: string;
  status: string;
  rental_period: { start: string; end: string; days: number };
  items: Array<{
    product_name: string;
    sku: string;
    size: string;
    quantity: number;
    price_per_day: number;
    subtotal: number;
    status: string;
    thumbnail: string | null;
    late_fee: number;
    damage_fee: number;
  }>;
  summary: {
    subtotal: number;
    deposit: number;
    delivery_fee: number;
    discount: number;
    credit_applied: number;
    total: number;
  };
  payment_slips: Array<{
    id: string;
    declared_amount: number;
    bank_name: string | null;
    verification_status: string;
    submitted_at: string;
  }>;
  shipping: unknown;
  created_at: string;
}

export interface ShippingCalcResult {
  province_code: string;
  zone: string;
  base_fee: number;
  addon_fee: number;
  total_fee: number;
  shipping_days?: number;
  /** Global shipping fee toggle (#36). Absent on old API deployments. */
  fee_enabled?: boolean;
  currency: string;
}

export interface ShippingFeeToggle {
  enabled: boolean;
}

// BUG-504-A04: customer-side category reader. Backs the product filter UI
// on /products and the category grid on the home page. Payload mirrors
// the A02 public endpoint shape (snake_case at the API boundary).
export interface Category {
  id: string;
  slug: string;
  name_th: string;
  name_en: string;
  sort_order: number;
  visible_frontend: boolean;
  visible_backend: boolean;
}

export const api = {
  categories: {
    list: () => request<{ data: Category[] }>('/api/v1/categories'),
  },
  products: {
    list: (params: Record<string, string>) => {
      const qs = new URLSearchParams(params).toString();
      return request<{ data: ProductListItem[]; meta: { page: number; per_page: number; total: number; total_pages: number } }>(`/api/v1/products?${qs}`);
    },
    detail: (id: string, locale: string) =>
      request<{ data: ProductDetail }>(`/api/v1/products/${id}?locale=${locale}`),
    calendar: (id: string, year: number, month: number, size?: string, color?: string) => {
      const params = new URLSearchParams({ year: String(year), month: String(month) });
      if (size) params.set('size', size);
      if (color) params.set('color', color);
      return request<{ data: { product_id: string; year: number; month: number; days: CalendarDay[] } }>(`/api/v1/products/${id}/calendar?${params}`);
    },
  },
  cart: {
    create: (items: Array<{ product_id: string; rental_days: number; rental_start: string }>) =>
      request<{ data: CartResponse }>('/api/v1/cart', {
        method: 'POST',
        body: JSON.stringify({ items }),
      }),
  },
  orders: {
    create: (body: {
      cart_token: string;
      customer: { name: string; phone: string; email: string };
      shipping_address: { province_code: string; line1: string; city?: string; postal_code?: string };
      credit_applied?: number;
      document_urls?: Array<{ url: string; doc_type: string }>;
    }) =>
      request<{ data: OrderResponse }>('/api/v1/orders', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    customerLookup: (email: string) =>
      request<{ data: { found: boolean; name?: string; phone?: string; credit_balance: number } }>(`/api/v1/orders/customer/lookup?email=${encodeURIComponent(email)}`),
    uploadDocument: (file: File, docType: string) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('doc_type', docType);
      return fetch(`${API_BASE}/api/v1/orders/upload-document`, {
        method: 'POST',
        body: formData,
      }).then((res) => res.json()) as Promise<{ data: { url: string; doc_type: string } }>;
    },
    detail: (token: string) =>
      request<{ data: OrderDetail }>(`/api/v1/orders/${token}`),
    uploadSlip: (token: string, formData: FormData) =>
      fetch(`${API_BASE}/api/v1/orders/${token}/payment-slip`, {
        method: 'POST',
        body: formData,
      }).then((res) => res.json()),
  },
  shipping: {
    calculate: (provinceCode: string, itemCount: number = 1) =>
      request<{ data: ShippingCalcResult }>(`/api/v1/shipping/calculate?province_code=${provinceCode}&item_count=${itemCount}`),
  },
  settings: {
    /** Public read of the global shipping-fee toggle (#36). */
    shippingFeeToggle: () =>
      request<{ data: ShippingFeeToggle }>('/api/v1/settings/shipping/fee-toggle'),
  },
};
