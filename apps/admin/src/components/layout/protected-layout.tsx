import { Navigate, Outlet } from 'react-router-dom';
import { useState } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { Sidebar } from './sidebar';
import { LocaleSwitcher } from './locale-switcher';
import { useTranslation } from 'react-i18next';
import { Menu } from 'lucide-react';

export function ProtectedLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const { t } = useTranslation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 sm:h-16 border-b flex items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="md:hidden p-1.5 hover:bg-muted rounded-md transition-colors"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h2 className="text-sm text-muted-foreground hidden sm:block">
              {t('common.appName')}
            </h2>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <LocaleSwitcher />
            <span className="text-xs sm:text-sm text-muted-foreground truncate max-w-[120px] sm:max-w-none">{user?.email}</span>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
