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
  Truck,
  Settings,
  LogOut,
  X,
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

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const { t } = useTranslation();
  const logout = useAuthStore((s) => s.logout);

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-64 border-r bg-sidebar flex flex-col
          transform transition-transform duration-200 ease-in-out
          md:relative md:translate-x-0
          ${open ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className="p-4 sm:p-6 border-b flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-primary">CuteBunny</h1>
            <p className="text-xs text-sidebar-foreground/60 mt-1">{t('common.appName')}</p>
          </div>
          <button
            onClick={onClose}
            className="md:hidden p-1.5 hover:bg-sidebar-accent rounded-md transition-colors"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 p-3 sm:p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              onClick={onClose}
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
        <div className="p-3 sm:p-4 border-t">
          <button
            onClick={logout}
            className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors w-full"
          >
            <LogOut className="h-4 w-4" />
            {t('sidebar.logout')}
          </button>
        </div>
      </aside>
    </>
  );
}
