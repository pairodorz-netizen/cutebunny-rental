import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { adminApi } from '@/lib/api';
import type { AdminOrder, AdminProduct } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DEFAULT_ARCHIVE_WINDOW_DAYS,
  resolveOrdersDatePreset,
  type OrdersDatePreset,
} from '@cutebunny/shared/orders-archive-window';
import { Settings, ChevronDown, X, Printer, AlertTriangle, DollarSign, Plus, Trash2, History, Undo2 } from 'lucide-react';

const ORDER_STATUSES = ['unpaid', 'paid_locked', 'shipped', 'returned', 'cleaning', 'repair', 'finished', 'cancelled'];

const FORWARD_TRANSITIONS: Record<string, string[]> = {
  unpaid: ['paid_locked'],
  paid_locked: ['shipped'],
  shipped: ['returned'],
  returned: ['cleaning'],
  cleaning: ['repair', 'finished'],
  repair: ['finished'],
  finished: [],
  cancelled: [],
};

const BACKWARD_TRANSITIONS: Record<string, string[]> = {
  unpaid: ['finished', 'cancelled'],
  paid_locked: ['unpaid', 'finished', 'cancelled'],
  shipped: ['paid_locked', 'finished', 'cancelled'],
  returned: ['shipped', 'finished', 'cancelled'],
  cleaning: ['returned', 'cancelled'],
  repair: ['cleaning', 'cancelled'],
  finished: ['cleaning', 'repair', 'cancelled'],
  cancelled: [],
};

const ALL_TRANSITIONS: Record<string, string[]> = {};
for (const s of ORDER_STATUSES) {
  ALL_TRANSITIONS[s] = [...(FORWARD_TRANSITIONS[s] ?? []), ...(BACKWARD_TRANSITIONS[s] ?? [])];
}

const STATUS_COLORS: Record<string, string> = {
  unpaid: 'bg-yellow-100 text-yellow-800',
  paid_locked: 'bg-blue-100 text-blue-800',
  shipped: 'bg-purple-100 text-purple-800',
  returned: 'bg-orange-100 text-orange-800',
  cleaning: 'bg-cyan-100 text-cyan-800',
  repair: 'bg-red-100 text-red-800',
  finished: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-200 text-gray-800',
};

const STATUS_TAB_COLORS: Record<string, string> = {
  unpaid: 'bg-yellow-500',
  paid_locked: 'bg-blue-500',
  shipped: 'bg-purple-500',
  returned: 'bg-orange-500',
  cleaning: 'bg-cyan-500',
  repair: 'bg-red-500',
  finished: 'bg-green-500',
  cancelled: 'bg-gray-600',
};

const AFTER_SALES_TYPES = ['cancel', 'late_fee', 'damage_fee', 'force_buy', 'partial_refund'];

const CARRIERS = [
  { code: 'kerry', name: 'Kerry Express' },
  { code: 'thailand_post', name: 'Thailand Post' },
  { code: 'flash', name: 'Flash Express' },
  { code: 'jt', name: 'J&T Express' },
];

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// BUG-ORDERS-ARCHIVE-01 — YYYY-MM-DD helpers for the date-range picker.
// Kept local (small, UI-only) so the pure-logic module in @cutebunny/shared
// stays focused on the archive-window math.
function toDateInput(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toDateInput(d);
}

// BUG-ORDERS-ARCHIVE-01-HOTFIX — preset resolution + includeStale
// coupling moved into @cutebunny/shared/orders-archive-window so the
// "All Time clears bounds AND sets includeStale=true" contract is the
// single testable source of truth. See
// apps/api/src/__tests__/bug-orders-archive-01-hotfix.test.ts.

