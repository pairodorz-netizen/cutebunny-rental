import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { adminApi, type AdminProductDetail, type StockLog } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Image, ChevronLeft, ChevronRight, Plus, Package, AlertCircle, Loader2 } from 'lucide-react';

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
  const queryClient = useQueryClient();
  const [galleryIdx, setGalleryIdx] = useState(0);
  const [calMonth, setCalMonth] = useState(() => new Date());

  // Stock management state
  const [showAddStock, setShowAddStock] = useState(false);
  const [stockQty, setStockQty] = useState('');
  const [stockUnitCost, setStockUnitCost] = useState('');
  const [stockNote, setStockNote] = useState('');
  const [stockError, setStockError] = useState<string | null>(null);
  const [stockSuccess, setStockSuccess] = useState<string | null>(null);
  const [stockLogPage, setStockLogPage] = useState(1);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['product-detail', id],
    queryFn: () => adminApi.products.detail(id!),
    enabled: !!id,
  });

  const product: AdminProductDetail | undefined = data?.data;

  // Stock logs query
  const { data: stockLogsData } = useQuery({
    queryKey: ['stock-logs', id, stockLogPage],
    queryFn: () => adminApi.products.stockLogs(id!, { page: String(stockLogPage), per_page: '10' }),
    enabled: !!id && !!product,
  });

  const stockLogs = stockLogsData?.data ?? [];
  const stockLogsMeta = stockLogsData?.meta;

  // Add stock mutation
  const addStockMutation = useMutation({
    mutationFn: (body: { quantity: number; unit_cost: number; note?: string }) =>
      adminApi.products.addStock(id!, body),
    onSuccess: (res) => {
      setStockSuccess(`Added ${stockQty} units. New stock: ${res.data.stock_on_hand}`);
      setStockQty('');
      setStockUnitCost('');
      setStockNote('');
      queryClient.invalidateQueries({ queryKey: ['product-detail', id] });
      queryClient.invalidateQueries({ queryKey: ['stock-logs', id] });
      setTimeout(() => { setShowAddStock(false); setStockSuccess(null); }, 2000);
    },
    onError: (err: Error) => setStockError(err.message),
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

  function getDayStatus(day: number): string | null {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    for (const cal of product!.calendar) {
      if (dateStr >= cal.start && dateStr <= cal.end) {
        return cal.status;
      }
    }
    return null;
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
            <div className="grid grid-cols-7 gap-1 text-center text-xs">
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
                <div key={d} className="py-1 text-muted-foreground font-medium">{d}</div>
              ))}
              {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                <div key={`empty-${i}`} />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const status = getDayStatus(day);
                const colorClass = status
                  ? (CALENDAR_COLORS[status] ?? 'bg-gray-300')
                  : 'bg-green-200';
                return (
                  <div
                    key={day}
                    className={`py-1 rounded text-xs ${colorClass}`}
                    title={status ?? 'available'}
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

        {/* Stock History Log */}
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 text-xs font-medium">{t('stock.logType')}</th>
                <th className="text-right p-3 text-xs font-medium">{t('stock.quantity')}</th>
                <th className="text-right p-3 text-xs font-medium">{t('stock.unitCost')}</th>
                <th className="text-right p-3 text-xs font-medium">{t('stock.totalCost')}</th>
                <th className="text-left p-3 text-xs font-medium">{t('stock.note')}</th>
                <th className="text-left p-3 text-xs font-medium">{t('stock.date')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {stockLogs.length === 0 ? (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground text-sm">{t('stock.noLogs')}</td></tr>
              ) : stockLogs.map((log) => (
                <tr key={log.id} className="hover:bg-muted/30">
                  <td className="p-3 text-xs">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      log.type === 'purchase' ? 'bg-green-100 text-green-800' :
                      log.type === 'adjust' ? 'bg-blue-100 text-blue-800' :
                      log.type === 'loss' ? 'bg-red-100 text-red-800' :
                      log.type === 'rental_out' ? 'bg-orange-100 text-orange-800' :
                      log.type === 'rental_in' ? 'bg-teal-100 text-teal-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {t(`stock.type_${log.type}`)}
                    </span>
                  </td>
                  <td className={`p-3 text-sm text-right font-medium ${log.quantity >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {log.quantity >= 0 ? '+' : ''}{log.quantity}
                  </td>
                  <td className="p-3 text-sm text-right">{log.unit_cost > 0 ? log.unit_cost.toLocaleString() : '-'}</td>
                  <td className="p-3 text-sm text-right">{log.total_cost > 0 ? log.total_cost.toLocaleString() : '-'}</td>
                  <td className="p-3 text-xs text-muted-foreground">{log.note ?? '-'}</td>
                  <td className="p-3 text-xs text-muted-foreground">{new Date(log.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {stockLogsMeta && stockLogsMeta.total_pages > 1 && (
          <div className="flex justify-center gap-2 mt-3">
            <Button variant="outline" size="sm" disabled={stockLogPage <= 1} onClick={() => setStockLogPage(stockLogPage - 1)}>
              ←
            </Button>
            <span className="text-sm py-1 px-2">{stockLogPage} / {stockLogsMeta.total_pages}</span>
            <Button variant="outline" size="sm" disabled={stockLogPage >= stockLogsMeta.total_pages} onClick={() => setStockLogPage(stockLogPage + 1)}>
              →
            </Button>
          </div>
        )}
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
