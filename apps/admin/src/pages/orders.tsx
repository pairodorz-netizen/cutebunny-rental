import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { adminApi } from '@/lib/api';
import type { AdminOrder } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Settings, ChevronDown, X, Printer, AlertTriangle, DollarSign } from 'lucide-react';

const ORDER_STATUSES = ['unpaid', 'paid_locked', 'shipped', 'returned', 'cleaning', 'repair', 'ready'];

const STATUS_TRANSITIONS: Record<string, string[]> = {
  unpaid: ['paid_locked'],
  paid_locked: ['shipped'],
  shipped: ['returned'],
  returned: ['cleaning'],
  cleaning: ['repair', 'ready'],
  repair: ['ready'],
  ready: [],
};

const STATUS_COLORS: Record<string, string> = {
  unpaid: 'bg-yellow-100 text-yellow-800',
  paid_locked: 'bg-blue-100 text-blue-800',
  shipped: 'bg-purple-100 text-purple-800',
  returned: 'bg-orange-100 text-orange-800',
  cleaning: 'bg-cyan-100 text-cyan-800',
  repair: 'bg-red-100 text-red-800',
  ready: 'bg-green-100 text-green-800',
};

const STATUS_TAB_COLORS: Record<string, string> = {
  unpaid: 'bg-yellow-500',
  paid_locked: 'bg-blue-500',
  shipped: 'bg-purple-500',
  returned: 'bg-orange-500',
  cleaning: 'bg-cyan-500',
  repair: 'bg-red-500',
  ready: 'bg-green-500',
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

export function OrdersPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');

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

  // After-sales modal
  const [showAfterSalesModal, setShowAfterSalesModal] = useState(false);
  const [afterSalesOrderId, setAfterSalesOrderId] = useState<string | null>(null);
  const [afterSalesType, setAfterSalesType] = useState('');
  const [afterSalesAmount, setAfterSalesAmount] = useState('');
  const [afterSalesNote, setAfterSalesNote] = useState('');

  // Build query params
  const params: Record<string, string> = { page: String(page), per_page: '20' };
  if (statusFilter) params.status = statusFilter;
  if (debouncedOrderNumber) params.search_order_number = debouncedOrderNumber;
  if (debouncedSku) params.search_sku = debouncedSku;
  if (debouncedProductName) params.search_product_name = debouncedProductName;
  if (debouncedCustomerName) params.search_customer_name = debouncedCustomerName;
  if (debouncedCustomerPhone) params.search_customer_phone = debouncedCustomerPhone;
  if (debouncedTracking) params.search_tracking = debouncedTracking;

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

  // Status counts query (for tab badges)
  const statusCountQueries = ORDER_STATUSES.map((s) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useQuery({
      queryKey: ['admin-orders-count', s],
      queryFn: () => adminApi.orders.list({ status: s, page: '1', per_page: '1' }),
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
      setEditOrderId(null);
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
  const [searchBarHeight, setSearchBarHeight] = useState(0);
  useEffect(() => {
    if (searchBarRef.current) {
      setSearchBarHeight(searchBarRef.current.offsetHeight);
    }
  }, []);

  return (
    <div className="relative">
      {/* ═══ STICKY SEARCH BAR ═══ */}
      <div
        ref={searchBarRef}
        className="sticky top-0 z-20 bg-white shadow-sm border-b px-4 py-2"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder="ORD-..."
            value={searchOrderNumber}
            onChange={(e) => { setSearchOrderNumber(e.target.value); setPage(1); }}
            className="h-7 text-xs w-28 min-w-0"
          />
          <Input
            placeholder="SKU"
            value={searchSku}
            onChange={(e) => { setSearchSku(e.target.value); setPage(1); }}
            className="h-7 text-xs w-24 min-w-0"
          />
          <Input
            placeholder={t('products.name')}
            value={searchProductName}
            onChange={(e) => { setSearchProductName(e.target.value); setPage(1); }}
            className="h-7 text-xs w-32 min-w-0"
          />
          <Input
            placeholder={t('customers.name')}
            value={searchCustomerName}
            onChange={(e) => { setSearchCustomerName(e.target.value); setPage(1); }}
            className="h-7 text-xs w-32 min-w-0"
          />
          <Input
            placeholder={t('orders.phone')}
            value={searchCustomerPhone}
            onChange={(e) => { setSearchCustomerPhone(e.target.value); setPage(1); }}
            className="h-7 text-xs w-28 min-w-0"
          />
          <Input
            placeholder={t('orders.trackingNumber')}
            value={searchTracking}
            onChange={(e) => { setSearchTracking(e.target.value); setPage(1); }}
            className="h-7 text-xs w-32 min-w-0"
          />
          {(searchOrderNumber || searchSku || searchProductName || searchCustomerName || searchCustomerPhone || searchTracking) && (
            <button
              onClick={() => {
                setSearchOrderNumber(''); setSearchSku(''); setSearchProductName('');
                setSearchCustomerName(''); setSearchCustomerPhone(''); setSearchTracking('');
              }}
              className="text-xs text-muted-foreground hover:text-primary"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ═══ STATUS TABS ═══ */}
      <div
        className="sticky z-10 bg-white border-b"
        style={{ top: searchBarHeight }}
      >
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

      {/* ═══ ORDER LIST ═══ */}
      <div className="px-4 py-2">
        {listLoading ? (
          <div className="p-8 text-center text-muted-foreground">{t('common.loading')}</div>
        ) : orders.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">{t('orders.empty')}</div>
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
                      {/* Quick action buttons in expanded view */}
                      <div className="flex gap-2 mt-3">
                        {STATUS_TRANSITIONS[order.status]?.length > 0 && (
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

        {/* Pagination */}
        {meta && meta.total_pages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4">
            <Button variant="outline" size="sm" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}>
              {t('orders.prev')}
            </Button>
            <span className="text-sm text-muted-foreground">{page} / {meta.total_pages}</span>
            <Button variant="outline" size="sm" onClick={() => setPage(Math.min(meta.total_pages, page + 1))} disabled={page >= meta.total_pages}>
              {t('orders.next')}
            </Button>
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
                          <span className="text-xs font-medium truncate">{originalItem?.product_name ?? item.id}</span>
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
              </div>
              {/* Status Change (inline in edit panel) */}
              {orderDetail && editOrderId === orderDetail.id && STATUS_TRANSITIONS[orderDetail.status]?.length > 0 && (
                <div className="border-t pt-4">
                  <label className="text-xs font-medium text-muted-foreground">{t('orders.changeStatus')}</label>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    {(STATUS_TRANSITIONS[orderDetail.status] ?? []).map((s) => (
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
                  {(STATUS_TRANSITIONS[statusModalCurrentStatus] ?? []).map((s) => (
                    <option key={s} value={s}>{t(`orders.statusLabel.${s}`)}</option>
                  ))}
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
    </div>
  );
}
