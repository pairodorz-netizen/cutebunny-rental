import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/auth-store';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Users,
  Calendar,
  DollarSign,
  Settings,
  LogOut,
} from 'lucide-react';

const navItems = [
  { path: '/', icon: LayoutDashboard, labelKey: 'sidebar.dashboard' },
  { path: '/orders', icon: ShoppingCart, labelKey: 'sidebar.orders' },
  { path: '/products', icon: Package, labelKey: 'sidebar.products' },
  { path: '/customers', icon: Users, labelKey: 'sidebar.customers' },
  { path: '/calendar', icon: Calendar, labelKey: 'sidebar.calendar' },
  { path: '/finance', icon: DollarSign, labelKey: 'sidebar.finance' },
  { path: '/settings', icon: Settings, labelKey: 'sidebar.settings' },
];

export function Sidebar() {
  const { t } = useTranslation();
  const logout = useAuthStore((s) => s.logout);

  return (
    <aside className="w-64 border-r bg-sidebar min-h-screen flex flex-col">
      <div className="p-6 border-b">
        <h1 className="text-xl font-bold text-primary">CuteBunny</h1>
        <p className="text-xs text-sidebar-foreground/60 mt-1">{t('common.appName')}</p>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent/50'
              }`
            }
          >
            <item.icon className="h-4 w-4" />
            {t(item.labelKey)}
          </NavLink>
        ))}
      </nav>
      <div className="p-4 border-t">
        <button
          onClick={logout}
          className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors w-full"
        >
          <LogOut className="h-4 w-4" />
          {t('sidebar.logout')}
        </button>
      </div>
    </aside>
  );
}
