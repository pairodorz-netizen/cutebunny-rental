import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth-store';
import { Sidebar } from './sidebar';
import { LocaleSwitcher } from './locale-switcher';
import { useTranslation } from 'react-i18next';

export function ProtectedLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const { t } = useTranslation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <header className="h-16 border-b flex items-center justify-between px-6">
          <h2 className="text-sm text-muted-foreground">
            {t('common.appName')}
          </h2>
          <div className="flex items-center gap-4">
            <LocaleSwitcher />
            <span className="text-sm text-muted-foreground">{user?.email}</span>
          </div>
        </header>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
