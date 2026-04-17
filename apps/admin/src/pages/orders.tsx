import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, ChevronLeft, X } from 'lucide-react';

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

const AFTER_SALES_TYPES = ['cancel', 'late_fee', 'damage_fee', 'force_buy', 'partial_refund'];

export function OrdersPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  // Status change modal
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [statusNote, setStatusNote] = useState('');

  // Slip verify modal
  const [showSlipModal, setShowSlipModal] = useState(false);
  const [selectedSlipId, setSelectedSlipId] = useState('');
  const [slipVerified, setSlipVerified] = useState(true);
  const [slipNote, setSlipNote] = useState('');

  // After-sales modal
  const [showAfterSalesModal, setShowAfterSalesModal] = useState(false);
  const [afterSalesType, setAfterSalesType] = useState('');
  const [afterSalesAmount, setAfterSalesAmount] = useState('');
  const [afterSalesNote, setAfterSalesNote] = useState('');

  const params: Record<string, string> = { page: String(page), per_page: '20' };
  if (statusFilter) params.status = statusFilter;
  if (search) params.search = search;

  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['admin-orders', params],
    queryFn: () => adminApi.orders.list(params),
  });

  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ['admin-order-detail', selectedOrderId],
    queryFn: () => adminApi.orders.detail(selectedOrderId!),
    enabled: !!selectedOrderId,
  });

  const statusMutation = useMutation({
    mutationFn: (body: { to_status: string; tracking_number?: string; note?: string }) =>
      adminApi.orders.updateStatus(selectedOrderId!, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      queryClient.invalidateQueries({ queryKey: ['admin-order-detail', selectedOrderId] });
      setShowStatusModal(false);
      setNewStatus('');
      setTrackingNumber('');
      setStatusNote('');
    },
  });

  const slipMutation = useMutation({
    mutationFn: (body: { slip_id: string; verified: boolean; note?: string }) =>
      adminApi.orders.verifySlip(selectedOrderId!, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      queryClient.invalidateQueries({ queryKey: ['admin-order-detail', selectedOrderId] });
      setShowSlipModal(false);
    },
  });

  const afterSalesMutation = useMutation({
    mutationFn: (body: { event_type: string; amount: number; note?: string }) =>
      adminApi.orders.afterSales(selectedOrderId!, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-order-detail', selectedOrderId] });
      setShowAfterSalesModal(false);
      setAfterSalesType('');
      setAfterSalesAmount('');
      setAfterSalesNote('');
    },
  });

  const orders = listData?.data ?? [];
  const meta = listData?.meta;
  const orderDetail = detailData?.data;

  // Detail View
  if (selectedOrderId) {
    return (
      <div>
        <button
          onClick={() => setSelectedOrderId(null)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary mb-4"
        >
          <ChevronLeft className="h-4 w-4" /> {t('orders.backToList')}
        </button>

        {detailLoading ? (
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-48 bg-muted rounded" />
            <div className="h-32 bg-muted rounded" />
          </div>
        ) : orderDetail ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold">{orderDetail.order_number}</h1>
                <span className={`inline-block mt-1 text-xs px-2 py-1 rounded-full ${STATUS_COLORS[orderDetail.status] ?? 'bg-gray-100'}`}>
                  {t(`orders.statusLabel.${orderDetail.status}`)}
                </span>
              </div>
              <div className="flex gap-2">
                {STATUS_TRANSITIONS[orderDetail.status]?.length > 0 && (
                  <Button size="sm" onClick={() => setShowStatusModal(true)}>
                    {t('orders.changeStatus')}
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setShowAfterSalesModal(true)}>
                  {t('orders.afterSales')}
                </Button>
              </div>
            </div>

            {/* Customer Info */}
            <div className="rounded-lg border p-4">
              <h3 className="font-semibold mb-2">{t('orders.customer')}</h3>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">{t('customers.name')}</span>
                  <p className="font-medium">{orderDetail.customer.name}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('customers.email')}</span>
                  <p className="font-medium">{orderDetail.customer.email}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('orders.phone')}</span>
                  <p className="font-medium">{orderDetail.customer.phone}</p>
                </div>
              </div>
            </div>

            {/* Items */}
            <div className="rounded-lg border">
              <div className="p-4 border-b">
                <h3 className="font-semibold">{t('orders.items')}</h3>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50 text-xs">
                    <th className="text-left p-3">{t('products.name')}</th>
                    <th className="text-left p-3">SKU</th>
                    <th className="text-left p-3">{t('orders.rentalDays')}</th>
                    <th className="text-right p-3">{t('orders.subtotal')}</th>
                    <th className="text-right p-3">{t('orders.lateFee')}</th>
                    <th className="text-right p-3">{t('orders.damageFee')}</th>
                  </tr>
                </thead>
                <tbody>
                  {orderDetail.items.map((item) => (
                    <tr key={item.id} className="border-b text-sm">
                      <td className="p-3">{item.product_name}</td>
                      <td className="p-3 font-mono text-xs">{item.sku}</td>
                      <td className="p-3">{item.rental_days}d</td>
                      <td className="p-3 text-right">{item.subtotal.toLocaleString()}</td>
                      <td className="p-3 text-right">{item.late_fee > 0 ? item.late_fee.toLocaleString() : '-'}</td>
                      <td className="p-3 text-right">{item.damage_fee > 0 ? item.damage_fee.toLocaleString() : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Payment Slips */}
            {orderDetail.payment_slips.length > 0 && (
              <div className="rounded-lg border">
                <div className="p-4 border-b">
                  <h3 className="font-semibold">{t('orders.paymentSlips')}</h3>
                </div>
                <div className="divide-y">
                  {orderDetail.payment_slips.map((slip) => (
                    <div key={slip.id} className="flex items-center justify-between p-4">
                      <div>
                        <p className="text-sm font-medium">{slip.declared_amount.toLocaleString()} THB</p>
                        <p className="text-xs text-muted-foreground">{slip.bank_name} &bull; {new Date(slip.created_at).toLocaleString()}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          slip.verification_status === 'verified' ? 'bg-green-100 text-green-700' :
                          slip.verification_status === 'rejected' ? 'bg-red-100 text-red-700' :
                          'bg-yellow-100 text-yellow-700'
                        }`}>
                          {slip.verification_status}
                        </span>
                        {slip.verification_status === 'pending' && (
                          <Button size="sm" variant="outline" onClick={() => {
                            setSelectedSlipId(slip.id);
                            setShowSlipModal(true);
                          }}>
                            {t('orders.verify')}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Status Log */}
            {orderDetail.status_log.length > 0 && (
              <div className="rounded-lg border">
                <div className="p-4 border-b">
                  <h3 className="font-semibold">{t('orders.statusHistory')}</h3>
                </div>
                <div className="divide-y">
                  {orderDetail.status_log.map((log, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 text-sm">
                      <div>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_COLORS[log.from_status] ?? ''}`}>{log.from_status}</span>
                        <span className="mx-2 text-muted-foreground">&rarr;</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_COLORS[log.to_status] ?? ''}`}>{log.to_status}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{new Date(log.created_at).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Summary */}
            <div className="rounded-lg border p-4 max-w-sm ml-auto">
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span>{t('orders.subtotal')}</span><span>{orderDetail.total_amount.toLocaleString()}</span></div>
                <div className="flex justify-between"><span>{t('orders.deposit')}</span><span>{orderDetail.deposit_total.toLocaleString()}</span></div>
                <div className="flex justify-between"><span>{t('orders.deliveryFee')}</span><span>{orderDetail.delivery_fee.toLocaleString()}</span></div>
                <div className="flex justify-between font-semibold border-t pt-1">
                  <span>{t('orders.total')}</span>
                  <span>{(orderDetail.total_amount + orderDetail.deposit_total + orderDetail.delivery_fee).toLocaleString()} THB</span>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Status Change Modal */}
        {showStatusModal && orderDetail && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-background rounded-lg p-6 w-full max-w-md">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">{t('orders.changeStatus')}</h3>
                <button onClick={() => setShowStatusModal(false)}><X className="h-4 w-4" /></button>
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
                    {(STATUS_TRANSITIONS[orderDetail.status] ?? []).map((s) => (
                      <option key={s} value={s}>{t(`orders.statusLabel.${s}`)}</option>
                    ))}
                  </select>
                </div>
                {newStatus === 'shipped' && (
                  <div>
                    <label className="text-sm font-medium">{t('orders.trackingNumber')}</label>
                    <Input value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} />
                  </div>
                )}
                <div>
                  <label className="text-sm font-medium">{t('orders.note')}</label>
                  <Input value={statusNote} onChange={(e) => setStatusNote(e.target.value)} />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowStatusModal(false)}>{t('common.cancel')}</Button>
                  <Button
                    onClick={() => statusMutation.mutate({ to_status: newStatus, tracking_number: trackingNumber || undefined, note: statusNote || undefined })}
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

        {/* Slip Verify Modal */}
        {showSlipModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-background rounded-lg p-6 w-full max-w-md">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">{t('orders.verifySlip')}</h3>
                <button onClick={() => setShowSlipModal(false)}><X className="h-4 w-4" /></button>
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
                  <Button variant="outline" onClick={() => setShowSlipModal(false)}>{t('common.cancel')}</Button>
                  <Button
                    onClick={() => slipMutation.mutate({ slip_id: selectedSlipId, verified: slipVerified, note: slipNote || undefined })}
                    disabled={slipMutation.isPending}
                  >
                    {slipMutation.isPending ? t('common.loading') : t('common.save')}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* After-Sales Modal */}
        {showAfterSalesModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-background rounded-lg p-6 w-full max-w-md">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">{t('orders.afterSales')}</h3>
                <button onClick={() => setShowAfterSalesModal(false)}><X className="h-4 w-4" /></button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">{t('orders.eventType')}</label>
                  <select
                    value={afterSalesType}
                    onChange={(e) => setAfterSalesType(e.target.value)}
                    className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">{t('orders.selectType')}</option>
                    {AFTER_SALES_TYPES.map((type) => (
                      <option key={type} value={type}>{t(`orders.afterSalesType.${type}`)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium">{t('orders.amount')}</label>
                  <Input type="number" value={afterSalesAmount} onChange={(e) => setAfterSalesAmount(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-medium">{t('orders.note')}</label>
                  <Input value={afterSalesNote} onChange={(e) => setAfterSalesNote(e.target.value)} />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowAfterSalesModal(false)}>{t('common.cancel')}</Button>
                  <Button
                    onClick={() => afterSalesMutation.mutate({
                      event_type: afterSalesType,
                      amount: Number(afterSalesAmount),
                      note: afterSalesNote || undefined,
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

  // List View
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t('orders.title')}</h1>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('orders.searchPlaceholder')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">{t('orders.allStatuses')}</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>{t(`orders.statusLabel.${s}`)}</option>
          ))}
        </select>
      </div>

      <div className="rounded-lg border">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-4 text-sm font-medium">{t('orders.orderNumber')}</th>
              <th className="text-left p-4 text-sm font-medium">{t('orders.customer')}</th>
              <th className="text-left p-4 text-sm font-medium">{t('orders.status')}</th>
              <th className="text-right p-4 text-sm font-medium">{t('orders.total')}</th>
              <th className="text-left p-4 text-sm font-medium">{t('orders.date')}</th>
            </tr>
          </thead>
          <tbody>
            {listLoading ? (
              <tr>
                <td colSpan={5} className="p-8 text-center text-muted-foreground">
                  {t('common.loading')}
                </td>
              </tr>
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-8 text-center text-muted-foreground">
                  {t('orders.empty')}
                </td>
              </tr>
            ) : (
              orders.map((order) => (
                <tr
                  key={order.id}
                  className="border-b hover:bg-muted/30 cursor-pointer"
                  onClick={() => setSelectedOrderId(order.id)}
                >
                  <td className="p-4 font-mono text-sm">{order.order_number}</td>
                  <td className="p-4 text-sm">
                    <div>{order.customer_name}</div>
                    <div className="text-xs text-muted-foreground">{order.customer_phone}</div>
                  </td>
                  <td className="p-4">
                    <span className={`text-xs px-2 py-1 rounded-full ${STATUS_COLORS[order.status] ?? 'bg-gray-100'}`}>
                      {t(`orders.statusLabel.${order.status}`)}
                    </span>
                  </td>
                  <td className="p-4 text-sm text-right">{order.total_amount.toLocaleString()} THB</td>
                  <td className="p-4 text-sm text-muted-foreground">{new Date(order.created_at).toLocaleDateString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

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
  );
}
