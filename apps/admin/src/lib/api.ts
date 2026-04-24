import { buildApiNetworkError, parseAdminErrorResponse } from '@cutebunny/shared/diagnostics';
import type { TelemetryHandle } from './diag/telemetry-store';

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

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

/**
 * BUG401-A02 Track A: turn opaque `TypeError: Failed to fetch` into a
 * structured ApiNetworkError. A02 adds optional telemetry recording via
 * `diagHandle` — when present, fetch start/end is observed for the
 * already-open submit record. Observe-and-rethrow only: rejected fetches
 * stay rejected, and HTTP 401 stays as a resolved Response with status
 * 401.
 */
async function fetchWithDiagnostics(
  url: string,
  init: RequestInit,
  tokenPresent: boolean,
  diagHandle?: TelemetryHandle,
): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase();
  const startedAt = Date.now();
  diagHandle?.markFetchStart(startedAt);
  try {
    const res = await fetch(url, init);
    diagHandle?.finalizeResolved({
      status: res.status,
      ok: res.ok,
      type: res.type as 'basic' | 'cors' | 'opaque' | 'error',
      headers: res.headers,
    });
    return res;
  } catch (err) {
    const errName = err instanceof Error ? err.name : 'Error';
    const errMsg = err instanceof Error ? err.message : typeof err === 'string' ? err : null;
    diagHandle?.finalizeRejected({
      errorName: errName,
      errorMessage: errMsg,
    });
    throw buildApiNetworkError({
      url,
      method,
      tokenPresent,
      online: typeof navigator !== 'undefined' ? navigator.onLine : true,
      err,
      startedAt,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    });
  }
}

export interface RequestContext {
  diagHandle?: TelemetryHandle;
}

async function request<T>(path: string, options?: RequestInit, ctx?: RequestContext): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const url = `${API_BASE}${path}`;
  const res = await fetchWithDiagnostics(url, { ...options, headers }, !!token, ctx?.diagHandle);

  if (res.status === 401) {
    localStorage.removeItem('auth-storage');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  // BUG-404-A02: content-type-aware reader. Errors are NEVER parsed as
  // JSON blindly — parseAdminErrorResponse handles non-JSON bodies
  // (e.g. plain-text "Internal Server Error") without crashing the
  // admin UI on `JSON.parse`. Success bodies are still JSON.
  if (!res.ok) {
    throw await parseAdminErrorResponse(res);
  }
  return (await res.json()) as T;
}

async function uploadFile<T>(path: string, formData: FormData): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  // Do NOT set Content-Type — browser sets multipart/form-data boundary automatically
  const url = `${API_BASE}${path}`;
  const res = await fetchWithDiagnostics(url, { method: 'POST', headers, body: formData }, !!token);

  if (res.status === 401) {
    localStorage.removeItem('auth-storage');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    throw await parseAdminErrorResponse(res);
  }
  return (await res.json()) as T;
}

export interface DashboardStats {
  orders_today: number;
  orders_pending_payment: number;
  orders_shipped: number;
  overdue_returns: number;
  revenue_this_month: number;
  total_customers: number;
  total_orders: number;
  top_products: Array<{ id: string; sku: string; name: string; rental_count: number; thumbnail: string | null }>;
  low_stock_alert: Array<{ id: string; sku: string; name: string; stock: number }>;
}

export interface AdminOrder {
  id: string;
  order_number: string;
  status: string;
  customer: {
    name: string;
    email: string;
    phone: string;
  };
  items: Array<{
    id: string;
    product_name: string;
    sku: string;
    size: string;
    quantity: number;
    subtotal: number;
    late_fee: number;
    damage_fee: number;
    item_status: string;
    thumbnail: string | null;
  }>;
  tracking_number: string | null;
  total_amount: number;
  credit_applied: number;
  payment_status: string;
  rental_period: {
    start: string;
    end: string;
  };
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
    first_name: string;
    last_name: string;
    phone: string;
    email: string;
    address: Record<string, unknown> | null;
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
    thumbnail: string | null;
    images: Array<{ id: string; url: string; altText: string | null; sortOrder: number }>;
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
  rental_period: {
    start: string;
    end: string;
  };
  audit_logs: Array<{
    id: string;
    action: string;
    resource: string | null;
    details: Record<string, unknown> | null;
    admin_name: string;
    created_at: string;
  }>;
  created_at: string;
}

