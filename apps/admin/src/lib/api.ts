const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function getToken(): string | null {
  try {
    const stored = localStorage.getItem('auth-storage');
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed.state?.token ?? null;
    }
  } catch {
    // ignore
  }
  return null;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    localStorage.removeItem('auth-storage');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error?.message || `API error: ${res.status}`);
  }
  return json;
}

export interface DashboardStats {
  orders_today: number;
  orders_pending_payment: number;
  orders_shipped: number;
  overdue_returns: number;
  revenue_this_month: number;
  top_products: Array<{ id: string; name: string; rental_count: number }>;
  low_stock_alert: Array<{ id: string; name: string; available_count: number }>;
}

export interface AdminOrder {
  id: string;
  order_number: string;
  status: string;
  customer_name: string;
  customer_phone: string;
  total_amount: number;
  item_count: number;
  created_at: string;
}

export interface AdminOrderDetail {
  id: string;
  order_number: string;
  status: string;
  total_amount: number;
  deposit_total: number;
  delivery_fee: number;
  credit_applied: number;
  customer: {
    id: string;
    name: string;
    phone: string;
    email: string;
  };
  items: Array<{
    id: string;
    product_name: string;
    sku: string;
    size: string;
    rental_days: number;
    price_per_day: number;
    subtotal: number;
    late_fee: number;
    damage_fee: number;
    status: string;
  }>;
  status_log: Array<{
    from_status: string;
    to_status: string;
    changed_by: string;
    note: string;
    created_at: string;
  }>;
  payment_slips: Array<{
    id: string;
    storage_key: string;
    declared_amount: number;
    bank_name: string;
    verification_status: string;
    created_at: string;
  }>;
  shipping: Record<string, unknown>;
  created_at: string;
}

export interface AdminProduct {
  id: string;
  sku: string;
  name: string;
  name_i18n: Record<string, string>;
  category: string;
  brand_name: string | null;
  size: string[];
  color: string[];
  price_1day: number;
  price_3day: number;
  price_5day: number;
  deposit: number;
  rental_count: number;
  available: boolean;
  created_at: string;
}

export interface AdminCustomer {
  id: string;
  name: string;
  phone: string;
  email: string;
  tier: string;
  rental_count: number;
  total_payment: number;
  credit_balance: number;
  created_at: string;
}

export interface AdminCustomerDetail extends AdminCustomer {
  address: Record<string, unknown>;
  tags: string[];
  documents: Array<{ id: string; doc_type: string; status: string }>;
  orders: Array<{
    id: string;
    order_number: string;
    status: string;
    total_amount: number;
    created_at: string;
  }>;
}

export interface CalendarEntry {
  date: string;
  products: Array<{ product_id: string; name: string; status: string }>;
}

export interface FinanceReport {
  period: { year: number; month: number };
  group_by: string;
  groups: Array<{
    key: string;
    label: string;
    revenue: number;
    expenses: number;
    gross_margin: number;
    gross_margin_pct: number;
  }>;
  totals: {
    revenue: number;
    expenses: number;
    gross_margin: number;
    gross_margin_pct: number;
  };
}

export interface ShippingZone {
  id: string;
  zone_name: string;
  base_fee: number;
  provinces: Array<{ province_code: string; addon_fee: number }>;
}

export const adminApi = {
  auth: {
    login: (email: string, password: string) =>
      request<{ data: { access_token: string; admin: { id: string; email: string; name: string; role: string } } }>(
        '/api/v1/admin/auth/login',
        { method: 'POST', body: JSON.stringify({ email, password }) }
      ),
  },
  dashboard: {
    stats: () => request<{ data: DashboardStats }>('/api/v1/admin/dashboard/stats'),
  },
  orders: {
    list: (params: Record<string, string>) => {
      const qs = new URLSearchParams(params).toString();
      return request<{ data: AdminOrder[]; meta: { page: number; per_page: number; total: number; total_pages: number } }>(`/api/v1/admin/orders?${qs}`);
    },
    detail: (id: string) =>
      request<{ data: AdminOrderDetail }>(`/api/v1/admin/orders/${id}`),
    updateStatus: (id: string, body: { to_status: string; tracking_number?: string; note?: string }) =>
      request<{ data: unknown }>(`/api/v1/admin/orders/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    verifySlip: (id: string, body: { slip_id: string; verified: boolean; note?: string }) =>
      request<{ data: unknown }>(`/api/v1/admin/orders/${id}/payment-slip/verify`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    afterSales: (id: string, body: { event_type: string; amount: number; note?: string }) =>
      request<{ data: unknown }>(`/api/v1/admin/orders/${id}/after-sales`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    shippingLabel: (id: string) =>
      request<{ data: unknown }>(`/api/v1/admin/orders/${id}/shipping-label`),
  },
  products: {
    list: (params: Record<string, string>) => {
      const qs = new URLSearchParams(params).toString();
      return request<{ data: AdminProduct[]; meta: { page: number; per_page: number; total: number; total_pages: number } }>(`/api/v1/admin/products?${qs}`);
    },
    create: (body: Record<string, unknown>) =>
      request<{ data: AdminProduct }>('/api/v1/admin/products', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: Record<string, unknown>) =>
      request<{ data: AdminProduct }>(`/api/v1/admin/products/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    delete: (id: string) =>
      request<{ data: { message: string } }>(`/api/v1/admin/products/${id}`, { method: 'DELETE' }),
  },
  calendar: {
    list: (params: Record<string, string>) => {
      const qs = new URLSearchParams(params).toString();
      return request<{ data: CalendarEntry[] }>(`/api/v1/admin/calendar?${qs}`);
    },
  },
  customers: {
    list: (params: Record<string, string>) => {
      const qs = new URLSearchParams(params).toString();
      return request<{ data: AdminCustomer[]; meta: { page: number; per_page: number; total: number; total_pages: number } }>(`/api/v1/admin/customers?${qs}`);
    },
    detail: (id: string) =>
      request<{ data: AdminCustomerDetail }>(`/api/v1/admin/customers/${id}`),
  },
  shipping: {
    zones: () => request<{ data: ShippingZone[] }>('/api/v1/admin/shipping/zones'),
  },
  finance: {
    report: (params: Record<string, string>) => {
      const qs = new URLSearchParams(params).toString();
      return request<{ data: FinanceReport }>(`/api/v1/admin/finance/report?${qs}`);
    },
  },
};
