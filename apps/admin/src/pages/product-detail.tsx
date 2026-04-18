import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { adminApi, type AdminProductDetail, type StockLog, type PerUnitCalendarResponse } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Image, ChevronLeft, ChevronRight, Plus, Package, AlertCircle, Loader2, RotateCcw, Filter } from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  unpaid: 'bg-yellow-100 text-yellow-800',
  paid_locked: 'bg-blue-100 text-blue-800',
  shipped: 'bg-purple-100 text-purple-800',
  returned: 'bg-teal-100 text-teal-800',
  cleaning: 'bg-cyan-100 text-cyan-800',
  repair: 'bg-orange-100 text-orange-800',
  finished: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-800',
};

const CALENDAR_COLORS: Record<string, string> = {
  shipped: 'bg-gray-300',
  returned: 'bg-gray-300',
  cleaning: 'bg-blue-300',
  repair: 'bg-blue-300',
};

export function ProductDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [galleryIdx, setGalleryIdx] = useState(0);
  const [calMonth, setCalMonth] = useState(() => new Date());

  // OQ-W3-01: Per-unit calendar filter synced with URL ?unit= param
  // Survives refresh/share — 'all' | '1' | '2' | ...
  const calUnitFilter = searchParams.get('unit') || 'all';
  const setCalUnitFilter = useCallback((unit: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (unit === 'all') {
        next.delete('unit');
      } else {
        next.set('unit', unit);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Stock management state
  const [showAddStock, setShowAddStock] = useState(false);
  const [stockQty, setStockQty] = useState('');
  const [stockUnitCost, setStockUnitCost] = useState('');
  const [stockNote, setStockNote] = useState('');
  const [stockError, setStockError] = useState<string | null>(null);
  const [stockSuccess, setStockSuccess] = useState<string | null>(null);

  // B2: Stock log filters
  const [logTypeFilter, setLogTypeFilter] = useState<string>('');
  const [logDateFrom, setLogDateFrom] = useState('');
  const [logDateTo, setLogDateTo] = useState('');

  // B3: Infinite scroll state
  const [allStockLogs, setAllStockLogs] = useState<StockLog[]>([]);
  const [logCursor, setLogCursor] = useState<string | null>(null);
  const [hasMoreLogs, setHasMoreLogs] = useState(true);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logFetchRef = useRef(0); // BUG-301: guard against concurrent/duplicate fetches

  const { data, isLoading, isError } = useQuery({
    queryKey: ['product-detail', id],
    queryFn: () => adminApi.products.detail(id!),
    enabled: !!id,
  });

  const product: AdminProductDetail | undefined = data?.data;

  // FEAT-302: Per-unit calendar query
  const calYear = calMonth.getFullYear();
  const calMonthNum = calMonth.getMonth() + 1;
  const { data: calendarData } = useQuery({
    queryKey: ['product-calendar', id, calYear, calMonthNum, calUnitFilter],
    queryFn: () => adminApi.products.perUnitCalendar(id!, { year: calYear, month: calMonthNum, unit: calUnitFilter }),
    enabled: !!id && !!product,
  });
  const perUnitCal: PerUnitCalendarResponse | undefined = calendarData?.data;
  const totalUnits = perUnitCal?.total_units ?? Math.max(product?.stock_on_hand ?? 0, 1);

  // FEAT-302: Chevron navigation — cycle: all → 1 → 2 → ... → N → all
  function calUnitPrev() {
    if (calUnitFilter === 'all') {
      setCalUnitFilter(String(totalUnits));
    } else {
      const cur = parseInt(calUnitFilter, 10);
      setCalUnitFilter(cur <= 1 ? 'all' : String(cur - 1));
    }
  }
  function calUnitNext() {
    if (calUnitFilter === 'all') {
      setCalUnitFilter(totalUnits > 0 ? '1' : 'all');
    } else {
      const cur = parseInt(calUnitFilter, 10);
      setCalUnitFilter(cur >= totalUnits ? 'all' : String(cur + 1));
    }
  }
  const calUnitLabel = calUnitFilter === 'all'
    ? t('calendar.allUnits')
    : t('calendar.unitXofN', { x: calUnitFilter, n: totalUnits });

  // B3: Load stock logs with cursor pagination
  const loadStockLogs = useCallback(async (reset = false) => {
    if (!id || isLoadingLogs) return;
    setIsLoadingLogs(true);
    try {
      const params: Record<string, string> = { limit: '20' };
      if (!reset && logCursor) params.cursor = logCursor;
      if (logTypeFilter) params.type = logTypeFilter;
      if (logDateFrom) params.date_from = logDateFrom;
      if (logDateTo) params.date_to = logDateTo;

      const res = await adminApi.products.stockLogs(id, params);
      const newLogs = res.data ?? [];
      if (reset) {
        // BUG-301: Dedup by log.id via Map
        const dedupMap = new Map<string, StockLog>();
        for (const log of newLogs) dedupMap.set(log.id, log);
        setAllStockLogs(Array.from(dedupMap.values()));
      } else {
        setAllStockLogs((prev) => {
          const dedupMap = new Map<string, StockLog>();
          for (const log of prev) dedupMap.set(log.id, log);
          for (const log of newLogs) dedupMap.set(log.id, log);
          return Array.from(dedupMap.values());
        });
      }
      setLogCursor((res.meta?.cursor as string) ?? null);
      setHasMoreLogs((res.meta?.has_more as boolean) ?? false);
    } catch {
      // ignore
    } finally {
      setIsLoadingLogs(false);
    }
  }, [id, logCursor, logTypeFilter, logDateFrom, logDateTo, isLoadingLogs]);

  // Load initial logs when product loads or filters change
  // BUG-301: Use fetch generation counter to prevent duplicate/stale fetches
  useEffect(() => {
    if (product && id) {
      const generation = ++logFetchRef.current;
      setAllStockLogs([]);
      setLogCursor(null);
      setHasMoreLogs(true);
      // Defer the load to next tick so state resets first
      const timer = setTimeout(() => {
        if (generation !== logFetchRef.current) return; // stale
        const params: Record<string, string> = { limit: '20' };
        if (logTypeFilter) params.type = logTypeFilter;
        if (logDateFrom) params.date_from = logDateFrom;
        if (logDateTo) params.date_to = logDateTo;
        adminApi.products.stockLogs(id, params).then((res) => {
          if (generation !== logFetchRef.current) return; // stale
          // BUG-301: Dedup by log.id via Map (server is source of truth)
          const dedupMap = new Map<string, StockLog>();
          for (const log of (res.data ?? [])) dedupMap.set(log.id, log);
          setAllStockLogs(Array.from(dedupMap.values()));
          setLogCursor((res.meta?.cursor as string) ?? null);
          setHasMoreLogs((res.meta?.has_more as boolean) ?? false);
        }).catch(() => {});
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [product, id, logTypeFilter, logDateFrom, logDateTo]);

  // B3: Intersection observer for infinite scroll
  useEffect(() => {
    if (!logsEndRef.current || !hasMoreLogs || isLoadingLogs) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMoreLogs && !isLoadingLogs) {
          loadStockLogs(false);
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(logsEndRef.current);
    return () => observer.disconnect();
  }, [hasMoreLogs, isLoadingLogs, loadStockLogs]);

  // Add stock mutation
  const addStockMutation = useMutation({
    mutationFn: (body: { quantity: number; unit_cost: number; note?: string }) =>
      adminApi.products.addStock(id!, body),
    onSuccess: (res) => {
      setStockSuccess(`Added ${stockQty} units. New stock: ${res.data.stock_on_hand}`);
      setStockQty('');
      setStockUnitCost('');
      setStockNote('');
      // BUG-301: Only invalidate product query — useEffect handles log refetch
      // Do NOT manually reset allStockLogs here (causes double-fetch / duplication)
      queryClient.invalidateQueries({ queryKey: ['product-detail', id] });
      setTimeout(() => { setShowAddStock(false); setStockSuccess(null); }, 2000);
    },
    onError: (err: Error) => setStockError(err.message),
  });

  // A2: Restore mutation
  const restoreMutation = useMutation({
    mutationFn: () => adminApi.products.restore(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-detail', id] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });

  function handleAddStock() {
    const qty = parseInt(stockQty, 10);
    const cost = parseInt(stockUnitCost || '0', 10);
    if (!qty || qty < 1) { setStockError(t('stock.invalidQuantity')); return; }
    setStockError(null);
    setStockSuccess(null);
    addStockMutation.mutate({ quantity: qty, unit_cost: cost, note: stockNote || undefined });
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-muted rounded" />
          <div className="h-64 bg-muted rounded" />
          <div className="h-32 bg-muted rounded" />
        </div>
      </div>
    );
  }

  if (isError || !product) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">{t('common.error')}</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/products')}>
          <ArrowLeft className="h-4 w-4 mr-2" /> {t('common.back')}
        </Button>
      </div>
    );
  }

  const images = product.images.length > 0 ? product.images : (product.thumbnail ? [{ id: 'thumb', url: product.thumbnail, alt: null }] : []);

  // Calendar helpers
  const year = calMonth.getFullYear();
  const month = calMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay();

  // OQ-W3-02: Return status + order ref for tooltip
  function getDayInfo(day: number): { status: string | null; orderId: string | null } {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    // FEAT-302: Use per-unit calendar data if available
    if (perUnitCal) {
      if (calUnitFilter === 'all' && perUnitCal.aggregated_days) {
        const dayData = perUnitCal.aggregated_days.find((d) => d.date === dateStr);
        return {
          status: dayData?.status === 'available' ? null : (dayData?.status ?? null),
          orderId: dayData?.order_id ?? null,
        };
      }
      if (perUnitCal.calendars.length > 0) {
        const cal = perUnitCal.calendars[0];
        const dayData = cal.days.find((d) => d.date === dateStr);
        return {
          status: dayData?.status === 'available' ? null : (dayData?.status ?? null),
          orderId: dayData?.order_id ?? null,
        };
      }
    }

    // Fallback: use product.calendar (order-derived)
    for (const cal of product!.calendar) {
      if (dateStr >= cal.start && dateStr <= cal.end) {
        return { status: cal.status, orderId: null };
      }
    }
    return { status: null, orderId: null };
  }

  function buildTooltip(day: number): string {
    const { status, orderId } = getDayInfo(day);
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const parts: string[] = [dateStr];
    if (!status) {
      parts.push(t('products.available'));
    } else {
      parts.push(status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' '));
    }
    if (orderId) {
      parts.push(`Order: ${orderId.slice(0, 8)}...`);
    }
    if (calUnitFilter !== 'all') {
      parts.push(`Unit ${calUnitFilter}`);
    }
    return parts.join(' · ');
  }

  function prevMonth() {
    setCalMonth(new Date(year, month - 1, 1));
  }

  function nextMonth() {
    setCalMonth(new Date(year, month + 1, 1));
  }

  const pl = product.profit_summary;

  return (
    <div className="p-4 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/products')} className="p-1 hover:bg-muted rounded">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold">{product.name}</h1>
          <p className="text-sm text-muted-foreground">{product.sku} · {product.brand ?? 'No brand'} · {product.category}</p>
        </div>
        {product.product_status === 'sold' && (
          <span className="ml-auto px-3 py-1 bg-gray-200 text-gray-700 text-sm rounded-full font-medium">
            {t('products.sold')}
          </span>
        )}
        {product.deleted_at && (
          <div className="ml-auto flex items-center gap-2">
            <span className="px-3 py-1 bg-red-100 text-red-700 text-sm rounded-full font-medium">
              Deleted
            </span>
            <Button size="sm" variant="outline" onClick={() => {
              if (confirm(t('stock.restoreConfirm'))) restoreMutation.mutate();
            }} disabled={restoreMutation.isPending}>
              {restoreMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RotateCcw className="h-4 w-4 mr-1" />}
              {t('stock.restore')}
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Gallery + Info */}
        <div className="space-y-6">
          {/* Image Gallery */}
          {images.length > 0 ? (
            <div>
              <div className="relative rounded-lg overflow-hidden bg-muted aspect-square">
                <img
                  src={images[galleryIdx]?.url}
                  alt={images[galleryIdx]?.alt ?? product.name}
                  className="w-full h-full object-cover"
                />
                {images.length > 1 && (
                  <>
                    <button
                      onClick={() => setGalleryIdx((i) => (i - 1 + images.length) % images.length)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/80 rounded-full p-1"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => setGalleryIdx((i) => (i + 1) % images.length)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/80 rounded-full p-1"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </>
                )}
              </div>
              {images.length > 1 && (
                <div className="flex gap-2 mt-2 overflow-x-auto">
                  {images.map((img, idx) => (
                    <button
                      key={img.id}
                      onClick={() => setGalleryIdx(idx)}
                      className={`w-16 h-16 rounded border-2 overflow-hidden flex-shrink-0 ${idx === galleryIdx ? 'border-primary' : 'border-transparent'}`}
                    >
                      <img src={img.url} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="aspect-square rounded-lg bg-muted flex items-center justify-center">
              <Image className="h-16 w-16 text-muted-foreground/30" />
            </div>
          )}

          {/* Product Info */}
          <div className="rounded-lg border p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground">{t('products.sizes')}:</span> <span className="font-medium">{product.size.join(', ') || '-'}</span></div>
              <div><span className="text-muted-foreground">{t('products.colors')}:</span> <span className="font-medium">{product.color.join(', ') || '-'}</span></div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="text-center p-2 bg-muted/50 rounded">
                <p className="text-xs text-muted-foreground">1 {t('products.day')}</p>
                <p className="font-bold">{product.rental_prices['1day'].toLocaleString()}</p>
              </div>
              <div className="text-center p-2 bg-muted/50 rounded">
                <p className="text-xs text-muted-foreground">3 {t('products.days')}</p>
                <p className="font-bold">{product.rental_prices['3day'].toLocaleString()}</p>
              </div>
              <div className="text-center p-2 bg-muted/50 rounded">
                <p className="text-xs text-muted-foreground">5 {t('products.days')}</p>
                <p className="font-bold">{product.rental_prices['5day'].toLocaleString()}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div><span className="text-muted-foreground">{t('products.buyingCost')}:</span> <span className="font-medium">{product.cost_price.toLocaleString()}</span></div>
              <div><span className="text-muted-foreground">{t('products.variableCost')}:</span> <span className="font-medium">{product.variable_cost.toLocaleString()}</span></div>
              <div><span className="text-muted-foreground">{t('products.retailPrice')}:</span> <span className="font-medium">{product.retail_price.toLocaleString()}</span></div>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">{t('products.rentals')}:</span> <span className="font-bold">{product.rental_count}</span>
            </div>
          </div>
        </div>

        {/* Right: Calendar + P&L */}
        <div className="space-y-6">
          {/* Mini Calendar */}
          <div className="rounded-lg border p-4">
            <div className="flex items-center justify-between mb-3">
              <button onClick={prevMonth} className="p-1 hover:bg-muted rounded">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <h3 className="text-sm font-semibold">
                {calMonth.toLocaleDateString('en', { month: 'long', year: 'numeric' })}
              </h3>
              <button onClick={nextMonth} className="p-1 hover:bg-muted rounded">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            {/* FEAT-302: Per-unit navigation chevrons */}
            {totalUnits > 0 && (
              <div className="flex items-center justify-center gap-2 mb-3 py-1 bg-muted/30 rounded">
                <button
                  onClick={calUnitPrev}
                  className="p-1 hover:bg-muted rounded"
                  aria-label={t('calendar.prevUnit')}
                  data-testid="cal-unit-prev"
                >
                  <ChevronLeft className="h-3 w-3" />
                </button>
                <span className="text-xs font-medium min-w-[100px] text-center" data-testid="cal-unit-label">
                  {calUnitLabel}
                </span>
                <button
                  onClick={calUnitNext}
                  className="p-1 hover:bg-muted rounded"
                  aria-label={t('calendar.nextUnit')}
                  data-testid="cal-unit-next"
                >
                  <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            )}
            <div className="grid grid-cols-7 gap-1 text-center text-xs">
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
                <div key={d} className="py-1 text-muted-foreground font-medium">{d}</div>
              ))}
              {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                <div key={`empty-${i}`} />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const { status } = getDayInfo(day);
                const colorClass = status
                  ? (CALENDAR_COLORS[status] ?? 'bg-gray-300')
                  : 'bg-green-200';
                return (
                  <div
                    key={day}
                    className={`py-1 rounded text-xs cursor-default ${colorClass}`}
                    title={buildTooltip(day)}
                    data-testid={`cal-day-${day}`}
                  >
                    {day}
                  </div>
                );
              })}
            </div>
            <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-200 rounded" /> {t('products.available')}</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-gray-300 rounded" /> {t('products.rented')}</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-300 rounded" /> {t('products.maintenance')}</span>
            </div>
          </div>

          {/* Profit Summary */}
          <div className="rounded-lg border p-4">
            <h3 className="text-sm font-semibold mb-3">{t('products.profitSummary')}</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('products.buyingCost')}</span>
                <span className="text-red-600">-{pl.buying_cost.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('products.totalRentalRevenue')}</span>
                <span className="text-green-600">+{pl.total_rental_revenue.toLocaleString()}</span>
              </div>
              {pl.selling_price > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('products.sellingPrice')}</span>
                  <span className="text-green-600">+{pl.selling_price.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between border-t pt-2 font-bold">
                <span>{t('products.netPL')}</span>
                <span className={pl.net_pl >= 0 ? 'text-green-600' : 'text-red-600'}>
                  {pl.net_pl >= 0 ? '+' : ''}{pl.net_pl.toLocaleString()} THB
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stock Management Section */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            <h3 className="text-sm font-semibold">{t('stock.title')}</h3>
            <span className={`ml-2 px-2 py-0.5 rounded text-xs font-bold ${(product.stock_on_hand ?? 0) <= (product.low_stock_threshold ?? 1) ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
              {t('stock.onHand')}: {product.stock_on_hand ?? 0}
            </span>
          </div>
          <Button size="sm" onClick={() => { setShowAddStock(true); setStockError(null); setStockSuccess(null); }}>
            <Plus className="h-4 w-4 mr-1" /> {t('stock.addStock')}
          </Button>
        </div>

        {/* Add Stock Dialog */}
        {showAddStock && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl">
              <h3 className="text-lg font-semibold mb-4">{t('stock.addStock')}</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-sm text-muted-foreground">{t('stock.quantity')}</label>
                  <Input
                    type="number"
                    min="1"
                    value={stockQty}
                    onChange={(e) => setStockQty(e.target.value)}
                    placeholder="e.g. 5"
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">{t('stock.unitCost')} (THB)</label>
                  <Input
                    type="number"
                    min="0"
                    value={stockUnitCost}
                    onChange={(e) => setStockUnitCost(e.target.value)}
                    placeholder="e.g. 500"
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">{t('stock.note')}</label>
                  <Input
                    value={stockNote}
                    onChange={(e) => setStockNote(e.target.value)}
                    placeholder={t('stock.notePlaceholder')}
                  />
                </div>
                {/* Live preview: show projected stock after add */}
                {stockQty && parseInt(stockQty, 10) > 0 && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded text-sm" data-testid="add-stock-preview">
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">{t('stock.currentStock')}</span>
                      <span className="font-medium">{product.stock_on_hand ?? 0}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">+ {t('stock.adding')}</span>
                      <span className="font-medium text-green-600">+{parseInt(stockQty, 10)}</span>
                    </div>
                    <div className="flex justify-between items-center border-t border-blue-200 pt-1 mt-1">
                      <span className="font-semibold">{t('stock.newTotal')}</span>
                      <span className="font-bold text-blue-700">{(product.stock_on_hand ?? 0) + parseInt(stockQty, 10)}</span>
                    </div>
                    {stockUnitCost && parseInt(stockUnitCost, 10) > 0 && (
                      <div className="flex justify-between items-center text-xs text-muted-foreground mt-1">
                        <span>{t('stock.totalCost')}</span>
                        <span>{(parseInt(stockQty, 10) * parseInt(stockUnitCost, 10)).toLocaleString()} THB</span>
                      </div>
                    )}
                  </div>
                )}
                {stockError && (
                  <div className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                    <AlertCircle className="inline h-4 w-4 mr-1" /> {stockError}
                  </div>
                )}
                {stockSuccess && (
                  <div className="p-2 bg-green-50 border border-green-200 rounded text-sm text-green-700">
                    {stockSuccess}
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <Button variant="outline" size="sm" onClick={() => setShowAddStock(false)}>
                  {t('common.cancel')}
                </Button>
                <Button size="sm" onClick={handleAddStock} disabled={addStockMutation.isPending}>
                  {addStockMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                  {t('stock.addStock')}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* B2: Stock Log Filters */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <select
            className="text-xs border rounded px-2 py-1"
            value={logTypeFilter}
            onChange={(e) => setLogTypeFilter(e.target.value)}
          >
            <option value="">{t('stock.allTypes')}</option>
            <option value="purchase">{t('stock.type_purchase')}</option>
            <option value="adjust">{t('stock.type_adjust')}</option>
            <option value="loss">{t('stock.type_loss')}</option>
            <option value="return_stock">{t('stock.type_return_stock')}</option>
            <option value="rental_out">{t('stock.type_rental_out')}</option>
            <option value="rental_in">{t('stock.type_rental_in')}</option>
          </select>
          <Input
            type="date"
            className="h-7 w-36 text-xs"
            value={logDateFrom}
            onChange={(e) => setLogDateFrom(e.target.value)}
            placeholder={t('stock.dateFrom')}
          />
          <span className="text-xs text-muted-foreground">→</span>
          <Input
            type="date"
            className="h-7 w-36 text-xs"
            value={logDateTo}
            onChange={(e) => setLogDateTo(e.target.value)}
            placeholder={t('stock.dateTo')}
          />
        </div>

        {/* B3: Stock History Log with Infinite Scroll + Color Chips + Running Balance */}
        <div className="rounded-lg border overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 text-xs font-medium">{t('stock.logType')}</th>
                <th className="text-right p-3 text-xs font-medium">{t('stock.quantity')}</th>
                <th className="text-right p-3 text-xs font-medium">{t('stock.runningBalance')}</th>
                <th className="text-right p-3 text-xs font-medium">{t('stock.unitCost')}</th>
                <th className="text-right p-3 text-xs font-medium">{t('stock.totalCost')}</th>
                <th className="text-left p-3 text-xs font-medium">{t('stock.note')}</th>
                <th className="text-left p-3 text-xs font-medium">{t('stock.date')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {allStockLogs.length === 0 && !isLoadingLogs ? (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground text-sm">{t('stock.noLogs')}</td></tr>
              ) : allStockLogs.map((log, idx) => {
                // Running balance: start from current stock, subtract quantities going back in time
                // Logs are ordered desc (newest first), so balance = current - sum(quantities of logs before this one)
                const balanceAfter = (product.stock_on_hand ?? 0) - allStockLogs.slice(0, idx).reduce((sum, l) => sum + l.quantity, 0);
                return (
                <tr key={log.id} className="hover:bg-muted/30">
                  <td className="p-3 text-xs">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      log.type === 'purchase' ? 'bg-green-100 text-green-800' :
                      log.type === 'adjust' ? 'bg-blue-100 text-blue-800' :
                      log.type === 'loss' ? 'bg-red-100 text-red-800' :
                      log.type === 'rental_out' ? 'bg-orange-100 text-orange-800' :
                      log.type === 'rental_in' ? 'bg-teal-100 text-teal-800' :
                      log.type === 'return_stock' ? 'bg-purple-100 text-purple-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {t(`stock.type_${log.type}`)}
                    </span>
                  </td>
                  <td className={`p-3 text-sm text-right font-medium ${log.quantity >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {log.quantity >= 0 ? '+' : ''}{log.quantity}
                  </td>
                  <td className="p-3 text-sm text-right font-medium" data-testid={`balance-${log.id}`}>
                    {balanceAfter}
                  </td>
                  <td className="p-3 text-sm text-right">{log.unit_cost > 0 ? log.unit_cost.toLocaleString() : '-'}</td>
                  <td className="p-3 text-sm text-right">{log.total_cost > 0 ? log.total_cost.toLocaleString() : '-'}</td>
                  <td className="p-3 text-xs text-muted-foreground">{log.note ?? '-'}</td>
                  <td className="p-3 text-xs text-muted-foreground">{new Date(log.created_at).toLocaleDateString()}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
          {/* B3: Infinite scroll sentinel */}
          <div ref={logsEndRef} className="p-2 text-center">
            {isLoadingLogs && <Loader2 className="h-4 w-4 animate-spin inline" />}
            {!hasMoreLogs && allStockLogs.length > 0 && (
              <span className="text-xs text-muted-foreground">{t('stock.noMoreLogs')}</span>
            )}
          </div>
        </div>
      </div>

      {/* Rental History */}
      <div className="mt-6">
        <h3 className="text-sm font-semibold mb-3">{t('products.rentalHistory')}</h3>
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 text-xs font-medium">{t('orders.orderNumber')}</th>
                <th className="text-left p-3 text-xs font-medium">{t('orders.customerName')}</th>
                <th className="text-left p-3 text-xs font-medium">{t('products.rentalDates')}</th>
                <th className="text-center p-3 text-xs font-medium">{t('products.rentalDays')}</th>
                <th className="text-right p-3 text-xs font-medium">{t('finance.revenue')}</th>
                <th className="text-center p-3 text-xs font-medium">{t('orders.status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {product.rental_history.length === 0 ? (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground text-sm">{t('products.noRentals')}</td></tr>
              ) : product.rental_history.map((rh) => (
                <tr key={rh.order_id} className="hover:bg-muted/30">
                  <td className="p-3 text-sm font-mono">{rh.order_number}</td>
                  <td className="p-3 text-sm">{rh.customer_name}</td>
                  <td className="p-3 text-xs">{rh.rental_start} → {rh.rental_end}</td>
                  <td className="p-3 text-sm text-center">{rh.rental_days}</td>
                  <td className="p-3 text-sm text-right text-green-600">{rh.revenue.toLocaleString()}</td>
                  <td className="p-3 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[rh.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {rh.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