function Thumbnail({ src, size = 32 }: { src: string | null; size?: number }) {
  if (!src) {
    return (
      <div
        className="rounded-md bg-muted flex items-center justify-center text-muted-foreground text-[10px]"
        style={{ width: size, height: size }}
      >
        —
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      className="rounded-md object-cover"
      style={{ width: size, height: size }}
      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
    />
  );
}

function ExpandedPaymentSlips({ orderId, orderStatus, onVerified }: { orderId: string; orderStatus: string; onVerified: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editingSlipId, setEditingSlipId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);
  const [fullImageUrl, setFullImageUrl] = useState<string | null>(null);

  const { data: detailData } = useQuery({
    queryKey: ['admin-order-detail', orderId],
    queryFn: () => adminApi.orders.detail(orderId),
    enabled: !!orderId,
  });

  const slips = detailData?.data?.payment_slips ?? [];

  const verifyMutation = useMutation({
    mutationFn: ({ slipId, verified }: { slipId: string; verified: boolean }) =>
      adminApi.orders.verifySlip(orderId, { slip_id: slipId, verified }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['admin-order-detail', orderId] });
      onVerified();
      if (result.data?.payment_message) {
        setVerifyMessage(result.data.payment_message);
      } else if (result.data?.credit_added && result.data.credit_added > 0) {
        setVerifyMessage(`Payment verified. ${result.data.credit_added} THB added to customer credit.`);
      } else {
        setVerifyMessage(null);
      }
    },
  });

  const amountMutation = useMutation({
    mutationFn: ({ slipId, amount }: { slipId: string; amount: number }) =>
      adminApi.orders.updateSlipAmount(orderId, slipId, { declared_amount: amount }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-order-detail', orderId] });
      setEditingSlipId(null);
    },
  });

  if (slips.length === 0) return null;

  return (
    <div className="mt-3 border-t pt-3">
      <label className="text-xs font-semibold text-foreground mb-2 block">{t('orders.paymentSlips')}</label>
      {verifyMessage && (
        <div className="mb-2 p-2 rounded text-xs bg-yellow-50 text-yellow-800 border border-yellow-200">
          {verifyMessage}
          <button className="ml-2 underline" onClick={() => setVerifyMessage(null)}>dismiss</button>
        </div>
      )}
      <div className="space-y-2">
        {slips.map((slip) => {
          const isRejected = slip.verification_status === 'rejected';
          const isVerified = slip.verification_status === 'verified';
          const isPending = slip.verification_status === 'pending';
          const hasImage = slip.storage_key && (slip.storage_key.startsWith('http') || slip.storage_key.startsWith('/'));

          return (
            <div
              key={slip.id}
              className={`flex items-center gap-3 text-xs border rounded p-2 ${isRejected ? 'border-red-300 bg-red-50/50' : ''}`}
            >
              {/* Slip image thumbnail */}
              {hasImage ? (
                <button onClick={() => setFullImageUrl(slip.storage_key)} className="shrink-0">
                  <img
                    src={slip.storage_key}
                    alt="Payment slip"
                    className="w-10 h-10 rounded object-cover border hover:opacity-80"
                  />
                </button>
              ) : (
                <div className="w-10 h-10 rounded bg-muted flex items-center justify-center text-[10px] text-muted-foreground shrink-0">
                  Slip
                </div>
              )}

              {/* Amount (inline editable) */}
              <div className="flex-1 min-w-0">
                {editingSlipId === slip.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={editAmount}
                      onChange={(e) => setEditAmount(e.target.value)}
                      className="w-24 h-6 border rounded px-1 text-xs"
                      autoFocus
                    />
                    <span className="text-muted-foreground">THB</span>
                    <button
                      onClick={() => {
                        const val = parseInt(editAmount, 10);
                        if (val >= 0) amountMutation.mutate({ slipId: slip.id, amount: val });
                      }}
                      className="text-green-600 hover:text-green-800 font-semibold"
                    >
                      Save
                    </button>
                    <button onClick={() => setEditingSlipId(null)} className="text-muted-foreground hover:text-foreground">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div>
                    <button
                      onClick={() => { setEditingSlipId(slip.id); setEditAmount(String(slip.declared_amount)); }}
                      className="font-medium hover:underline cursor-pointer"
                      title="Click to edit amount"
                    >
                      {slip.declared_amount.toLocaleString()} THB
                    </button>
                    <span className="text-muted-foreground ml-1">
                      {slip.bank_name ? `• ${slip.bank_name}` : ''}
                    </span>
                  </div>
                )}
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {new Date(slip.created_at).toLocaleString()}
                </div>
              </div>

              {/* Status badge */}
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] whitespace-nowrap ${
                isVerified ? 'bg-green-100 text-green-700' :
                isRejected ? 'bg-red-100 text-red-700 line-through' :
                'bg-yellow-100 text-yellow-700'
              }`}>
                {slip.verification_status}
              </span>

              {/* Verify / Reject buttons */}
              {isPending && (
                <div className="flex gap-1 shrink-0">
                  <Button
                    size="sm"
                    className="h-6 text-[10px] bg-green-600 hover:bg-green-700 text-white"
                    onClick={() => verifyMutation.mutate({ slipId: slip.id, verified: true })}
                    disabled={verifyMutation.isPending}
                  >
                    {t('orders.verify')}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-6 text-[10px]"
                    onClick={() => verifyMutation.mutate({ slipId: slip.id, verified: false })}
                    disabled={verifyMutation.isPending}
                  >
                    {t('orders.reject')}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Full-size image modal */}
      {fullImageUrl && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[70]" onClick={() => setFullImageUrl(null)}>
          <div className="relative max-w-3xl max-h-[90vh]">
            <img src={fullImageUrl} alt="Payment slip" className="max-w-full max-h-[85vh] rounded-lg" />
            <button
              onClick={() => setFullImageUrl(null)}
              className="absolute top-2 right-2 bg-white/80 rounded-full p-1 hover:bg-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function OrdersPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');

  // BUG-ORDERS-ARCHIVE-01 — default to last 30 days for finished/cancelled
  // orders; active statuses always visible regardless of this window.
  const defaultFrom = useMemo(() => daysAgo(DEFAULT_ARCHIVE_WINDOW_DAYS), []);
  const defaultTo = useMemo(() => toDateInput(new Date()), []);
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(defaultTo);
  const [includeStale, setIncludeStale] = useState(false);
  const [pageSize, setPageSize] = useState(50);
  const [activePreset, setActivePreset] = useState<OrdersDatePreset>('30');

  const applyPreset = useCallback((preset: OrdersDatePreset) => {
    const { from, to, includeStale: presetIncludeStale } = resolveOrdersDatePreset(preset);
    setDateFrom(from);
    setDateTo(to);
    setActivePreset(preset);
    if (presetIncludeStale) setIncludeStale(true);
    setPage(1);
  }, []);

  // Search fields
  const [searchOrderNumber, setSearchOrderNumber] = useState('');
  const [searchSku, setSearchSku] = useState('');
  const [searchProductName, setSearchProductName] = useState('');
  const [searchCustomerName, setSearchCustomerName] = useState('');
  const [searchCustomerPhone, setSearchCustomerPhone] = useState('');
  const [searchTracking, setSearchTracking] = useState('');

  // Debounced values
  const debouncedOrderNumber = useDebounce(searchOrderNumber, 300);
  const debouncedSku = useDebounce(searchSku, 300);
  const debouncedProductName = useDebounce(searchProductName, 300);
  const debouncedCustomerName = useDebounce(searchCustomerName, 300);
  const debouncedCustomerPhone = useDebounce(searchCustomerPhone, 300);
  const debouncedTracking = useDebounce(searchTracking, 300);

  // Expanded rows
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const toggleExpand = useCallback((id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Edit panel
  const [editOrderId, setEditOrderId] = useState<string | null>(null);
  const [editCustomerName, setEditCustomerName] = useState('');
  const [editCustomerAddress, setEditCustomerAddress] = useState('');
  const [editItems, setEditItems] = useState<Array<{ id: string; subtotal: number; late_fee: number; damage_fee: number }>>([]);

  // Status change modal
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [statusModalOrderId, setStatusModalOrderId] = useState<string | null>(null);
  const [statusModalCurrentStatus, setStatusModalCurrentStatus] = useState('');
  const [newStatus, setNewStatus] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [selectedCarrier, setSelectedCarrier] = useState('');

  // Slip verify modal
  const [showSlipModal, setShowSlipModal] = useState(false);
  const [slipModalOrderId, setSlipModalOrderId] = useState<string | null>(null);
  const [selectedSlipId, setSelectedSlipId] = useState('');
  const [slipVerified, setSlipVerified] = useState(true);
  const [slipNote, setSlipNote] = useState('');

  // Add item state
  const [showAddItem, setShowAddItem] = useState(false);
  const [addItemSearch, setAddItemSearch] = useState('');
  const [addItemProductId, setAddItemProductId] = useState('');
  const [addItemSize, setAddItemSize] = useState('');
  const [addItemSubtotal, setAddItemSubtotal] = useState('');

  // Revenue impact tracking
  const [revenueImpacts, setRevenueImpacts] = useState<Array<{ label: string; amount: number; type: 'refund' | 'additional' }>>([]);

  // After-sales modal
  const [showAfterSalesModal, setShowAfterSalesModal] = useState(false);
  const [afterSalesOrderId, setAfterSalesOrderId] = useState<string | null>(null);
  const [afterSalesType, setAfterSalesType] = useState('');
  const [afterSalesAmount, setAfterSalesAmount] = useState('');
  const [afterSalesNote, setAfterSalesNote] = useState('');

  // Create Order modal
  const [showCreateOrder, setShowCreateOrder] = useState(false);
  const [createCustomerName, setCreateCustomerName] = useState('');
  const [createCustomerPhone, setCreateCustomerPhone] = useState('');
  const [createCustomerEmail, setCreateCustomerEmail] = useState('');
  const [createStartDate, setCreateStartDate] = useState('');
  const [createEndDate, setCreateEndDate] = useState('');
  const [createDeposit, setCreateDeposit] = useState('0');
  const [createDeliveryFee, setCreateDeliveryFee] = useState('0');
  const [createNote, setCreateNote] = useState('');
  const [createMarkPaid, setCreateMarkPaid] = useState(false);
  const [createItems, setCreateItems] = useState<Array<{ product_id: string; product_name: string; size: string; quantity: number; subtotal: string }>>([]);
  const [createItemSearch, setCreateItemSearch] = useState('');
  const [showCreateItemPicker, setShowCreateItemPicker] = useState(false);

  // Build query params
  const params: Record<string, string> = {
    page: String(page),
    page_size: String(pageSize),
    include_stale: includeStale ? 'true' : 'false',
  };
  if (dateFrom) params.from = dateFrom;
  if (dateTo) params.to = dateTo;
  if (statusFilter) params.status = statusFilter;
  if (debouncedOrderNumber) params.search_order_number = debouncedOrderNumber;
  if (debouncedSku) params.search_sku = debouncedSku;
  if (debouncedProductName) params.search_product_name = debouncedProductName;
  if (debouncedCustomerName) params.search_customer_name = debouncedCustomerName;
  if (debouncedCustomerPhone) params.search_customer_phone = debouncedCustomerPhone;
  if (debouncedTracking) params.search_tracking = debouncedTracking;

  // BUG-ORDERS-ARCHIVE-01 — tab badges share the same window as the main
  // list so e.g. the Finished tab shows "2" when only 2 finished orders
  // live in the last 30 days, not the all-time total.
  const countParams: Record<string, string> = {
    include_stale: includeStale ? 'true' : 'false',
    page: '1',
    page_size: '1',
  };
  if (dateFrom) countParams.from = dateFrom;
  if (dateTo) countParams.to = dateTo;

  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['admin-orders', params],
    queryFn: () => adminApi.orders.list(params),
  });

  // Order detail query (for edit panel + modals)
  const activeDetailId = editOrderId ?? statusModalOrderId ?? slipModalOrderId ?? afterSalesOrderId;
  const { data: detailData } = useQuery({
    queryKey: ['admin-order-detail', activeDetailId],
    queryFn: () => adminApi.orders.detail(activeDetailId!),
    enabled: !!activeDetailId,
  });

  // Late fee auto-calc
  const { data: lateFeeData } = useQuery({
    queryKey: ['late-fee', afterSalesOrderId],
    queryFn: () => adminApi.orders.lateFee(afterSalesOrderId!),
    enabled: !!afterSalesOrderId && showAfterSalesModal && afterSalesType === 'late_fee',
  });

  // Status counts query (for tab badges) — BUG-ORDERS-ARCHIVE-01: share
  // the same from/to/include_stale window so the badge "2" next to
  // Finished reflects the filtered view, not the all-time total.
  const statusCountQueries = ORDER_STATUSES.map((s) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useQuery({
      queryKey: ['admin-orders-count', s, countParams],
      queryFn: () => adminApi.orders.list({ ...countParams, status: s }),
      staleTime: 30000,
    });
  });

  const statusCounts: Record<string, number> = {};
  ORDER_STATUSES.forEach((s, i) => {
    statusCounts[s] = statusCountQueries[i].data?.meta?.total ?? 0;
  });
  const totalCount = Object.values(statusCounts).reduce((a, b) => a + b, 0);

  const carrierMutation = useMutation({
    mutationFn: ({ orderId, body }: { orderId: string; body: { carrier_code: string; tracking_number?: string } }) =>
      adminApi.shipping.setCarrier(orderId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-order-detail'] });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ orderId, body }: { orderId: string; body: { to_status: string; tracking_number?: string; note?: string } }) =>
      adminApi.orders.updateStatus(orderId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      queryClient.invalidateQueries({ queryKey: ['admin-order-detail'] });
      queryClient.invalidateQueries({ queryKey: ['admin-orders-count'] });
      if (newStatus === 'shipped' && selectedCarrier && statusModalOrderId) {
        carrierMutation.mutate({
          orderId: statusModalOrderId,
          body: { carrier_code: selectedCarrier, tracking_number: trackingNumber || undefined },
        });
      }
      setShowStatusModal(false);
      setStatusModalOrderId(null);
      setNewStatus('');
      setTrackingNumber('');
      setStatusNote('');
      setSelectedCarrier('');
    },
  });

  const slipMutation = useMutation({
    mutationFn: ({ orderId, body }: { orderId: string; body: { slip_id: string; verified: boolean; note?: string } }) =>
      adminApi.orders.verifySlip(orderId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      queryClient.invalidateQueries({ queryKey: ['admin-order-detail'] });
      queryClient.invalidateQueries({ queryKey: ['admin-orders-count'] });
      setShowSlipModal(false);
      setSlipModalOrderId(null);
    },
  });

  const afterSalesMutation = useMutation({
    mutationFn: ({ orderId, body }: { orderId: string; body: { event_type: string; amount: number; note?: string } }) =>
      adminApi.orders.afterSales(orderId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      queryClient.invalidateQueries({ queryKey: ['admin-order-detail'] });
      setShowAfterSalesModal(false);
      setAfterSalesOrderId(null);
      setAfterSalesType('');
      setAfterSalesAmount('');
      setAfterSalesNote('');
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ orderId, body }: { orderId: string; body: Record<string, unknown> }) =>
      adminApi.orders.edit(orderId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      queryClient.invalidateQueries({ queryKey: ['admin-order-detail'] });
      queryClient.invalidateQueries({ queryKey: ['admin-orders-count'] });
      setEditOrderId(null);
    },
  });

  // Product search for add item
  const debouncedAddItemSearch = useDebounce(addItemSearch, 300);
  const { data: productSearchData } = useQuery({
    queryKey: ['product-search', debouncedAddItemSearch],
    queryFn: () => adminApi.products.list({ search: debouncedAddItemSearch, per_page: '10' }),
    enabled: showAddItem && debouncedAddItemSearch.length >= 1,
  });

  const addItemMutation = useMutation({
    mutationFn: ({ orderId, body }: { orderId: string; body: { product_id: string; size: string; quantity?: number; subtotal: number } }) =>
      adminApi.orders.addItem(orderId, body),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      queryClient.invalidateQueries({ queryKey: ['admin-order-detail'] });
      queryClient.invalidateQueries({ queryKey: ['admin-orders-count'] });
      const item = result.data.item;
      setEditItems((prev) => [...prev, { id: item.id, subtotal: item.subtotal, late_fee: 0, damage_fee: 0 }]);
      setRevenueImpacts((prev) => [...prev, { label: item.product_name, amount: result.data.additional_charge, type: 'additional' }]);
      setShowAddItem(false);
      setAddItemSearch('');
      setAddItemProductId('');
      setAddItemSize('');
      setAddItemSubtotal('');
    },
  });

  const removeItemMutation = useMutation({
    mutationFn: ({ orderId, itemId }: { orderId: string; itemId: string }) =>
      adminApi.orders.removeItem(orderId, itemId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      queryClient.invalidateQueries({ queryKey: ['admin-order-detail'] });
      queryClient.invalidateQueries({ queryKey: ['admin-orders-count'] });
      setEditItems((prev) => prev.filter((i) => i.id !== result.data.item_id));
      setRevenueImpacts((prev) => [...prev, { label: result.data.product_name, amount: result.data.refund_amount, type: 'refund' }]);
    },
  });

  // Create order product search
  const debouncedCreateItemSearch = useDebounce(createItemSearch, 300);
  const { data: createProductSearchData } = useQuery({
    queryKey: ['create-product-search', debouncedCreateItemSearch],
    queryFn: () => adminApi.products.list({ search: debouncedCreateItemSearch, per_page: '10' }),
    enabled: showCreateItemPicker && debouncedCreateItemSearch.length >= 1,
  });

  const createOrderMutation = useMutation({
    mutationFn: (body: Parameters<typeof adminApi.orders.create>[0]) => adminApi.orders.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      queryClient.invalidateQueries({ queryKey: ['admin-orders-count'] });
      setShowCreateOrder(false);
      setCreateCustomerName(''); setCreateCustomerPhone(''); setCreateCustomerEmail('');
      setCreateStartDate(''); setCreateEndDate(''); setCreateDeposit('0'); setCreateDeliveryFee('0');
      setCreateNote(''); setCreateMarkPaid(false); setCreateItems([]); setCreateItemSearch('');
    },
  });

  const orders = listData?.data ?? [];
  const meta = listData?.meta;
  const orderDetail = detailData?.data;

  // Open edit panel
  const openEditPanel = useCallback((order: AdminOrder) => {
    setEditOrderId(order.id);
    setEditCustomerName(order.customer.name);
    setEditCustomerAddress('');
    setEditItems(order.items.map((item) => ({
      id: item.id,
      subtotal: item.subtotal,
      late_fee: item.late_fee,
      damage_fee: item.damage_fee,
    })));
    setRevenueImpacts([]);
    setShowAddItem(false);
  }, []);

  // Open status modal
  const openStatusModal = useCallback((orderId: string, currentStatus: string) => {
    setStatusModalOrderId(orderId);
    setStatusModalCurrentStatus(currentStatus);
    setShowStatusModal(true);
  }, []);

  // Open after-sales modal
  const openAfterSalesModal = useCallback((orderId: string) => {
    setAfterSalesOrderId(orderId);
    setShowAfterSalesModal(true);
  }, []);

  const searchBarRef = useRef<HTMLDivElement>(null);

  return (
    <div className="relative">
      {/* ═══ STICKY SEARCH BAR + STATUS TABS (combined sticky block) ═══ */}
      <div
        ref={searchBarRef}
        className="sticky top-0 z-20 bg-white shadow-md border-b"
      >
      <div className="px-4 py-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder="เลขที่ออเดอร์ (ORD-...)"
            value={searchOrderNumber}
            onChange={(e) => { setSearchOrderNumber(e.target.value); setPage(1); }}
            className="h-7 text-xs w-36 min-w-0"
          />
          <Input
            placeholder="SKU สินค้า"
            value={searchSku}
            onChange={(e) => { setSearchSku(e.target.value); setPage(1); }}
            className="h-7 text-xs w-28 min-w-0"
          />
          <Input
            placeholder="ชื่อ"
            value={searchCustomerName}
            onChange={(e) => { setSearchCustomerName(e.target.value); setPage(1); }}
            className="h-7 text-xs w-32 min-w-0"
          />
          {(searchOrderNumber || searchSku || searchCustomerName) && (
            <button
              onClick={() => {
                setSearchOrderNumber(''); setSearchSku('');
                setSearchCustomerName('');
              }}
              className="text-xs text-muted-foreground hover:text-primary"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <Button size="sm" className="h-7 text-xs ml-auto" onClick={() => setShowCreateOrder(true)}>
            <Plus className="h-3 w-3 mr-1" /> {t('orders.createOrder')}
          </Button>
        </div>
      </div>

      {/* ═══ DATE RANGE + ARCHIVED TOGGLE (BUG-ORDERS-ARCHIVE-01) ═══ */}
      <div className="border-t px-4 py-2 flex items-center gap-2 flex-wrap" data-testid="orders-date-range">
        <span className="text-xs text-muted-foreground shrink-0">{t('orders.dateRangeLabel')}</span>
        {(['today', '7', '30', '90', 'year', 'all'] as const).map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => applyPreset(preset)}
            data-testid={`orders-date-preset-${preset}`}
            className={`h-7 px-2 text-xs rounded border transition-colors ${
              activePreset === preset
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-muted-foreground border-input hover:bg-muted/50'
            }`}
          >
            {t(`orders.datePreset.${preset === '7' ? 'week' : preset === '30' ? 'month' : preset === '90' ? 'quarter' : preset}`)}
          </button>
        ))}
        <input
          type="date"
          value={dateFrom}
          data-testid="orders-date-from"
          onChange={(e) => { setDateFrom(e.target.value); setActivePreset('all'); setPage(1); }}
          className="h-7 px-2 text-xs border border-input rounded bg-background"
        />
        <span className="text-xs text-muted-foreground">—</span>
        <input
          type="date"
          value={dateTo}
          data-testid="orders-date-to"
          onChange={(e) => { setDateTo(e.target.value); setActivePreset('all'); setPage(1); }}
          className="h-7 px-2 text-xs border border-input rounded bg-background"
        />
        <label className="flex items-center gap-1 text-xs text-muted-foreground ml-2 cursor-pointer">
          <input
            type="checkbox"
            data-testid="orders-include-stale-toggle"
            checked={includeStale}
            onChange={(e) => { setIncludeStale(e.target.checked); setPage(1); }}
            className="h-3 w-3"
          />
          {t('orders.includeStaleLabel')}
        </label>
      </div>

      {/* ═══ STATUS TABS ═══ */}
      <div className="border-t">
        <div className="flex overflow-x-auto">
          <button
            onClick={() => { setStatusFilter(''); setPage(1); }}
            className={`px-4 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
              !statusFilter
                ? 'border-primary text-primary bg-primary/5'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            {t('orders.allStatuses')}
            <span className="ml-1.5 text-[10px] bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded-full">{totalCount}</span>
          </button>
          {ORDER_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setPage(1); }}
              className={`px-4 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                statusFilter === s
                  ? 'border-current ' + (STATUS_COLORS[s] ?? '')
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              {t(`orders.statusLabel.${s}`)}
              <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${
                statusFilter === s ? 'bg-white/50' : 'bg-gray-200 text-gray-700'
              }`}>
                {statusCounts[s] ?? 0}
              </span>
            </button>
          ))}
        </div>
      </div>
      </div>

      {/* ═══ ORDER LIST ═══ */}
      <div className="px-4 py-2">
        {listLoading ? (
          <div className="p-8 text-center text-muted-foreground">{t('common.loading')}</div>
        ) : orders.length === 0 ? (
          <div
            className="p-8 text-center text-muted-foreground"
            data-testid="orders-empty-state"
          >
            {includeStale || !dateFrom ? t('orders.empty') : t('orders.emptyInWindow')}
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-[1fr_auto_1.2fr_auto_auto_auto_auto_auto] gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground border-b">
              <span>{t('orders.orderNumber')}</span>
              <span className="w-10">{/* thumbnails */}</span>
              <span>{t('orders.customer')}</span>
              <span className="w-20 text-center">{t('orders.status')}</span>
              <span className="w-20 text-right">{t('orders.total')}</span>
              <span className="w-20">{t('orders.date')}</span>
              <span className="w-14 text-center">{/* actions */}</span>
              <span className="w-6">{/* expand */}</span>
            </div>

            {/* Rows */}
            {orders.map((order) => {
              const isExpanded = expandedRows.has(order.id);
              return (
                <div key={order.id} className="border-b last:border-b-0">
                  {/* Main row */}
                  <div className="grid grid-cols-[1fr_auto_1.2fr_auto_auto_auto_auto_auto] gap-2 px-3 py-2 items-center hover:bg-muted/20 text-sm">
                    <span className="font-mono text-xs truncate">{order.order_number}</span>
                    {/* Product thumbnails */}
                    <div className="flex -space-x-1 w-10">
                      {order.items.slice(0, 3).map((item, idx) => (
                        <Thumbnail key={idx} src={item.thumbnail} size={24} />
                      ))}
                      {order.items.length > 3 && (
                        <span className="text-[10px] text-muted-foreground ml-1">+{order.items.length - 3}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm truncate">{order.customer.name}</div>
                      <div className="text-[11px] text-muted-foreground">{order.customer.phone}</div>
                    </div>
                    <div className="w-20 text-center">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_COLORS[order.status] ?? 'bg-gray-100'}`}>
                        {t(`orders.statusLabel.${order.status}`)}
                      </span>
                    </div>
                    <span className="w-20 text-right text-xs">{order.total_amount.toLocaleString()}</span>
                    <span className="w-20 text-xs text-muted-foreground">{new Date(order.created_at).toLocaleDateString()}</span>
                    {/* Action icons */}
                    <div className="flex gap-1 w-14 justify-center">
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditPanel(order); }}
                        className="p-1 rounded hover:bg-muted"
                        title="Edit"
                      >
                        <Settings className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    </div>
                    <button
                      onClick={() => toggleExpand(order.id)}
                      className="w-6 p-1 rounded hover:bg-muted flex items-center justify-center"
                    >
                      <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>
                  </div>

                  {/* Expanded item details */}
                  {isExpanded && (
                    <div className="bg-muted/10 border-t px-6 py-3">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-muted-foreground">
                            <th className="text-left pb-2 w-12">{/* thumb */}</th>
                            <th className="text-left pb-2">{t('products.name')}</th>
                            <th className="text-left pb-2">SKU</th>
                            <th className="text-left pb-2">{t('products.size')}</th>
                            <th className="text-right pb-2">{t('orders.quantity')}</th>
                            <th className="text-right pb-2">{t('orders.subtotal')}</th>
                            <th className="text-right pb-2">{t('orders.lateFee')}</th>
                            <th className="text-right pb-2">{t('orders.damageFee')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {order.items.map((item) => (
                            <tr key={item.id} className="border-t border-muted">
                              <td className="py-1.5"><Thumbnail src={item.thumbnail} size={36} /></td>
                              <td className="py-1.5 font-medium">{item.product_name}</td>
                              <td className="py-1.5 font-mono text-muted-foreground">{item.sku}</td>
                              <td className="py-1.5">{item.size}</td>
                              <td className="py-1.5 text-right">{item.quantity}</td>
                              <td className="py-1.5 text-right">{item.subtotal.toLocaleString()}</td>
                              <td className="py-1.5 text-right">{item.late_fee > 0 ? item.late_fee.toLocaleString() : '-'}</td>
                              <td className="py-1.5 text-right">{item.damage_fee > 0 ? item.damage_fee.toLocaleString() : '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {order.tracking_number && (
                        <div className="mt-2 text-xs text-muted-foreground">
                          {t('orders.trackingNumber')}: <span className="font-mono">{order.tracking_number}</span>
                        </div>
                      )}
                      <div className="mt-2 text-xs text-muted-foreground">
                        {t('orders.rentalPeriod')}: {order.rental_period.start} — {order.rental_period.end}
                      </div>
                      {/* Credit Applied */}
                      {order.credit_applied > 0 && (
                        <div className="mt-1 text-xs text-green-600 font-medium">
                          {t('orders.creditApplied')}: -{order.credit_applied.toLocaleString()} THB
                        </div>
                      )}
                      {/* Payment Slips Section */}
                      <ExpandedPaymentSlips
                        orderId={order.id}
                        orderStatus={order.status}
                        onVerified={() => {
                          queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
                          queryClient.invalidateQueries({ queryKey: ['admin-order-detail'] });
                          queryClient.invalidateQueries({ queryKey: ['admin-orders-count'] });
                        }}
                      />
                      {/* Quick action buttons in expanded view */}
                      <div className="flex gap-2 mt-3">
                        {ALL_TRANSITIONS[order.status]?.length > 0 && (
                          <Button size="sm" className="h-6 text-xs" onClick={() => openStatusModal(order.id, order.status)}>
                            {t('orders.changeStatus')}
                          </Button>
                        )}
                        {(order.status === 'paid_locked' || order.status === 'shipped') && (
                          <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => navigate(`/orders/${order.id}/shipping-label`)}>
                            <Printer className="h-3 w-3 mr-1" /> {t('shipping.printLabel')}
                          </Button>
                        )}
                        <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => openAfterSalesModal(order.id)}>
                          {t('orders.afterSales')}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination — BUG-ORDERS-ARCHIVE-01 */}
        {meta && (meta.total ?? 0) > 0 && (
          <div className="flex items-center justify-center gap-3 mt-4">
            <Button
              variant="outline"
              size="sm"
              data-testid="orders-pagination-prev"
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
            >
              {t('orders.prev')}
            </Button>
            <span className="text-sm text-muted-foreground">
              {page} / {Math.max(1, meta.total_pages ?? 1)} · {meta.total ?? 0}
            </span>
            <Button
              variant="outline"
              size="sm"
              data-testid="orders-pagination-next"
              onClick={() => setPage(page + 1)}
              disabled={!meta.has_more && page >= (meta.total_pages ?? 1)}
            >
              {t('orders.next')}
            </Button>
            <select
              value={pageSize}
              data-testid="orders-pagesize-select"
              onChange={(e) => { setPageSize(parseInt(e.target.value, 10)); setPage(1); }}
              className="h-8 px-2 text-xs border border-input rounded bg-background"
            >
              {[25, 50, 100].map((n) => (
                <option key={n} value={n}>{n} / {t('orders.pageSizeSuffix')}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* ═══ EDIT SLIDE-OVER PANEL ═══ */}
      {editOrderId && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setEditOrderId(null)} />
          <div className="relative w-full max-w-md bg-background shadow-xl overflow-y-auto">
            <div className="sticky top-0 bg-background border-b px-4 py-3 flex items-center justify-between z-10">
              <h3 className="font-semibold text-sm">{t('orders.editOrder')}</h3>
              <button onClick={() => setEditOrderId(null)}><X className="h-4 w-4" /></button>
            </div>
            <div className="p-4 space-y-4">
              {/* Customer Name */}
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t('customers.name')}</label>
                <Input
                  value={editCustomerName}
                  onChange={(e) => setEditCustomerName(e.target.value)}
                  className="mt-1 h-8 text-sm"
                />
              </div>
              {/* Customer Address */}
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t('orders.address')}</label>
                <textarea
                  value={editCustomerAddress}
                  onChange={(e) => setEditCustomerAddress(e.target.value)}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px]"
                  placeholder={t('orders.addressPlaceholder')}
                />
              </div>
              {/* Editable Items */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">{t('orders.items')}</label>
                <div className="space-y-3">
                  {editItems.map((item, idx) => {
                    const originalItem = orders.find((o) => o.id === editOrderId)?.items.find((i) => i.id === item.id);
                    return (
                      <div key={item.id} className="border rounded-lg p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          {originalItem && <Thumbnail src={originalItem.thumbnail} size={32} />}
                          <span className="text-xs font-medium truncate flex-1">{originalItem?.product_name ?? item.id}</span>
                          <button
                            className="p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-500"
                            title={t('orders.removeItem')}
                            onClick={() => {
                              if (editOrderId && confirm(t('orders.confirmRemoveItem'))) {
                                removeItemMutation.mutate({ orderId: editOrderId, itemId: item.id });
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="text-[10px] text-muted-foreground">{t('orders.subtotal')}</label>
                            <Input
                              type="number"
                              value={item.subtotal}
                              onChange={(e) => {
                                const updated = [...editItems];
                                updated[idx] = { ...updated[idx], subtotal: Number(e.target.value) };
                                setEditItems(updated);
                              }}
                              className="h-7 text-xs"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-muted-foreground">{t('orders.lateFee')}</label>
                            <Input
                              type="number"
                              value={item.late_fee}
                              onChange={(e) => {
                                const updated = [...editItems];
                                updated[idx] = { ...updated[idx], late_fee: Number(e.target.value) };
                                setEditItems(updated);
                              }}
                              className="h-7 text-xs"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-muted-foreground">{t('orders.damageFee')}</label>
                            <Input
                              type="number"
                              value={item.damage_fee}
                              onChange={(e) => {
                                const updated = [...editItems];
                                updated[idx] = { ...updated[idx], damage_fee: Number(e.target.value) };
                                setEditItems(updated);
                              }}
                              className="h-7 text-xs"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Add Item */}
                {!showAddItem ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full mt-2 h-7 text-xs border-dashed"
                    onClick={() => setShowAddItem(true)}
                  >
                    <Plus className="h-3 w-3 mr-1" /> {t('orders.addItem')}
                  </Button>
                ) : (
                  <div className="mt-2 border rounded-lg p-3 space-y-2 bg-muted/20">
                    <Input
                      placeholder={t('orders.searchProducts')}
                      value={addItemSearch}
                      onChange={(e) => setAddItemSearch(e.target.value)}
                      className="h-7 text-xs"
                    />
                    {productSearchData?.data && productSearchData.data.length > 0 && (
                      <div className="max-h-32 overflow-y-auto border rounded bg-background">
                        {productSearchData.data.map((p: AdminProduct) => (
                          <button
                            key={p.id}
                            className={`w-full text-left px-2 py-1.5 text-xs hover:bg-muted/50 flex items-center gap-2 ${addItemProductId === p.id ? 'bg-primary/10' : ''}`}
                            onClick={() => { setAddItemProductId(p.id); setAddItemSearch(p.name); setAddItemSize(p.size[0] ?? ''); }}
                          >
                            <Thumbnail src={p.thumbnail} size={24} />
                            <div className="truncate">
                              <span className="font-medium">{p.name}</span>
                              <span className="text-muted-foreground ml-1">{p.sku}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {addItemProductId && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-muted-foreground">{t('orders.size')}</label>
                          <Input
                            value={addItemSize}
                            onChange={(e) => setAddItemSize(e.target.value)}
                            className="h-7 text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground">{t('orders.priceSubtotal')}</label>
                          <Input
                            type="number"
                            value={addItemSubtotal}
                            onChange={(e) => setAddItemSubtotal(e.target.value)}
                            className="h-7 text-xs"
                            placeholder="0"
                          />
                        </div>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 h-7 text-xs"
                        onClick={() => { setShowAddItem(false); setAddItemSearch(''); setAddItemProductId(''); setAddItemSize(''); setAddItemSubtotal(''); }}
                      >
                        {t('common.cancel')}
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1 h-7 text-xs"
                        disabled={!addItemProductId || !addItemSize || !addItemSubtotal || addItemMutation.isPending}
                        onClick={() => {
                          if (editOrderId && addItemProductId && addItemSize && addItemSubtotal) {
                            addItemMutation.mutate({
                              orderId: editOrderId,
                              body: { product_id: addItemProductId, size: addItemSize, subtotal: Number(addItemSubtotal) },
                            });
                          }
                        }}
                      >
                        {addItemMutation.isPending ? t('common.loading') : t('orders.addItem')}
                      </Button>
                    </div>
                    {addItemMutation.isError && (
                      <p className="text-xs text-destructive">{(addItemMutation.error as Error).message}</p>
                    )}
                  </div>
                )}

                {/* Revenue Impact Summary */}
                {revenueImpacts.length > 0 && (
                  <div className="mt-3 border rounded-lg p-2 space-y-1">
                    <label className="text-[10px] font-medium text-muted-foreground">{t('orders.revenueImpact')}</label>
                    {revenueImpacts.map((impact, i) => (
                      <div key={i} className={`text-xs flex justify-between ${impact.type === 'refund' ? 'text-red-600' : 'text-green-600'}`}>
                        <span>{impact.label}</span>
                        <span className="font-medium">
                          {impact.type === 'refund' ? `${t('orders.refund')}: -${impact.amount.toLocaleString()}` : `${t('orders.additionalCharge')}: +${impact.amount.toLocaleString()}`} THB
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {/* Status Change (inline in edit panel) */}
              {orderDetail && editOrderId === orderDetail.id && ALL_TRANSITIONS[orderDetail.status]?.length > 0 && (
                <div className="border-t pt-4">
                  <label className="text-xs font-medium text-muted-foreground">{t('orders.changeStatus')}</label>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    {(FORWARD_TRANSITIONS[orderDetail.status] ?? []).map((s) => (
                      <Button
                        key={s}
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => openStatusModal(editOrderId, orderDetail.status)}
                      >
                        → {t(`orders.statusLabel.${s}`)}
                      </Button>
                    ))}
                    {(BACKWARD_TRANSITIONS[orderDetail.status] ?? []).map((s) => (
                      <Button
                        key={s}
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-muted-foreground border border-dashed"
                        onClick={() => openStatusModal(editOrderId, orderDetail.status)}
                      >
                        <Undo2 className="h-3 w-3 mr-1" /> {t('orders.backwardTransition')} {t(`orders.statusLabel.${s}`)}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              {/* Payment slips section */}
              {orderDetail && editOrderId === orderDetail.id && orderDetail.payment_slips.length > 0 && (
                <div className="border-t pt-4">
                  <label className="text-xs font-medium text-muted-foreground mb-2 block">{t('orders.paymentSlips')}</label>
                  <div className="space-y-2">
                    {orderDetail.payment_slips.map((slip) => (
                      <div key={slip.id} className="flex items-center justify-between text-xs border rounded p-2">
                        <div>
                          <span className="font-medium">{slip.declared_amount.toLocaleString()} THB</span>
                          <span className="text-muted-foreground ml-1">• {slip.bank_name}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className={`px-1.5 py-0.5 rounded-full ${
                            slip.verification_status === 'verified' ? 'bg-green-100 text-green-700' :
                            slip.verification_status === 'rejected' ? 'bg-red-100 text-red-700' :
                            'bg-yellow-100 text-yellow-700'
                          }`}>
                            {slip.verification_status}
                          </span>
                          {slip.verification_status === 'pending' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[10px]"
                              onClick={() => {
                                setSlipModalOrderId(editOrderId);
                                setSelectedSlipId(slip.id);
                                setShowSlipModal(true);
                              }}
                            >
                              {t('orders.verify')}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* After-sales trigger */}
              <div className="border-t pt-4">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full h-8 text-xs"
                  onClick={() => { openAfterSalesModal(editOrderId); }}
                >
                  <DollarSign className="h-3 w-3 mr-1" /> {t('orders.afterSales')}
                </Button>
              </div>
              {/* Shipping label */}
              {orderDetail && editOrderId === orderDetail.id && (orderDetail.status === 'paid_locked' || orderDetail.status === 'shipped') && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full h-8 text-xs"
                  onClick={() => navigate(`/orders/${editOrderId}/shipping-label`)}
                >
                  <Printer className="h-3 w-3 mr-1" /> {t('shipping.printLabel')}
                </Button>
              )}
              {/* Activity Log */}
              <div className="border-t pt-4">
                <label className="text-xs font-semibold text-foreground flex items-center gap-1.5 mb-2">
                  <History className="h-3.5 w-3.5" /> {t('orders.auditLog')}
                </label>
                <div className="rounded-lg bg-gray-50 p-3">
                  {!orderDetail || editOrderId !== orderDetail.id ? (
                    <p className="text-[11px] text-muted-foreground italic text-center py-2">{t('common.loading')}</p>
                  ) : (orderDetail.audit_logs ?? []).length === 0 ? (
                    <p className="text-[11px] text-muted-foreground italic text-center py-2">{t('orders.noAuditLogs')}</p>
                  ) : (
                    <div className="space-y-1.5 max-h-56 overflow-y-auto">
                      {(orderDetail.audit_logs ?? []).map((log) => (
                        <div key={log.id} className="text-[11px] bg-white rounded border border-gray-200 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-foreground truncate">{log.admin_name}</span>
                            <span className="text-[10px] text-muted-foreground whitespace-nowrap">{new Date(log.created_at).toLocaleString()}</span>
                          </div>
                          <div className="text-muted-foreground mt-0.5 leading-relaxed">
                            <span className="font-medium text-foreground/80">{log.action}</span>
                            {log.details && typeof log.details === 'object' && (
                              <span className="ml-1">
                                — {Object.entries(log.details as Record<string, unknown>)
                                  .filter(([k]) => k !== 'changes')
                                  .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                                  .join(', ')}
                                {(() => {
                                  const d = log.details as Record<string, unknown>;
                                  return d.changes && Array.isArray(d.changes) ? ` (${(d.changes as string[]).join('; ')})` : '';
                                })()}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Save/Cancel */}
              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1 h-8 text-xs" onClick={() => setEditOrderId(null)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  className="flex-1 h-8 text-xs"
                  disabled={editMutation.isPending}
                  onClick={() => {
                    const body: Record<string, unknown> = {};
                    const originalOrder = orders.find((o) => o.id === editOrderId);
                    if (editCustomerName !== originalOrder?.customer.name) {
                      body.customer_name = editCustomerName;
                    }
                    if (editCustomerAddress.trim()) {
                      try { body.customer_address = JSON.parse(editCustomerAddress); }
                      catch { body.customer_address = { raw: editCustomerAddress }; }
                    }
                    const changedItems = editItems.filter((item) => {
                      const orig = originalOrder?.items.find((i) => i.id === item.id);
                      return orig && (orig.subtotal !== item.subtotal || orig.late_fee !== item.late_fee || orig.damage_fee !== item.damage_fee);
                    });
                    if (changedItems.length > 0) body.items = changedItems;
                    if (Object.keys(body).length > 0) {
                      editMutation.mutate({ orderId: editOrderId, body });
                    } else {
                      setEditOrderId(null);
                    }
                  }}
                >
                  {editMutation.isPending ? t('common.loading') : t('common.save')}
                </Button>
              </div>
              {editMutation.isError && (
                <p className="text-xs text-destructive">{(editMutation.error as Error).message}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ STATUS CHANGE MODAL ═══ */}
      {showStatusModal && statusModalOrderId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
          <div className="bg-background rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">{t('orders.changeStatus')}</h3>
              <button onClick={() => { setShowStatusModal(false); setStatusModalOrderId(null); }}><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">{t('orders.newStatus')}</label>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                  className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">{t('orders.selectStatus')}</option>
                  {(FORWARD_TRANSITIONS[statusModalCurrentStatus] ?? []).map((s) => (
                    <option key={s} value={s}>{t(`orders.statusLabel.${s}`)}</option>
                  ))}
                  {(BACKWARD_TRANSITIONS[statusModalCurrentStatus] ?? []).length > 0 && (
                    <optgroup label={`── ${t('orders.backwardTransition')} ──`}>
                      {(BACKWARD_TRANSITIONS[statusModalCurrentStatus] ?? []).map((s) => (
                        <option key={s} value={s}>↩ {t(`orders.statusLabel.${s}`)}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
              {newStatus === 'shipped' && (
                <>
                  <div>
                    <label className="text-sm font-medium">{t('shipping.carrier')}</label>
                    <select
                      value={selectedCarrier}
                      onChange={(e) => setSelectedCarrier(e.target.value)}
                      className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="">{t('shipping.selectCarrier')}</option>
                      {CARRIERS.map((c) => (
                        <option key={c.code} value={c.code}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">{t('orders.trackingNumber')}</label>
                    <Input value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} placeholder="e.g. TH12345678901" />
                  </div>
                </>
              )}
              <div>
                <label className="text-sm font-medium">{t('orders.note')}</label>
                <Input value={statusNote} onChange={(e) => setStatusNote(e.target.value)} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setShowStatusModal(false); setStatusModalOrderId(null); }}>{t('common.cancel')}</Button>
                <Button
                  onClick={() => statusMutation.mutate({
                    orderId: statusModalOrderId,
                    body: { to_status: newStatus, tracking_number: trackingNumber || undefined, note: statusNote || undefined },
                  })}
                  disabled={!newStatus || statusMutation.isPending}
                >
                  {statusMutation.isPending ? t('common.loading') : t('common.save')}
                </Button>
              </div>
              {statusMutation.isError && (
                <p className="text-sm text-destructive">{(statusMutation.error as Error).message}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ SLIP VERIFY MODAL ═══ */}
      {showSlipModal && slipModalOrderId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
          <div className="bg-background rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">{t('orders.verifySlip')}</h3>
              <button onClick={() => { setShowSlipModal(false); setSlipModalOrderId(null); }}><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4">
              <div className="flex gap-4">
                <Button
                  variant={slipVerified ? 'default' : 'outline'}
                  onClick={() => setSlipVerified(true)}
                  className="flex-1"
                >
                  {t('orders.approve')}
                </Button>
                <Button
                  variant={!slipVerified ? 'destructive' : 'outline'}
                  onClick={() => setSlipVerified(false)}
                  className="flex-1"
                >
                  {t('orders.reject')}
                </Button>
              </div>
              <div>
                <label className="text-sm font-medium">{t('orders.note')}</label>
                <Input value={slipNote} onChange={(e) => setSlipNote(e.target.value)} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setShowSlipModal(false); setSlipModalOrderId(null); }}>{t('common.cancel')}</Button>
                <Button
                  onClick={() => slipMutation.mutate({
                    orderId: slipModalOrderId,
                    body: { slip_id: selectedSlipId, verified: slipVerified, note: slipNote || undefined },
                  })}
                  disabled={slipMutation.isPending}
                >
                  {slipMutation.isPending ? t('common.loading') : t('common.save')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ AFTER-SALES MODAL ═══ */}
      {showAfterSalesModal && afterSalesOrderId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
          <div className="bg-background rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">{t('orders.afterSales')}</h3>
              <button onClick={() => { setShowAfterSalesModal(false); setAfterSalesOrderId(null); }}><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">{t('orders.eventType')}</label>
                <select
                  value={afterSalesType}
                  onChange={(e) => { setAfterSalesType(e.target.value); setAfterSalesAmount(''); }}
                  className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">{t('orders.selectType')}</option>
                  {AFTER_SALES_TYPES.map((type) => (
                    <option key={type} value={type}>{t(`orders.afterSalesType.${type}`)}</option>
                  ))}
                </select>
              </div>

              {/* Late fee auto-calculation hint */}
              {afterSalesType === 'late_fee' && lateFeeData?.data && (
                <div className={`rounded-lg p-3 text-sm ${lateFeeData.data.is_overdue ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
                  {lateFeeData.data.is_overdue ? (
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="font-medium text-red-700">{t('orders.overdueAlert')}</p>
                        <p className="text-red-600">{t('orders.daysLate')}: {lateFeeData.data.days_late}</p>
                        <p className="text-red-600">{t('orders.feePerDay')}: {lateFeeData.data.fee_per_day.toLocaleString()} THB</p>
                        <p className="font-bold text-red-700">{t('orders.suggestedFee')}: {lateFeeData.data.total_late_fee.toLocaleString()} THB</p>
                        <p className="text-red-600">{t('orders.depositRemaining')}: {lateFeeData.data.deposit_remaining.toLocaleString()} THB</p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2"
                          onClick={() => setAfterSalesAmount(String(lateFeeData.data.total_late_fee))}
                        >
                          {t('orders.applyFee')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-green-700">{t('orders.notOverdue')}</p>
                  )}
                </div>
              )}

              {/* Force-buy warning */}
              {afterSalesType === 'force_buy' && (
                <div className="rounded-lg p-3 text-sm bg-amber-50 border border-amber-200">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium text-amber-700">{t('orders.forceBuyWarning')}</p>
                      <p className="text-amber-600">{t('orders.forceBuyDesc')}</p>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="text-sm font-medium">{t('orders.amount')}</label>
                <Input type="number" value={afterSalesAmount} onChange={(e) => setAfterSalesAmount(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium">{t('orders.note')}</label>
                <Input value={afterSalesNote} onChange={(e) => setAfterSalesNote(e.target.value)} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setShowAfterSalesModal(false); setAfterSalesOrderId(null); }}>{t('common.cancel')}</Button>
                <Button
                  onClick={() => afterSalesMutation.mutate({
                    orderId: afterSalesOrderId,
                    body: {
                      event_type: afterSalesType,
                      amount: Number(afterSalesAmount),
                      note: afterSalesNote || undefined,
                    },
                  })}
                  disabled={!afterSalesType || !afterSalesAmount || afterSalesMutation.isPending}
                >
                  {afterSalesMutation.isPending ? t('common.loading') : t('common.save')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ CREATE ORDER MODAL ═══ */}
      {showCreateOrder && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-8 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 mb-8">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold">{t('orders.createOrder')}</h3>
              <button onClick={() => setShowCreateOrder(false)}><X className="h-4 w-4" /></button>
            </div>
            <div className="p-4 space-y-3">
              {/* Customer info */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium">{t('customers.name')} *</label>
                  <Input className="h-8 text-sm" value={createCustomerName} onChange={(e) => setCreateCustomerName(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium">{t('orders.phone')} *</label>
                  <Input className="h-8 text-sm" value={createCustomerPhone} onChange={(e) => setCreateCustomerPhone(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium">{t('orders.email')}</label>
                <Input className="h-8 text-sm" type="email" value={createCustomerEmail} onChange={(e) => setCreateCustomerEmail(e.target.value)} />
              </div>

              {/* Rental dates */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium">{t('orders.rentalStart')} *</label>
                  <Input className="h-8 text-sm" type="date" value={createStartDate} onChange={(e) => setCreateStartDate(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium">{t('orders.rentalEnd')} *</label>
                  <Input className="h-8 text-sm" type="date" value={createEndDate} onChange={(e) => setCreateEndDate(e.target.value)} />
                </div>
              </div>

              {/* Items */}
              <div>
                <label className="text-xs font-medium">{t('orders.items')} *</label>
                {createItems.length > 0 && (
                  <div className="space-y-1 mt-1">
                    {createItems.map((item, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs bg-gray-50 rounded p-2">
                        <span className="flex-1 truncate">{item.product_name}</span>
                        <span className="text-muted-foreground">{item.size}</span>
                        <span>×{item.quantity}</span>
                        <Input className="h-6 text-xs w-20" type="number" value={item.subtotal} onChange={(e) => {
                          const updated = [...createItems];
                          updated[idx] = { ...updated[idx], subtotal: e.target.value };
                          setCreateItems(updated);
                        }} />
                        <span className="text-muted-foreground">THB</span>
                        <button onClick={() => setCreateItems((prev) => prev.filter((_, i) => i !== idx))}>
                          <Trash2 className="h-3 w-3 text-red-500" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {!showCreateItemPicker ? (
                  <Button size="sm" variant="outline" className="mt-1 h-7 text-xs w-full" onClick={() => setShowCreateItemPicker(true)}>
                    <Plus className="h-3 w-3 mr-1" /> {t('orders.addItem')}
                  </Button>
                ) : (
                  <div className="mt-1 border rounded p-2 space-y-1">
                    <Input
                      className="h-7 text-xs"
                      placeholder={t('orders.searchProducts')}
                      value={createItemSearch}
                      onChange={(e) => setCreateItemSearch(e.target.value)}
                      autoFocus
                    />
                    {(createProductSearchData?.data ?? []).length > 0 && (
                      <div className="max-h-32 overflow-y-auto space-y-0.5">
                        {(createProductSearchData?.data ?? []).map((p: AdminProduct) => (
                          <button
                            key={p.id}
                            className="w-full text-left text-xs p-1.5 hover:bg-blue-50 rounded flex justify-between"
                            onClick={() => {
                              setCreateItems((prev) => [...prev, {
                                product_id: p.id,
                                product_name: p.name,
                                size: p.size?.[0] ?? 'M',
                                quantity: 1,
                                subtotal: String(p.rental_prices?.['1day'] ?? 0),
                              }]);
                              setShowCreateItemPicker(false);
                              setCreateItemSearch('');
                            }}
                          >
                            <span>{p.name} ({p.sku})</span>
                            <span className="text-muted-foreground">{p.rental_prices?.['1day'] ?? 0} THB</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => { setShowCreateItemPicker(false); setCreateItemSearch(''); }}>
                      {t('common.cancel')}
                    </Button>
                  </div>
                )}
              </div>

              {/* Deposit & Delivery */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium">{t('orders.deposit')}</label>
                  <Input className="h-8 text-sm" type="number" value={createDeposit} onChange={(e) => setCreateDeposit(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium">{t('orders.deliveryFee')}</label>
                  <Input className="h-8 text-sm" type="number" value={createDeliveryFee} onChange={(e) => setCreateDeliveryFee(e.target.value)} />
                </div>
              </div>

              {/* Note */}
              <div>
                <label className="text-xs font-medium">{t('orders.note')}</label>
                <textarea className="w-full border rounded text-sm p-2 h-16 resize-none" value={createNote} onChange={(e) => setCreateNote(e.target.value)} />
              </div>

              {/* Mark as paid */}
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={createMarkPaid} onChange={(e) => setCreateMarkPaid(e.target.checked)} />
                {t('orders.markAsPaid')}
              </label>

              {/* Summary */}
              {createItems.length > 0 && (
                <div className="bg-gray-50 rounded p-2 text-xs space-y-0.5">
                  <div className="flex justify-between"><span>{t('orders.subtotal')}</span><span>{createItems.reduce((s, i) => s + (Number(i.subtotal) || 0), 0)} THB</span></div>
                  <div className="flex justify-between"><span>{t('orders.deposit')}</span><span>{createDeposit} THB</span></div>
                  <div className="flex justify-between"><span>{t('orders.deliveryFee')}</span><span>{createDeliveryFee} THB</span></div>
                  <div className="flex justify-between font-semibold border-t pt-1 mt-1">
                    <span>{t('orders.total')}</span>
                    <span>{createItems.reduce((s, i) => s + (Number(i.subtotal) || 0), 0) + (Number(createDeposit) || 0) + (Number(createDeliveryFee) || 0)} THB</span>
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 p-4 border-t">
              <Button variant="outline" onClick={() => setShowCreateOrder(false)}>{t('common.cancel')}</Button>
              <Button
                disabled={!createCustomerName || !createCustomerPhone || !createStartDate || !createEndDate || createItems.length === 0 || createOrderMutation.isPending}
                onClick={() => {
                  createOrderMutation.mutate({
                    customer_name: createCustomerName,
                    customer_phone: createCustomerPhone,
                    customer_email: createCustomerEmail || undefined,
                    rental_start_date: createStartDate,
                    rental_end_date: createEndDate,
                    items: createItems.map((i) => ({
                      product_id: i.product_id,
                      size: i.size,
                      quantity: i.quantity,
                      subtotal: Number(i.subtotal) || 0,
                    })),
                    deposit: Number(createDeposit) || 0,
                    delivery_fee: Number(createDeliveryFee) || 0,
                    note: createNote || undefined,
                    mark_as_paid: createMarkPaid,
                  });
                }}
              >
                {createOrderMutation.isPending ? t('common.loading') : t('orders.createOrder')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