export interface StockLog {
  id: string;
  type: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface AdminProduct {
  id: string;
  sku: string;
  name: string;
  name_i18n: Record<string, string>;
  category: string;
  brand: string | null;
  thumbnail: string | null;
  size: string[];
  color: string[];
  rental_prices: {
    '1day': number;
    '3day': number;
    '5day': number;
  };
  retail_price: number;
  deposit: number;
  stock: number;
  stock_on_hand: number;
  low_stock_threshold: number;
  rental_count: number;
  available: boolean;
  cost_price: number;
  selling_price: number;
  product_status: string;
  sold_at: string | null;
  deleted_at: string | null;
  variable_cost: number;
  extra_day_rate: number;
  created_at: string;
}

export interface AdminProductDetail {
  id: string;
  sku: string;
  name: string;
  name_i18n: Record<string, string> | null;
  description: string | null;
  category: string;
  brand: string | null;
  brand_id: string | null;
  thumbnail: string | null;
  images: Array<{ id: string; url: string; alt: string | null }>;
  size: string[];
  color: string[];
  rental_prices: { '1day': number; '3day': number; '5day': number };
  retail_price: number;
  cost_price: number;
  variable_cost: number;
  extra_day_rate: number;
  deposit: number;
  selling_price: number;
  product_status: string;
  sold_at: string | null;
  stock: number;
  stock_on_hand: number;
  low_stock_threshold: number;
  rental_count: number;
  available: boolean;
  deleted_at: string | null;
  rental_history: Array<{
    order_id: string;
    order_number: string;
    customer_name: string;
    customer_phone: string;
    rental_start: string;
    rental_end: string;
    rental_days: number;
    revenue: number;
    status: string;
    date: string;
  }>;
  calendar: Array<{
    start: string;
    end: string;
    status: string;
    order_number: string;
  }>;
  profit_summary: {
    buying_cost: number;
    total_rental_revenue: number;
    selling_price: number;
    net_pl: number;
  };
}

export interface AdminComboSet {
  id: string;
  sku: string;
  name: string;
  description: string;
  brand: string | null;
  thumbnail: string | null;
  color: string[];
  size: string[];
  rental_prices: { '1day': number; '3day': number; '5day': number };
  variable_cost: number;
  extra_day_rate: number;
  available: boolean;
  rental_count: number;
  items: Array<{
    id: string;
    product_id: string;
    product_sku: string;
    product_name: string;
    product_thumbnail: string | null;
    revenue_share_pct: number;
    label: string | null;
  }>;
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
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  address: Record<string, unknown>;
  tags: string[];
  locale: string;
  documents: Array<{ id: string; type: string; verified: boolean; uploaded_at: string }>;
  rental_history: Array<{
    id: string;
    order_number: string;
    status: string;
    total_amount: number;
    rental_period: { start: string; end: string };
    created_at: string;
  }>;
}

/**
 * BUG-CAL-01 — one row per inventory unit. `display_name` carries the
 * `#N` suffix already applied server-side when `stock_on_hand > 1`;
 * the raw `name` is retained separately for clients that need it.
 */
export interface CalendarUnitRow {
  product_id: string;
  unit_id: string | null;
  unit_index: number;
  sku: string;
  name: string;
  display_name: string;
  brand: string | null;
  category: string;
  thumbnail: string | null;
  stock_on_hand: number;
  slots: Array<{ date: string; status: string; order_id: string | null }>;
}

// FEAT-302: Per-unit calendar response
export interface PerUnitCalendarResponse {
  product_id: string;
  year: number;
  month: number;
  unit_filter: string;
  total_units: number;
  inventory_units: Array<{
    id: string;
    unit_index: number;
    label: string;
    size: string | null;
    color: string | null;
    status: string;
  }>;
  aggregated_days: Array<{ date: string; status: string; order_id?: string | null }> | null;
  calendars: Array<{
    unit_id: string | null;
    unit_label: string;
    days: Array<{ date: string; status: string; order_id?: string | null }>;
  }>;
}

export interface FinanceReport {
  period: { year: number; month: number | null; start: string; end: string };
  summary: {
    total_revenue: number;
    total_expenses: number;
    gross_margin: number;
    gross_margin_pct: number;
  };
  revenue_breakdown: Record<string, number>;
  expense_breakdown: Record<string, number>;
  grouped_by: string;
  groups: Array<{
    key: string;
    revenue: number;
    expenses: number;
    orders: number;
  }>;
}

export interface DashboardOverview {
  total_products: number;
  total_orders: number;
  orders_by_status: Record<string, number>;
  total_revenue: number;
  total_active_rentals: number;
  products_available: number;
  products_rented: number;
  products_cleaning: number;
  recent_orders: Array<{
    id: string;
    order_number: string;
    customer_name: string;
    product_name: string;
    status: string;
    total_amount: number;
    created_at: string;
  }>;
}

export interface FinanceCategory {
  id: string;
  name: string;
  type: 'REVENUE' | 'EXPENSE';
  description: string | null;
  created_at: string;
}

export interface FinanceTransaction {
  id: string;
  order_id: string | null;
  order_number: string | null;
  product_id: string | null;
  product_name: string | null;
  product_sku: string | null;
  category_id: string | null;
  category_name: string | null;
  category_type: string | null;
  tx_type: string;
  amount: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface BulkImportResult {
  total: number;
  created?: number;
  updated?: number;
  creates?: number;
  updates?: number;
  preview?: Array<{ row: number; name: string; category: string; size?: string[]; color?: string[]; price_1day: number; deposit?: number; action: 'create' | 'update' }>;
  results?: Array<{ row: number; action: string; id: string; name: string }>;
  errors?: Array<{ row: number; field: string; message: string }>;
}

export interface ProductROI {
  product_id: string;
  product_name: string;
  sku: string;
  purchase_cost: number;
  total_revenue: number;
  total_expenses: number;
  net_profit: number;
  roi: number;
  total_rentals: number;
  revenue_per_rental: number;
  break_even_rentals: number;
  cost_history: Array<{ date: string; type: string; amount: number; note: string | null }>;
}

export interface ProductMetrics {
  product_id: string;
  product_name: string;
  rental_count: number;
  occupancy_rate: number;
  average_rental_duration: number;
  last_rented_date: string | null;
  trend: 'up' | 'down' | 'stable';
  monthly_breakdown: Array<{ month: string; rental_count: number; revenue: number }>;
}

export interface FinanceSummary {
  periods: Array<{
    period_label: string;
    total_revenue: number;
    total_expenses: number;
    net_profit: number;
    order_count: number;
  }>;
  totals: {
    total_revenue: number;
    total_expenses: number;
    net_profit: number;
    total_orders: number;
  };
  by_category: Array<{ category_name: string; category_type: string; total: number }>;
  top_products: Array<{ product_id: string; product_name: string; revenue: number; rental_count: number }>;
  categories: Array<{ id: string; name: string; type: string }>;
}

export interface OrderProfit {
  order_id: string;
  order_number: string;
  customer_name: string;
  items: Array<{
    product_name: string;
    sku: string;
    size: string;
    subtotal: number;
    late_fee: number;
    damage_fee: number;
  }>;
  rental_price: number;
  late_fee: number;
  damage_fee: number;
  gross_revenue: number;
  expenses: Array<{ category: string; amount: number }>;
  total_expenses: number;
  net_profit: number;
  profit_margin: number;
  deposit: number;
  delivery_fee: number;
}

export interface ShippingZone {
  id: string;
  zone_name: string;
  base_fee: number;
  provinces: Array<{ province_code: string; addon_fee: number }>;
}

export interface ShippingCarrier {
  code: string;
  name: string;
  tracking_url: string;
}

export interface ShippingLabelData {
  order_number: string;
  order_id: string;
  status: string;
  sender: {
    name: string;
    phone: string;
    address: string;
  };
  recipient: {
    name: string;
    phone: string;
    address: string;
    subdistrict: string;
    district: string;
    province: string;
    postal_code: string;
  };
  items: Array<{ name: string; size: string; quantity: number }>;
  rental_period: { start: string; end: string };
  tracking_number: string | null;
  carrier: { code: string; name: string; tracking_url: string | null } | null;
  qr_data: string;
}

export interface LateFeeInfo {
  order_id: string;
  rental_end_date: string;
  current_date: string;
  days_late: number;
  fee_per_day: number;
  total_late_fee: number;
  is_overdue: boolean;
  deposit_total: number;
  deposit_remaining: number;
}

export interface OverdueOrder {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  rental_end_date: string;
  days_late: number;
  estimated_late_fee: number;
  deposit: number;
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
    overview: () => request<{ data: DashboardOverview }>('/api/v1/admin/dashboard/overview'),
    lowStock: (limit = 10) => request<{ data: Array<{ id: string; sku: string; name: string; thumbnail_url: string | null; stock_on_hand: number; low_stock_threshold: number }> }>(`/api/v1/admin/dashboard/low-stock?limit=${limit}`),
    lowStockDigest: () => request<{ data: { generated_at: string; total_low_stock: number; products: Array<{ sku: string; name: string; stock_on_hand: number; threshold: number }>; email_sent: boolean; message: string } }>('/api/v1/admin/dashboard/low-stock-digest', { method: 'POST' }),
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
      request<{ data: { slip_id: string; verification_status: string; order_status?: string; payment_message?: string; credit_added?: number } }>(`/api/v1/admin/orders/${id}/payment-slip/verify`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    updateSlipAmount: (id: string, slipId: string, body: { declared_amount: number }) =>
      request<{ data: { slip_id: string; declared_amount: number } }>(`/api/v1/admin/orders/${id}/payment-slips/${slipId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    afterSales: (id: string, body: { event_type: string; amount: number; note?: string }) =>
      request<{ data: unknown }>(`/api/v1/admin/orders/${id}/after-sales`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    shippingLabel: (id: string) =>
      request<{ data: ShippingLabelData }>(`/api/v1/admin/shipping/orders/${id}/shipping-label`),
    lateFee: (id: string) =>
      request<{ data: LateFeeInfo }>(`/api/v1/admin/orders/${id}/late-fee`),
    overdueList: () =>
      request<{ data: OverdueOrder[] }>(`/api/v1/admin/orders/overdue/list`),
    profit: (id: string) =>
      request<{ data: OrderProfit }>(`/api/v1/admin/orders/${id}/profit`),
    edit: (id: string, body: { customer_name?: string; customer_address?: Record<string, unknown>; items?: Array<{ id: string; subtotal?: number; late_fee?: number; damage_fee?: number }>; status?: string }) =>
      request<{ data: { id: string; changes: string[] } }>(`/api/v1/admin/orders/${id}/edit`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    addItem: (id: string, body: { product_id: string; size: string; quantity?: number; subtotal: number }) =>
      request<{ data: { item: { id: string; product_name: string; sku: string; size: string; quantity: number; subtotal: number; thumbnail: string | null }; order_total: number; additional_charge: number } }>(`/api/v1/admin/orders/${id}/items`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    removeItem: (id: string, itemId: string) =>
      request<{ data: { deleted: boolean; item_id: string; product_name: string; refund_amount: number; order_total: number } }>(`/api/v1/admin/orders/${id}/items/${itemId}`, {
        method: 'DELETE',
      }),
    create: (body: { customer_name: string; customer_phone: string; customer_email?: string; rental_start_date: string; rental_end_date: string; items: Array<{ product_id: string; size: string; quantity?: number; subtotal: number }>; deposit?: number; delivery_fee?: number; note?: string; mark_as_paid?: boolean }) =>
      request<{ data: { id: string; order_number: string; status: string; customer: { id: string; name: string; phone: string }; items: Array<{ id: string; product_name: string; size: string; quantity: number; subtotal: number }>; total_amount: number; created_at: string } }>('/api/v1/admin/orders', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },
  products: {
    list: (params: Record<string, string>) => {
      const qs = new URLSearchParams(params).toString();
      return request<{ data: AdminProduct[]; meta: { page: number; per_page: number; total: number; total_pages: number } }>(`/api/v1/admin/products?${qs}`);
    },
    create: (body: Record<string, unknown>, ctx?: RequestContext) =>
      request<{ data: AdminProduct }>(
        '/api/v1/admin/products',
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
        ctx,
      ),
    update: (id: string, body: Record<string, unknown>) =>
      request<{ data: AdminProduct }>(`/api/v1/admin/products/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    delete: (id: string) =>
      request<{ data: { message: string } }>(`/api/v1/admin/products/${id}`, { method: 'DELETE' }),
    roi: (id: string) =>
      request<{ data: ProductROI }>(`/api/v1/admin/products/${id}/roi`),
    roiSummary: () =>
      request<{ data: ProductROI[] }>('/api/v1/admin/products/roi/summary'),
    metrics: (id: string) =>
      request<{ data: ProductMetrics }>(`/api/v1/admin/products/${id}/metrics`),
    popularity: (params: Record<string, string>) => {
      const qs = new URLSearchParams(params).toString();
      return request<{ data: Array<{ id: string; sku: string; name: string; category: string; brand: string | null; thumbnail: string | null; rental_count: number; rental_price_1day: number; cost_price: number; available: boolean }>; meta: { page: number; per_page: number; total: number; total_pages: number } }>(`/api/v1/admin/products/popularity?${qs}`);
    },
    templateUrl: () => `${API_BASE}/api/v1/admin/products/template`,
    exportUrl: () => `${API_BASE}/api/v1/admin/products/export`,
    bulkImport: (csvData: string, dryRun: boolean) =>
      request<{ data: BulkImportResult }>('/api/v1/admin/products/import', {
        method: 'POST',
        body: JSON.stringify({ csv_data: csvData, dry_run: dryRun }),
      }),
    detail: (id: string) =>
      request<{ data: AdminProductDetail }>(`/api/v1/admin/products/${id}/detail`),
    addStock: (id: string, body: { quantity: number; unit_cost: number; note?: string }) =>
      request<{ data: { stock_on_hand: number; log_id: string; quantity: number; unit_cost: number; total_cost: number } }>(`/api/v1/admin/products/${id}/stock`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    stockLogs: (id: string, params?: Record<string, string>) => {
      const qs = params ? new URLSearchParams(params).toString() : '';
      return request<{ data: StockLog[]; meta: Record<string, unknown> }>(`/api/v1/admin/products/${id}/stock-logs${qs ? `?${qs}` : ''}`);
    },
    adjustStock: (id: string, body: { new_qty: number; reason: string }) =>
      request<{ data: { previous_qty: number; new_qty: number; adjustment: number; log_id: string } }>(`/api/v1/admin/products/${id}/stock/adjust`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    restore: (id: string) =>
      request<{ data: { id: string; restored: boolean } }>(`/api/v1/admin/products/${id}/restore`, { method: 'POST' }),
    // FEAT-302: Per-unit calendar
    perUnitCalendar: (id: string, params: { year: number; month: number; unit?: string }) => {
      const qs = new URLSearchParams({
        year: String(params.year),
        month: String(params.month),
        ...(params.unit ? { unit: params.unit } : {}),
      }).toString();
      return request<{ data: PerUnitCalendarResponse }>(`/api/v1/admin/products/${id}/calendar?${qs}`);
    },
  },
  comboSets: {
    list: (params?: Record<string, string>) => {
      const qs = params ? new URLSearchParams(params).toString() : '';
      return request<{ data: AdminComboSet[]; meta: { page: number; per_page: number; total: number; total_pages: number } }>(`/api/v1/admin/combo-sets${qs ? `?${qs}` : ''}`);
    },
    detail: (id: string) =>
      request<{ data: AdminComboSet }>(`/api/v1/admin/combo-sets/${id}`),
    create: (body: Record<string, unknown>) =>
      request<{ data: { id: string; sku: string; name: string } }>('/api/v1/admin/combo-sets', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: Record<string, unknown>) =>
      request<{ data: { id: string; updated: boolean } }>(`/api/v1/admin/combo-sets/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    delete: (id: string) =>
      request<{ data: { id: string; deleted: boolean } }>(`/api/v1/admin/combo-sets/${id}`, {
        method: 'DELETE',
      }),
  },
  calendar: {
    list: (params: Record<string, string>) => {
      const qs = new URLSearchParams(params).toString();
      return request<{ data: CalendarUnitRow[] }>(`/api/v1/admin/calendar?${qs}`);
    },
    // BUG-CAL-05 — click-to-edit cell. 409 body carries `error.code = CONFIRM_REQUIRED`
    // and `error.message` explains the confirm prompt; the caller should flip
    // `confirmed: true` and retry.
    patchCell: (body: {
      product_id: string;
      date: string;
      unit_index: number | null;
      new_state: string;
      confirmed?: boolean;
    }) =>
      request<{ data: { id?: string; from: string; to: string; noop: boolean } }>(
        `/api/v1/admin/calendar/cell`,
        { method: 'PATCH', body: JSON.stringify(body) },
      ),
  },
  customers: {
    list: (params: Record<string, string>) => {
      const qs = new URLSearchParams(params).toString();
      return request<{ data: AdminCustomer[]; meta: { page: number; per_page: number; total: number; total_pages: number } }>(`/api/v1/admin/customers?${qs}`);
    },
    detail: (id: string) =>
      request<{ data: AdminCustomerDetail }>(`/api/v1/admin/customers/${id}`),
    adjustCredit: (id: string, body: { amount: number; reason: string }) =>
      request<{ data: { customer_id: string; previous_balance: number; adjustment: number; new_balance: number; reason: string } }>(`/api/v1/admin/customers/${id}/adjust-credit`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: Record<string, unknown>) =>
      request<{ data: { id: string; name: string; first_name: string; last_name: string; email: string; phone: string; tags: unknown; address: unknown } }>(`/api/v1/admin/customers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    delete: (id: string) =>
      request<{ data: { deleted: boolean; customer_id: string } }>(`/api/v1/admin/customers/${id}`, { method: 'DELETE' }),
    updateTags: (id: string, tags: string[]) =>
      request<{ data: { id: string; tags: unknown } }>(`/api/v1/admin/customers/${id}/tags`, {
        method: 'PATCH',
        body: JSON.stringify({ tags }),
      }),
    getNotes: (id: string) =>
      request<{ data: Array<{ text: string; created_at: string; updated_at?: string }> }>(`/api/v1/admin/customers/${id}/notes`),
    addNote: (id: string, text: string) =>
      request<{ data: Array<{ text: string; created_at: string }> }>(`/api/v1/admin/customers/${id}/notes`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      }),
    editNote: (id: string, index: number, text: string) =>
      request<{ data: Array<{ text: string; created_at: string; updated_at?: string }> }>(`/api/v1/admin/customers/${id}/notes/${index}`, {
        method: 'PUT',
        body: JSON.stringify({ text }),
      }),
  },
  shipping: {
    zones: () => request<{ data: ShippingZone[] }>('/api/v1/admin/shipping/zones'),
    carriers: () => request<{ data: ShippingCarrier[] }>('/api/v1/admin/shipping/carriers'),
    setCarrier: (orderId: string, body: { carrier_code: string; tracking_number?: string }) =>
      request<{ data: { carrier_code: string; carrier_name: string; tracking_number: string | null } }>(`/api/v1/admin/shipping/orders/${orderId}/carrier`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    updateZone: (zoneId: string, body: { zone_name?: string; base_fee?: number }) =>
      request<{ data: { id: string; zone_name: string; base_fee: number } }>(`/api/v1/admin/shipping/zones/${zoneId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    updateProvince: (provinceId: string, body: { addon_fee?: number; shipping_days?: number }) =>
      request<{ data: { id: string; province_code: string; province_name: string; addon_fee: number; shipping_days: number } }>(`/api/v1/admin/shipping/provinces/${provinceId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    addProvince: (zoneId: string, body: { province_code: string; province_name: string; addon_fee: number }) =>
      request<{ data: { id: string; province_code: string; province_name: string; addon_fee: number } }>(`/api/v1/admin/shipping/zones/${zoneId}/provinces`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    deleteProvince: (provinceId: string) =>
      request<{ data: { deleted: boolean } }>(`/api/v1/admin/shipping/provinces/${provinceId}`, {
        method: 'DELETE',
      }),
    // #36: global shipping-fee toggle.
    feeToggleStatus: () =>
      request<{ data: { enabled: boolean } }>('/api/v1/admin/settings/shipping/fee-toggle'),
    setFeeToggle: (enabled: boolean) =>
      request<{ data: { enabled: boolean } }>('/api/v1/admin/settings/shipping/fee-toggle', {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      }),
  },
  finance: {
    report: (params: Record<string, string>) => {
      const qs = new URLSearchParams(params).toString();
      return request<{ data: FinanceReport }>(`/api/v1/admin/finance/report?${qs}`);
    },
    categories: () =>
      request<{ data: FinanceCategory[] }>('/api/v1/admin/finance/categories'),
    createCategory: (body: { name: string; type: string; description?: string }) =>
      request<{ data: FinanceCategory }>('/api/v1/admin/finance/categories', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    updateCategory: (id: string, body: Record<string, unknown>) =>
      request<{ data: FinanceCategory }>(`/api/v1/admin/finance/categories/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    transactions: (params: Record<string, string>) => {
      const qs = new URLSearchParams(params).toString();
      return request<{ data: { data: FinanceTransaction[]; meta: { page: number; per_page: number; total: number; total_pages: number } } }>(`/api/v1/admin/finance/transactions?${qs}`);
    },
    createTransaction: (body: Record<string, unknown>) =>
      request<{ data: { id: string } }>('/api/v1/admin/finance/transactions', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    summary: (params: Record<string, string>) => {
      const qs = new URLSearchParams(params).toString();
      return request<{ data: FinanceSummary }>(`/api/v1/admin/finance/summary?${qs}`);
    },
    exportCsv: (params: Record<string, string>) => {
      const qs = new URLSearchParams(params).toString();
      return `${API_BASE}/api/v1/admin/finance/summary/export?${qs}`;
    },
  },
  settings: {
    config: () => request<{ data: Array<{ id: string; key: string; value: string; label: string | null; group: string }> }>('/api/v1/admin/settings/config'),
    updateConfig: (key: string, body: { value: string }) =>
      request<{ data: { id: string; key: string; value: string; label: string | null; group: string } }>(`/api/v1/admin/settings/config/${key}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    createConfig: (body: { key: string; value: string; label?: string; group?: string }) =>
      request<{ data: { id: string; key: string; value: string; label: string | null; group: string } }>('/api/v1/admin/settings/config', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    batchUpdateConfig: (updates: Record<string, string>) =>
      request<{ data: { updated: Array<{ id: string; key: string; value: string; label: string | null; group: string }>; skipped: string[] } }>(
        '/api/v1/admin/settings/config/batch',
        { method: 'POST', body: JSON.stringify({ updates }) },
      ),
    users: () => request<{ data: Array<{ id: string; email: string; name: string | null; role: string; lastLoginAt: string | null; createdAt: string }> }>('/api/v1/admin/settings/users'),
    createUser: (body: { email: string; password: string; name?: string; role?: string }) =>
      request<{ data: { id: string; email: string; name: string | null; role: string; createdAt: string } }>('/api/v1/admin/settings/users', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    updateUser: (id: string, body: Record<string, unknown>) =>
      request<{ data: { id: string; email: string; name: string | null; role: string; createdAt: string } }>(`/api/v1/admin/settings/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    deleteUser: (id: string) =>
      request<{ data: { deleted: boolean } }>(`/api/v1/admin/settings/users/${id}`, { method: 'DELETE' }),
    auditLog: (params: Record<string, string>) => {
      const qs = new URLSearchParams(params).toString();
      return request<{ data: Array<{ id: string; admin_email: string; admin_name: string; action: string; resource: string; resource_id: string | null; details: Record<string, unknown> | null; created_at: string }>; meta: { page: number; per_page: number; total: number; total_pages: number } }>(`/api/v1/admin/settings/audit-log?${qs}`);
    },
    // BUG-504-A06.5: client-posted audit events. Narrow whitelist on
    // the server side — today only `category.drift_detected`.
    postAuditLog: (body: { action: string; resource: string; resource_id?: string | null; details: Record<string, unknown> }) =>
      request<{ data: { recorded: boolean } }>('/api/v1/admin/settings/audit-log', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    notifications: (params: Record<string, string>) => {
      const qs = new URLSearchParams(params).toString();
      return request<{ data: Array<{ id: string; order_id: string | null; customer_id: string | null; channel: string; recipient: string; subject: string | null; body: string; status: string; error_message: string | null; created_at: string }>; meta: { page: number; per_page: number; total: number; total_pages: number } }>(`/api/v1/admin/settings/notifications?${qs}`);
    },
    // Category management (#6)
    categories: () => request<{ data: string[] }>('/api/v1/admin/settings/categories'),
    updateCategories: (categories: string[]) =>
      request<{ data: string[] }>('/api/v1/admin/settings/categories', {
        method: 'PUT',
        body: JSON.stringify({ categories }),
      }),
    deleteCategory: (name: string) =>
      request<{ data: { deleted: boolean; category: string } }>(`/api/v1/admin/settings/categories/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    // Store address (#1)
    storeAddresses: () => request<{ data: Array<{ id: string; name: string; contact_person?: string; phone?: string; address_line?: string; province?: string; district?: string; subdistrict?: string; postal_code?: string; note?: string; is_primary: boolean }> }>('/api/v1/admin/settings/store-addresses'),
    updateStoreAddresses: (addresses: Array<Record<string, unknown>>) =>
      request<{ data: Array<Record<string, unknown>> }>('/api/v1/admin/settings/store-addresses', {
        method: 'PUT',
        body: JSON.stringify({ addresses }),
      }),
    sendNotification: (body: { channel: string; recipient: string; subject?: string; body: string; order_id?: string; customer_id?: string }) =>
      request<{ data: { id: string } }>('/api/v1/admin/settings/notifications/send', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },
  // BUG-504-A03: DB-backed taxonomy CRUD (superadmin writes). Separate
  // from `settings.categories` (legacy SystemConfig JSON blob still used
  // by products.tsx dropdown — migrated alongside A04 customer wiring).
  categories: {
    list: () =>
      request<{ data: Array<{ id: string; slug: string; name_th: string; name_en: string; sort_order: number; visible_frontend: boolean; visible_backend: boolean }> }>(
        '/api/v1/admin/categories',
      ),
    create: (body: { slug: string; name_th: string; name_en: string; sort_order: number; visible_frontend?: boolean; visible_backend?: boolean }) =>
      request<{ data: { id: string; slug: string; name_th: string; name_en: string; sort_order: number; visible_frontend: boolean; visible_backend: boolean } }>(
        '/api/v1/admin/categories',
        { method: 'POST', body: JSON.stringify(body) },
      ),
    update: (id: string, body: Partial<{ slug: string; name_th: string; name_en: string; sort_order: number; visible_frontend: boolean; visible_backend: boolean }>) =>
      request<{ data: { id: string; slug: string; name_th: string; name_en: string; sort_order: number; visible_frontend: boolean; visible_backend: boolean } }>(
        `/api/v1/admin/categories/${id}`,
        { method: 'PATCH', body: JSON.stringify(body) },
      ),
    remove: (id: string) =>
      request<void>(`/api/v1/admin/categories/${id}`, { method: 'DELETE' }),
  },
  images: {
    upload: (productId: string, file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('product_id', productId);
      return uploadFile<{ data: { id: string; url: string; alt_text: string; sort_order: number } }>('/api/v1/admin/images/upload', formData);
    },
    uploadGeneric: (file: File, folder?: string) => {
      const formData = new FormData();
      formData.append('file', file);
      if (folder) formData.append('folder', folder);
      return uploadFile<{ data: { url: string } }>('/api/v1/admin/images/upload-generic', formData);
    },
    list: (productId: string) =>
      request<{ data: Array<{ id: string; url: string; alt_text: string; sort_order: number }> }>(`/api/v1/admin/images/${productId}`),
    delete: (imageId: string) =>
      request<{ data: { deleted: boolean } }>(`/api/v1/admin/images/${imageId}`, { method: 'DELETE' }),
  },
};
