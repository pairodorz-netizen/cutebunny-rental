import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export function FinancePage() {
  const { t } = useTranslation();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [groupBy, setGroupBy] = useState('category');

  const params: Record<string, string> = {
    year: String(year),
    month: String(month),
    group_by: groupBy,
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-finance', params],
    queryFn: () => adminApi.finance.report(params),
  });

  const report = data?.data;

  const chartData = report?.groups.map((g) => ({
    name: g.label || g.key,
    revenue: g.revenue,
    expenses: g.expenses,
    margin: g.gross_margin,
  })) ?? [];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t('finance.title')}</h1>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 mb-6">
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {new Date(2024, m - 1).toLocaleString('default', { month: 'long' })}
            </option>
          ))}
        </select>
        <div className="flex rounded-md border border-input overflow-hidden">
          {['category', 'product', 'month'].map((g) => (
            <button
              key={g}
              onClick={() => setGroupBy(g)}
              className={`px-3 py-2 text-sm ${groupBy === g ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}
            >
              {t(`finance.groupBy.${g}`)}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          {t('common.loading')}
        </div>
      ) : isError || !report ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          {t('finance.error')}
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">{t('finance.totalRevenue')}</p>
              <p className="text-xl font-bold text-green-600">{report.totals.revenue.toLocaleString()} THB</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">{t('finance.totalExpenses')}</p>
              <p className="text-xl font-bold text-red-600">{report.totals.expenses.toLocaleString()} THB</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">{t('finance.grossMargin')}</p>
              <p className="text-xl font-bold">{report.totals.gross_margin.toLocaleString()} THB</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">{t('finance.marginPct')}</p>
              <p className="text-xl font-bold">{report.totals.gross_margin_pct.toFixed(1)}%</p>
            </div>
          </div>

          {/* Chart */}
          {chartData.length > 0 && (
            <div className="rounded-lg border p-4 mb-8">
              <h2 className="font-semibold mb-4">{t('finance.revenueExpenses')}</h2>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="revenue" fill="#22c55e" name={t('finance.revenue')} />
                  <Bar dataKey="expenses" fill="#ef4444" name={t('finance.expenses')} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Detail Table (ROI) */}
          <div className="rounded-lg border">
            <div className="p-4 border-b">
              <h2 className="font-semibold">{t('finance.breakdown')}</h2>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 text-sm font-medium">{t('finance.group')}</th>
                  <th className="text-right p-3 text-sm font-medium">{t('finance.revenue')}</th>
                  <th className="text-right p-3 text-sm font-medium">{t('finance.expenses')}</th>
                  <th className="text-right p-3 text-sm font-medium">{t('finance.grossMargin')}</th>
                  <th className="text-right p-3 text-sm font-medium">{t('finance.marginPct')}</th>
                </tr>
              </thead>
              <tbody>
                {report.groups.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-muted-foreground">{t('finance.noData')}</td>
                  </tr>
                ) : (
                  <>
                    {report.groups.map((g) => (
                      <tr key={g.key} className="border-b">
                        <td className="p-3 text-sm font-medium">{g.label || g.key}</td>
                        <td className="p-3 text-sm text-right text-green-600">{g.revenue.toLocaleString()}</td>
                        <td className="p-3 text-sm text-right text-red-600">{g.expenses.toLocaleString()}</td>
                        <td className="p-3 text-sm text-right font-medium">{g.gross_margin.toLocaleString()}</td>
                        <td className="p-3 text-sm text-right">{g.gross_margin_pct.toFixed(1)}%</td>
                      </tr>
                    ))}
                    <tr className="bg-muted/30 font-semibold">
                      <td className="p-3 text-sm">{t('finance.total')}</td>
                      <td className="p-3 text-sm text-right text-green-600">{report.totals.revenue.toLocaleString()}</td>
                      <td className="p-3 text-sm text-right text-red-600">{report.totals.expenses.toLocaleString()}</td>
                      <td className="p-3 text-sm text-right">{report.totals.gross_margin.toLocaleString()}</td>
                      <td className="p-3 text-sm text-right">{report.totals.gross_margin_pct.toFixed(1)}%</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
