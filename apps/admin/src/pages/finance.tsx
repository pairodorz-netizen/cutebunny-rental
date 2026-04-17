import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { DollarSign, TrendingUp, TrendingDown, Download, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { useState } from 'react';

type Tab = 'summary' | 'transactions' | 'categories' | 'roi';

export function FinancePage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('summary');
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('monthly');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [txType, setTxType] = useState<string>('');
  const [txPage, setTxPage] = useState(1);

  const summaryQuery = useQuery({
    queryKey: ['finance-summary', period, startDate, endDate],
    queryFn: () => adminApi.finance.summary({ period, start_date: startDate, end_date: endDate }),
  });

  const txQuery = useQuery({
    queryKey: ['finance-transactions', startDate, endDate, txType, txPage],
    queryFn: () => adminApi.finance.transactions({
      start_date: startDate,
      end_date: endDate,
      ...(txType ? { type: txType } : {}),
      page: String(txPage),
      per_page: '20',
    }),
    enabled: activeTab === 'transactions',
  });

  const categoriesQuery = useQuery({
    queryKey: ['finance-categories'],
    queryFn: () => adminApi.finance.categories(),
    enabled: activeTab === 'categories',
  });

  const roiQuery = useQuery({
    queryKey: ['products-roi-summary'],
    queryFn: () => adminApi.products.roiSummary(),
    enabled: activeTab === 'roi',
  });

  const roiData = roiQuery.data?.data;

  const summary = summaryQuery.data?.data;
  const txData = txQuery.data?.data;
  const categories = categoriesQuery.data?.data;

  const handleExportCsv = () => {
    const url = adminApi.finance.exportCsv({ period, start_date: startDate, end_date: endDate });
    window.open(url, '_blank');
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('finance.title')}</h1>
        <button
          onClick={handleExportCsv}
          className="flex items-center gap-2 px-3 py-2 text-sm rounded-md border hover:bg-muted transition-colors"
        >
          <Download className="h-4 w-4" />
          {t('finance.exportCsv')}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted rounded-lg p-1 mb-6 w-fit">
        {(['summary', 'transactions', 'categories', 'roi'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              activeTab === tab ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t(`finance.tab_${tab}`)}
          </button>
        ))}
      </div>

      {/* Date Range & Period Controls */}
      {activeTab !== 'categories' && (
        <div className="flex flex-wrap gap-3 mb-6">
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">{t('finance.from')}</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-2 py-1.5 text-sm border rounded-md bg-background"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">{t('finance.to')}</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-2 py-1.5 text-sm border rounded-md bg-background"
            />
          </div>
          {activeTab === 'summary' && (
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as 'daily' | 'weekly' | 'monthly')}
              className="px-2 py-1.5 text-sm border rounded-md bg-background"
            >
              <option value="daily">{t('finance.daily')}</option>
              <option value="weekly">{t('finance.weekly')}</option>
              <option value="monthly">{t('finance.monthly')}</option>
            </select>
          )}
          {activeTab === 'transactions' && (
            <select
              value={txType}
              onChange={(e) => { setTxType(e.target.value); setTxPage(1); }}
              className="px-2 py-1.5 text-sm border rounded-md bg-background"
            >
              <option value="">{t('finance.allTypes')}</option>
              <option value="REVENUE">{t('finance.revenue')}</option>
              <option value="EXPENSE">{t('finance.expense')}</option>
            </select>
          )}
        </div>
      )}

      {/* Summary Tab */}
      {activeTab === 'summary' && (
        <>
          {summaryQuery.isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="rounded-lg border bg-card p-6 animate-pulse">
                  <div className="h-4 w-24 bg-muted rounded mb-2" />
                  <div className="h-8 w-16 bg-muted rounded" />
                </div>
              ))}
            </div>
          ) : summary ? (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="rounded-lg border bg-card p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-muted-foreground">{t('finance.totalRevenue')}</span>
                    <ArrowUpRight className="h-4 w-4 text-green-500" />
                  </div>
                  <p className="text-xl font-bold text-green-600">{summary.totals.total_revenue.toLocaleString()} <span className="text-sm font-normal">THB</span></p>
                </div>
                <div className="rounded-lg border bg-card p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-muted-foreground">{t('finance.totalExpenses')}</span>
                    <ArrowDownRight className="h-4 w-4 text-red-500" />
                  </div>
                  <p className="text-xl font-bold text-red-600">{summary.totals.total_expenses.toLocaleString()} <span className="text-sm font-normal">THB</span></p>
                </div>
                <div className="rounded-lg border bg-card p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-muted-foreground">{t('finance.netProfit')}</span>
                    <DollarSign className="h-4 w-4 text-emerald-500" />
                  </div>
                  <p className={`text-xl font-bold ${summary.totals.net_profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {summary.totals.net_profit.toLocaleString()} <span className="text-sm font-normal">THB</span>
                  </p>
                </div>
                <div className="rounded-lg border bg-card p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-muted-foreground">{t('finance.totalOrders')}</span>
                    <TrendingUp className="h-4 w-4 text-blue-500" />
                  </div>
                  <p className="text-xl font-bold">{summary.totals.total_orders}</p>
                </div>
              </div>

              {/* Period Breakdown */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <div className="rounded-lg border">
                  <div className="p-4 border-b">
                    <h3 className="font-semibold">{t('finance.periodBreakdown')}</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left p-3 text-xs font-medium text-muted-foreground">{t('finance.period')}</th>
                          <th className="text-right p-3 text-xs font-medium text-muted-foreground">{t('finance.revenue')}</th>
                          <th className="text-right p-3 text-xs font-medium text-muted-foreground">{t('finance.expenses')}</th>
                          <th className="text-right p-3 text-xs font-medium text-muted-foreground">{t('finance.profit')}</th>
                          <th className="text-right p-3 text-xs font-medium text-muted-foreground">{t('finance.orders')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {summary.periods.map((p) => (
                          <tr key={p.period_label} className="hover:bg-muted/30">
                            <td className="p-3 text-sm font-medium">{p.period_label}</td>
                            <td className="p-3 text-sm text-right text-green-600">{p.total_revenue.toLocaleString()}</td>
                            <td className="p-3 text-sm text-right text-red-600">{p.total_expenses.toLocaleString()}</td>
                            <td className={`p-3 text-sm text-right font-medium ${p.net_profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {p.net_profit.toLocaleString()}
                            </td>
                            <td className="p-3 text-sm text-right">{p.order_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Category Breakdown */}
                <div className="rounded-lg border">
                  <div className="p-4 border-b">
                    <h3 className="font-semibold">{t('finance.categoryBreakdown')}</h3>
                  </div>
                  <div className="divide-y">
                    {summary.by_category.length === 0 ? (
                      <div className="p-4 text-center text-muted-foreground text-sm">{t('finance.noData')}</div>
                    ) : (
                      summary.by_category.map((cat) => (
                        <div key={cat.category_name} className="flex items-center justify-between p-3">
                          <div className="flex items-center gap-2">
                            {cat.category_type === 'REVENUE' ? (
                              <TrendingUp className="h-3.5 w-3.5 text-green-500" />
                            ) : (
                              <TrendingDown className="h-3.5 w-3.5 text-red-500" />
                            )}
                            <span className="text-sm">{cat.category_name.replace(/_/g, ' ')}</span>
                          </div>
                          <span className={`text-sm font-medium ${cat.category_type === 'REVENUE' ? 'text-green-600' : 'text-red-600'}`}>
                            {cat.total.toLocaleString()} THB
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Top Products */}
              <div className="rounded-lg border">
                <div className="p-4 border-b">
                  <h3 className="font-semibold">{t('finance.topProducts')}</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">#</th>
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">{t('finance.productName')}</th>
                        <th className="text-right p-3 text-xs font-medium text-muted-foreground">{t('finance.revenue')}</th>
                        <th className="text-right p-3 text-xs font-medium text-muted-foreground">{t('finance.rentalCount')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {summary.top_products.map((p, idx) => (
                        <tr key={p.product_id} className="hover:bg-muted/30">
                          <td className="p-3 text-sm text-muted-foreground">{idx + 1}</td>
                          <td className="p-3 text-sm font-medium">{p.product_name}</td>
                          <td className="p-3 text-sm text-right text-green-600">{p.revenue.toLocaleString()} THB</td>
                          <td className="p-3 text-sm text-right">{p.rental_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}
        </>
      )}

      {/* Transactions Tab */}
      {activeTab === 'transactions' && (
        <>
          {txQuery.isLoading ? (
            <div className="rounded-lg border p-8 text-center text-muted-foreground">{t('common.loading')}</div>
          ) : txData ? (
            <>
              <div className="rounded-lg border">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">{t('finance.date')}</th>
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">{t('finance.type')}</th>
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">{t('finance.category')}</th>
                        <th className="text-right p-3 text-xs font-medium text-muted-foreground">{t('finance.amount')}</th>
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">{t('finance.orderNum')}</th>
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">{t('finance.note')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {txData.data.map((tx) => (
                        <tr key={tx.id} className="hover:bg-muted/30">
                          <td className="p-3 text-sm">{new Date(tx.created_at).toLocaleDateString()}</td>
                          <td className="p-3 text-sm">{tx.tx_type.replace(/_/g, ' ')}</td>
                          <td className="p-3 text-sm">{tx.category_name ?? '-'}</td>
                          <td className={`p-3 text-sm text-right font-medium ${tx.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {tx.amount >= 0 ? '+' : ''}{tx.amount.toLocaleString()} THB
                          </td>
                          <td className="p-3 text-sm font-mono">{tx.order_number ?? '-'}</td>
                          <td className="p-3 text-sm text-muted-foreground max-w-[200px] truncate">{tx.note ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {/* Pagination */}
              {txData.meta.total_pages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <span className="text-sm text-muted-foreground">
                    {t('finance.showing')} {(txData.meta.page - 1) * txData.meta.per_page + 1}-{Math.min(txData.meta.page * txData.meta.per_page, txData.meta.total)} {t('finance.of')} {txData.meta.total}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setTxPage((p) => Math.max(1, p - 1))}
                      disabled={txPage === 1}
                      className="px-3 py-1.5 text-sm border rounded-md disabled:opacity-50"
                    >
                      {t('finance.prev')}
                    </button>
                    <button
                      onClick={() => setTxPage((p) => Math.min(txData.meta.total_pages, p + 1))}
                      disabled={txPage >= txData.meta.total_pages}
                      className="px-3 py-1.5 text-sm border rounded-md disabled:opacity-50"
                    >
                      {t('finance.next')}
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </>
      )}

      {/* ROI Rankings Tab */}
      {activeTab === 'roi' && (
        <>
          {roiQuery.isLoading ? (
            <div className="rounded-lg border p-8 text-center text-muted-foreground">{t('common.loading')}</div>
          ) : roiData && roiData.length > 0 ? (
            <div className="space-y-6">
              {/* Revenue Trend Mini-Chart (CSS bars) */}
              {summary && summary.periods.length > 1 && (
                <div className="rounded-lg border">
                  <div className="p-4 border-b">
                    <h3 className="font-semibold">{t('finance.revenueTrend')}</h3>
                  </div>
                  <div className="p-4">
                    <div className="flex items-end gap-1 h-32">
                      {(() => {
                        const maxVal = Math.max(...summary.periods.map((p) => Math.max(p.total_revenue, p.total_expenses)), 1);
                        return summary.periods.slice(-12).map((p) => (
                          <div key={p.period_label} className="flex-1 flex flex-col items-center gap-0.5 min-w-0">
                            <div className="w-full flex gap-px justify-center" style={{ height: '100px' }}>
                              <div
                                className="bg-green-500 rounded-t-sm flex-1 max-w-3 self-end"
                                style={{ height: `${(p.total_revenue / maxVal) * 100}%` }}
                                title={`${t('finance.revenue')}: ${p.total_revenue.toLocaleString()}`}
                              />
                              <div
                                className="bg-red-400 rounded-t-sm flex-1 max-w-3 self-end"
                                style={{ height: `${(p.total_expenses / maxVal) * 100}%` }}
                                title={`${t('finance.expenses')}: ${p.total_expenses.toLocaleString()}`}
                              />
                            </div>
                            <span className="text-[8px] text-muted-foreground truncate w-full text-center">
                              {p.period_label.slice(-5)}
                            </span>
                          </div>
                        ));
                      })()}
                    </div>
                    <div className="flex items-center justify-center gap-4 mt-2">
                      <div className="flex items-center gap-1">
                        <div className="w-2.5 h-2.5 bg-green-500 rounded-sm" />
                        <span className="text-xs text-muted-foreground">{t('finance.revenue')}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-2.5 h-2.5 bg-red-400 rounded-sm" />
                        <span className="text-xs text-muted-foreground">{t('finance.expenses')}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ROI Rankings Table */}
              <div className="rounded-lg border">
                <div className="p-4 border-b">
                  <h3 className="font-semibold">{t('finance.roiRankings')}</h3>
                  <p className="text-xs text-muted-foreground mt-1">{t('finance.roiRankingsDesc')}</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">#</th>
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">{t('finance.productName')}</th>
                        <th className="text-right p-3 text-xs font-medium text-muted-foreground">{t('finance.purchaseCost')}</th>
                        <th className="text-right p-3 text-xs font-medium text-muted-foreground">{t('finance.totalRevenue')}</th>
                        <th className="text-right p-3 text-xs font-medium text-muted-foreground">{t('finance.totalExpenses')}</th>
                        <th className="text-right p-3 text-xs font-medium text-muted-foreground">{t('finance.netProfitLabel')}</th>
                        <th className="text-right p-3 text-xs font-medium text-muted-foreground">{t('finance.roiPercent')}</th>
                        <th className="text-right p-3 text-xs font-medium text-muted-foreground">{t('finance.totalRentals')}</th>
                        <th className="text-right p-3 text-xs font-medium text-muted-foreground">{t('finance.breakEven')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {roiData.map((p, idx) => (
                        <tr key={p.product_id} className="hover:bg-muted/30">
                          <td className="p-3 text-sm text-muted-foreground">{idx + 1}</td>
                          <td className="p-3 text-sm">
                            <div className="font-medium">{p.product_name}</div>
                            <div className="text-xs text-muted-foreground font-mono">{p.sku}</div>
                          </td>
                          <td className="p-3 text-sm text-right">{p.purchase_cost.toLocaleString()}</td>
                          <td className="p-3 text-sm text-right text-green-600">{p.total_revenue.toLocaleString()}</td>
                          <td className="p-3 text-sm text-right text-red-600">{p.total_expenses.toLocaleString()}</td>
                          <td className={`p-3 text-sm text-right font-medium ${p.net_profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {p.net_profit.toLocaleString()}
                          </td>
                          <td className="p-3 text-right">
                            <span className={`text-sm font-bold px-2 py-0.5 rounded ${
                              p.roi > 50 ? 'bg-green-100 text-green-700' :
                              p.roi > 0 ? 'bg-yellow-100 text-yellow-700' :
                              'bg-red-100 text-red-700'
                            }`}>
                              {p.roi.toFixed(1)}%
                            </span>
                          </td>
                          <td className="p-3 text-sm text-right">{p.total_rentals}</td>
                          <td className="p-3 text-sm text-right">
                            {p.break_even_rentals > 0 ? (
                              <span className={p.total_rentals >= p.break_even_rentals ? 'text-green-600' : 'text-orange-600'}>
                                {p.break_even_rentals} {p.total_rentals >= p.break_even_rentals ? '\u2713' : ''}
                              </span>
                            ) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border p-8 text-center text-muted-foreground">{t('finance.noData')}</div>
          )}
        </>
      )}

      {/* Categories Tab */}
      {activeTab === 'categories' && (
        <>
          {categoriesQuery.isLoading ? (
            <div className="rounded-lg border p-8 text-center text-muted-foreground">{t('common.loading')}</div>
          ) : categories ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Revenue Categories */}
              <div className="rounded-lg border">
                <div className="p-4 border-b flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-green-500" />
                  <h3 className="font-semibold">{t('finance.revenueCategories')}</h3>
                </div>
                <div className="divide-y">
                  {categories.filter((c) => c.type === 'REVENUE').map((cat) => (
                    <div key={cat.id} className="p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{cat.name.replace(/_/g, ' ')}</span>
                        <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">{t('finance.revenue')}</span>
                      </div>
                      {cat.description && (
                        <p className="text-xs text-muted-foreground mt-1">{cat.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Expense Categories */}
              <div className="rounded-lg border">
                <div className="p-4 border-b flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-red-500" />
                  <h3 className="font-semibold">{t('finance.expenseCategories')}</h3>
                </div>
                <div className="divide-y">
                  {categories.filter((c) => c.type === 'EXPENSE').map((cat) => (
                    <div key={cat.id} className="p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{cat.name.replace(/_/g, ' ')}</span>
                        <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded-full">{t('finance.expense')}</span>
                      </div>
                      {cat.description && (
                        <p className="text-xs text-muted-foreground mt-1">{cat.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
