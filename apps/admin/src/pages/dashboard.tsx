import { useTranslation } from 'react-i18next';
import { ShoppingCart, DollarSign, Truck, AlertTriangle, Clock, TrendingUp, Package, Users } from 'lucide-react';
import { useState } from 'react';
import { useDashboardSummary } from '@/lib/hooks/useDashboard';

const STATUS_COLORS: Record<string, string> = {
  unpaid: '#ef4444',
  paid_locked: '#3b82f6',
  shipped: '#f59e0b',
  returned: '#8b5cf6',
  cleaning: '#06b6d4',
  repair: '#f97316',
  ready: '#22c55e',
};

function SimpleBarChart({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data);
  const maxVal = Math.max(...entries.map(([, v]) => v), 1);

  return (
    <div className="flex items-end gap-2 h-40">
      {entries.map(([key, val]) => (
        <div key={key} className="flex flex-col items-center flex-1 min-w-0">
          <span className="text-xs font-medium mb-1">{val}</span>
          <div
            className="w-full rounded-t-sm min-h-[4px] transition-all"
            style={{
              height: `${Math.max((val / maxVal) * 120, 4)}px`,
              backgroundColor: STATUS_COLORS[key] ?? '#6b7280',
            }}
          />
          <span className="text-[10px] text-muted-foreground mt-1 truncate w-full text-center">
            {key.replace('_', ' ')}
          </span>
        </div>
      ))}
    </div>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'stats' | 'overview'>('stats');

  const summaryQuery = useDashboardSummary();
  const summary = summaryQuery.data?.data;
  const stats = summary?.stats;
  const overview = summary?.overview;
  const lowStockProducts = summary?.lowStock ?? [];

  if (summaryQuery.isLoading) {
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('dashboard.title')}</h1>
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          <button
            onClick={() => setActiveTab('stats')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              activeTab === 'stats' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('dashboard.quickStats')}
          </button>
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              activeTab === 'overview' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('dashboard.fullOverview')}
          </button>
        </div>
      </div>

      {activeTab === 'stats' && stats && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
            {[
              { label: t('dashboard.ordersToday'), value: stats.orders_today, icon: ShoppingCart, color: 'text-blue-500' },
              { label: t('dashboard.pendingPayment'), value: stats.orders_pending_payment, icon: Clock, color: 'text-yellow-500' },
              { label: t('dashboard.shipped'), value: stats.orders_shipped, icon: Truck, color: 'text-green-500' },
              { label: t('dashboard.overdueReturns'), value: stats.overdue_returns, icon: AlertTriangle, color: 'text-red-500' },
              { label: t('dashboard.revenueMonth'), value: `${stats.revenue_this_month.toLocaleString()} THB`, icon: DollarSign, color: 'text-emerald-500' },
            ].map((stat) => (
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

            {/* C2: Low Stock Widget */}
            <div className="rounded-lg border">
              <div className="p-4 border-b flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                <h2 className="font-semibold">{t('lowStockWidget.title')}</h2>
              </div>
              <div className="divide-y">
                {lowStockProducts.length === 0 ? (
                  <div className="p-4 text-center text-muted-foreground text-sm">{t('lowStockWidget.noItems')}</div>
                ) : (
                  lowStockProducts.map((product) => (
                    <div key={product.id} className="flex items-center justify-between p-3">
                      <div className="flex items-center gap-2">
                        {product.thumbnail_url && (
                          <img src={product.thumbnail_url} alt="" className="w-8 h-8 rounded object-cover" />
                        )}
                        <div>
                          <span className="text-sm font-medium">{product.name}</span>
                          <span className="text-xs text-muted-foreground ml-2">{product.sku}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={`text-sm font-bold ${product.stock_on_hand <= 0 ? 'text-red-600' : 'text-yellow-600'}`}>
                          {product.stock_on_hand}
                        </span>
                        <span className="text-xs text-muted-foreground"> / {product.low_stock_threshold}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {activeTab === 'overview' && overview && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">{t('dashboard.totalProducts')}</span>
                <Package className="h-4 w-4 text-blue-500" />
              </div>
              <p className="text-2xl font-bold">{overview.total_products}</p>
              <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
                <span className="text-green-600">{overview.products_available} {t('dashboard.available')}</span>
                <span className="text-yellow-600">{overview.products_rented} {t('dashboard.rented')}</span>
                <span className="text-blue-600">{overview.products_cleaning} {t('dashboard.cleaning')}</span>
              </div>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">{t('dashboard.totalOrders')}</span>
                <ShoppingCart className="h-4 w-4 text-purple-500" />
              </div>
              <p className="text-2xl font-bold">{overview.total_orders}</p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">{t('dashboard.totalRevenue')}</span>
                <DollarSign className="h-4 w-4 text-emerald-500" />
              </div>
              <p className="text-2xl font-bold">{overview.total_revenue.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">THB</span></p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">{t('dashboard.activeRentals')}</span>
                <Users className="h-4 w-4 text-orange-500" />
              </div>
              <p className="text-2xl font-bold">{overview.total_active_rentals}</p>
            </div>
          </div>

          {/* Orders by Status Chart */}
          <div className="rounded-lg border p-4 mb-6">
            <h3 className="font-semibold mb-4">{t('dashboard.ordersByStatus')}</h3>
            <SimpleBarChart data={overview.orders_by_status} />
          </div>

          {/* Recent Orders Table */}
          <div className="rounded-lg border">
            <div className="p-4 border-b">
              <h3 className="font-semibold">{t('dashboard.recentOrders')}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">{t('dashboard.orderNumber')}</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">{t('dashboard.customer')}</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">{t('dashboard.product')}</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">{t('dashboard.status')}</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground">{t('dashboard.amount')}</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">{t('dashboard.date')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {overview.recent_orders.map((order) => (
                    <tr key={order.id} className="hover:bg-muted/30">
                      <td className="p-3 text-sm font-mono">{order.order_number}</td>
                      <td className="p-3 text-sm">{order.customer_name}</td>
                      <td className="p-3 text-sm">{order.product_name}</td>
                      <td className="p-3">
                        <span
                          className="inline-block px-2 py-0.5 rounded-full text-xs font-medium text-white"
                          style={{ backgroundColor: STATUS_COLORS[order.status] ?? '#6b7280' }}
                        >
                          {order.status}
                        </span>
                      </td>
                      <td className="p-3 text-sm text-right font-medium">{order.total_amount.toLocaleString()} THB</td>
                      <td className="p-3 text-sm text-muted-foreground">{new Date(order.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
