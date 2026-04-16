import { useTranslation } from 'react-i18next';
import { ShoppingCart, DollarSign, Package, Users } from 'lucide-react';

export function DashboardPage() {
  const { t } = useTranslation();

  const stats = [
    { labelKey: 'dashboard.totalOrders', value: '0', icon: ShoppingCart },
    { labelKey: 'dashboard.totalRevenue', value: '0 THB', icon: DollarSign },
    { labelKey: 'dashboard.activeRentals', value: '0', icon: Package },
    { labelKey: 'dashboard.newCustomers', value: '0', icon: Users },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t('dashboard.title')}</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div key={stat.labelKey} className="rounded-lg border bg-card p-6">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{t(stat.labelKey)}</span>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold mt-2">{stat.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
