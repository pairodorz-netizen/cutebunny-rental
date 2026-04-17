import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ShoppingCart, DollarSign, Truck, AlertTriangle, Clock, TrendingUp } from 'lucide-react';
import { adminApi } from '@/lib/api';

export function DashboardPage() {
  const { t } = useTranslation();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => adminApi.dashboard.stats(),
    refetchInterval: 60000,
  });

  const stats = data?.data;

  if (isLoading) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">{t('dashboard.title')}</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-lg border bg-card p-6 animate-pulse">
              <div className="h-4 w-24 bg-muted rounded mb-2" />
              <div className="h-8 w-16 bg-muted rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isError || !stats) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">{t('dashboard.title')}</h1>
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          {t('dashboard.error')}
        </div>
      </div>
    );
  }

  const statCards = [
    { label: t('dashboard.ordersToday'), value: stats.orders_today, icon: ShoppingCart, color: 'text-blue-500' },
    { label: t('dashboard.pendingPayment'), value: stats.orders_pending_payment, icon: Clock, color: 'text-yellow-500' },
    { label: t('dashboard.shipped'), value: stats.orders_shipped, icon: Truck, color: 'text-green-500' },
    { label: t('dashboard.overdueReturns'), value: stats.overdue_returns, icon: AlertTriangle, color: 'text-red-500' },
    { label: t('dashboard.revenueMonth'), value: `${stats.revenue_this_month.toLocaleString()} THB`, icon: DollarSign, color: 'text-emerald-500' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t('dashboard.title')}</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        {statCards.map((stat) => (
          <div key={stat.label} className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">{stat.label}</span>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </div>
            <p className="text-xl font-bold">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Products */}
        <div className="rounded-lg border">
          <div className="p-4 border-b flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            <h2 className="font-semibold">{t('dashboard.topProducts')}</h2>
          </div>
          <div className="divide-y">
            {stats.top_products.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">{t('dashboard.noData')}</div>
            ) : (
              stats.top_products.map((product, idx) => (
                <div key={product.id} className="flex items-center justify-between p-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-5">{idx + 1}</span>
                    <span className="text-sm font-medium">{product.name}</span>
                  </div>
                  <span className="text-sm text-muted-foreground">{product.rental_count} {t('dashboard.rentals')}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Low Stock Alert */}
        <div className="rounded-lg border">
          <div className="p-4 border-b flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
            <h2 className="font-semibold">{t('dashboard.lowStock')}</h2>
          </div>
          <div className="divide-y">
            {stats.low_stock_alert.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">{t('dashboard.allGood')}</div>
            ) : (
              stats.low_stock_alert.map((product) => (
                <div key={product.id} className="flex items-center justify-between p-3">
                  <span className="text-sm font-medium">{product.name}</span>
                  <span className="text-sm text-yellow-600 font-medium">{product.available_count} {t('dashboard.available')}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
