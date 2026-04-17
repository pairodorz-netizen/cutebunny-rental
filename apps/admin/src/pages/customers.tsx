import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, ChevronLeft, User, Mail, Phone, CreditCard, PlusCircle } from 'lucide-react';

const TIER_COLORS: Record<string, string> = {
  bronze: 'bg-orange-100 text-orange-800',
  silver: 'bg-gray-200 text-gray-800',
  gold: 'bg-yellow-100 text-yellow-800',
  platinum: 'bg-purple-100 text-purple-800',
};

export function CustomersPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Credit adjustment modal state
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [creditAmount, setCreditAmount] = useState('');
  const [creditReason, setCreditReason] = useState('');
  const [creditError, setCreditError] = useState<string | null>(null);
  const [creditSuccess, setCreditSuccess] = useState<string | null>(null);

  const params: Record<string, string> = { page: String(page), per_page: '20' };
  if (search) params.search = search;
  if (tierFilter) params.tier = tierFilter;

  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['admin-customers', params],
    queryFn: () => adminApi.customers.list(params),
  });

  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ['admin-customer-detail', selectedId],
    queryFn: () => adminApi.customers.detail(selectedId!),
    enabled: !!selectedId,
  });

  const creditMutation = useMutation({
    mutationFn: ({ id, amount, reason }: { id: string; amount: number; reason: string }) =>
      adminApi.customers.adjustCredit(id, { amount, reason }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['admin-customer-detail', selectedId] });
      queryClient.invalidateQueries({ queryKey: ['admin-customers'] });
      setCreditSuccess(`Credit adjusted: ${result.data.previous_balance} → ${result.data.new_balance} THB`);
      setCreditError(null);
      setCreditAmount('');
      setCreditReason('');
      setTimeout(() => { setShowCreditModal(false); setCreditSuccess(null); }, 2000);
    },
    onError: (err: Error) => {
      setCreditError(err.message);
      setCreditSuccess(null);
    },
  });

  const customers = listData?.data ?? [];
  const meta = listData?.meta;
  const customer = detailData?.data;

  // Detail View
  if (selectedId) {
    return (
      <div>
        <button
          onClick={() => setSelectedId(null)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary mb-4"
        >
          <ChevronLeft className="h-4 w-4" /> {t('customers.backToList')}
        </button>

        {detailLoading ? (
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-48 bg-muted rounded" />
            <div className="h-32 bg-muted rounded" />
          </div>
        ) : customer ? (
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="h-8 w-8 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">{customer.name}</h1>
                <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${TIER_COLORS[customer.tier] ?? 'bg-gray-100'}`}>
                  {customer.tier}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <Mail className="h-4 w-4" /> {t('customers.email')}
                </div>
                <p className="font-medium">{customer.email}</p>
              </div>
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <Phone className="h-4 w-4" /> {t('customers.phone')}
                </div>
                <p className="font-medium">{customer.phone}</p>
              </div>
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <CreditCard className="h-4 w-4" /> {t('customers.credit')}
                </div>
                <p className="font-medium">{customer.credit_balance.toLocaleString()} THB</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 h-7 text-xs"
                  onClick={() => { setShowCreditModal(true); setCreditError(null); setCreditSuccess(null); setCreditAmount(''); setCreditReason(''); }}
                >
                  <PlusCircle className="h-3 w-3 mr-1" /> {t('customers.adjustCredit')}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg border p-4 text-center">
                <p className="text-2xl font-bold">{customer.rental_count}</p>
                <p className="text-xs text-muted-foreground">{t('customers.totalRentals')}</p>
              </div>
              <div className="rounded-lg border p-4 text-center">
                <p className="text-2xl font-bold">{customer.total_payment.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">{t('customers.totalPayment')}</p>
              </div>
              <div className="rounded-lg border p-4 text-center">
                <p className="text-2xl font-bold">{customer.rental_history?.length ?? 0}</p>
                <p className="text-xs text-muted-foreground">{t('customers.orders')}</p>
              </div>
            </div>

            {/* Documents */}
            {customer.documents && customer.documents.length > 0 && (
              <div className="rounded-lg border">
                <div className="p-4 border-b">
                  <h3 className="font-semibold">{t('customers.documents')}</h3>
                </div>
                <div className="divide-y">
                  {customer.documents.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between p-3">
                      <span className="text-sm">{doc.type}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        doc.verified ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {doc.verified ? 'verified' : 'pending'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Rental History */}
            {customer.rental_history && customer.rental_history.length > 0 && (
              <div className="rounded-lg border">
                <div className="p-4 border-b">
                  <h3 className="font-semibold">{t('customers.rentalHistory')}</h3>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50 text-xs">
                      <th className="text-left p-3">{t('orders.orderNumber')}</th>
                      <th className="text-left p-3">{t('orders.status')}</th>
                      <th className="text-right p-3">{t('orders.total')}</th>
                      <th className="text-left p-3">{t('orders.rentalPeriod')}</th>
                      <th className="text-left p-3">{t('orders.date')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customer.rental_history.map((order) => (
                      <tr key={order.id} className="border-b text-sm">
                        <td className="p-3 font-mono">{order.order_number}</td>
                        <td className="p-3">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-muted">{order.status}</span>
                        </td>
                        <td className="p-3 text-right">{order.total_amount.toLocaleString()} THB</td>
                        <td className="p-3 text-muted-foreground text-xs">{order.rental_period.start} ~ {order.rental_period.end}</td>
                        <td className="p-3 text-muted-foreground">{new Date(order.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {/* Credit Adjustment Modal */}
            {showCreditModal && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreditModal(false)}>
                <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
                  <h3 className="text-lg font-semibold mb-4">{t('customers.adjustCredit')}</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    {t('customers.currentBalance')}: <span className="font-semibold">{customer.credit_balance.toLocaleString()} THB</span>
                  </p>
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm font-medium">{t('customers.creditAmount')}</label>
                      <p className="text-xs text-muted-foreground mb-1">{t('customers.creditAmountHint')}</p>
                      <input
                        type="number"
                        value={creditAmount}
                        onChange={(e) => setCreditAmount(e.target.value)}
                        className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                        placeholder="e.g. 100 or -50"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">{t('customers.creditReason')}</label>
                      <textarea
                        value={creditReason}
                        onChange={(e) => setCreditReason(e.target.value)}
                        className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                        rows={2}
                        placeholder={t('customers.creditReasonPlaceholder')}
                      />
                    </div>
                    {creditError && (
                      <div className="p-2 rounded bg-destructive/10 text-destructive text-sm">{creditError}</div>
                    )}
                    {creditSuccess && (
                      <div className="p-2 rounded bg-green-50 text-green-700 text-sm">{creditSuccess}</div>
                    )}
                  </div>
                  <div className="flex justify-end gap-2 mt-4">
                    <Button variant="outline" size="sm" onClick={() => setShowCreditModal(false)}>{t('common.cancel')}</Button>
                    <Button
                      size="sm"
                      disabled={!creditAmount || !creditReason || creditMutation.isPending}
                      onClick={() => {
                        const amt = parseInt(creditAmount, 10);
                        if (isNaN(amt) || amt === 0) { setCreditError('Amount must be a non-zero integer'); return; }
                        creditMutation.mutate({ id: selectedId!, amount: amt, reason: creditReason });
                      }}
                    >
                      {creditMutation.isPending ? t('common.saving') : t('customers.submitAdjustment')}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  // List View
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t('customers.title')}</h1>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('customers.searchPlaceholder')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <select
          value={tierFilter}
          onChange={(e) => { setTierFilter(e.target.value); setPage(1); }}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">{t('customers.allTiers')}</option>
          {['bronze', 'silver', 'gold', 'platinum'].map((tier) => (
            <option key={tier} value={tier}>{tier}</option>
          ))}
        </select>
      </div>

      <div className="rounded-lg border">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-4 text-sm font-medium">{t('customers.name')}</th>
              <th className="text-left p-4 text-sm font-medium">{t('customers.email')}</th>
              <th className="text-left p-4 text-sm font-medium">{t('customers.tier')}</th>
              <th className="text-center p-4 text-sm font-medium">{t('customers.rentals')}</th>
              <th className="text-right p-4 text-sm font-medium">{t('customers.totalPayment')}</th>
              <th className="text-left p-4 text-sm font-medium">{t('customers.joined')}</th>
            </tr>
          </thead>
          <tbody>
            {listLoading ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">{t('common.loading')}</td>
              </tr>
            ) : customers.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">{t('customers.empty')}</td>
              </tr>
            ) : (
              customers.map((c) => (
                <tr
                  key={c.id}
                  className="border-b hover:bg-muted/30 cursor-pointer"
                  onClick={() => setSelectedId(c.id)}
                >
                  <td className="p-4 text-sm font-medium">{c.name}</td>
                  <td className="p-4 text-sm text-muted-foreground">{c.email}</td>
                  <td className="p-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${TIER_COLORS[c.tier] ?? 'bg-gray-100'}`}>
                      {c.tier}
                    </span>
                  </td>
                  <td className="p-4 text-sm text-center">{c.rental_count}</td>
                  <td className="p-4 text-sm text-right">{c.total_payment.toLocaleString()} THB</td>
                  <td className="p-4 text-sm text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {meta && meta.total_pages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}>
            {t('customers.prev')}
          </Button>
          <span className="text-sm text-muted-foreground">{page} / {meta.total_pages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage(Math.min(meta.total_pages, page + 1))} disabled={page >= meta.total_pages}>
            {t('customers.next')}
          </Button>
        </div>
      )}
    </div>
  );
}
