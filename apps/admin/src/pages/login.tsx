import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertCircle, RefreshCw, WifiOff } from 'lucide-react';

/**
 * BUG-224: Login page fix.
 *
 * Previously rendered blank when session expired due to:
 * 1. Stale isAuthenticated in Zustand → immediate redirect to / → back to /login (loop)
 * 2. Generic "Network error" with no retry or specific guidance
 *
 * Fix:
 * - Use useEffect for redirect instead of render-time navigate (prevents blank)
 * - Show session expired message when redirected with ?expired=1
 * - Specific error messages: session expired, invalid credentials, server unreachable
 * - Retry button for network errors
 */
export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const login = useAuthStore((s) => s.login);
  const loginError = useAuthStore((s) => s.loginError);
  const isLoggingIn = useAuthStore((s) => s.isLoggingIn);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const token = useAuthStore((s) => s.token);
  const clearError = useAuthStore((s) => s.clearError);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const sessionExpired = searchParams.get('expired') === '1';

  // BUG-224: Only redirect if authenticated AND token exists (not stale state)
  useEffect(() => {
    if (isAuthenticated && token) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, token, navigate]);

  // Clear error when component mounts (fresh visit)
  useEffect(() => {
    if (!sessionExpired) clearError();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await login(email, password);
    if (useAuthStore.getState().isAuthenticated) {
      navigate('/', { replace: true });
    }
  }

  function handleRetry() {
    clearError();
    handleSubmit(new Event('submit') as unknown as React.FormEvent);
  }

  // Determine error type for specific messaging
  const errorType = loginError
    ? loginError.includes('Network') || loginError.includes('fetch') || loginError.includes('unreachable')
      ? 'network'
      : loginError.includes('401') || loginError.includes('nvalid') || loginError.includes('credentials')
        ? 'credentials'
        : 'generic'
    : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 p-8 rounded-lg border bg-card shadow-sm">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-primary">CuteBunny</h1>
          <p className="text-muted-foreground">{t('login.title')}</p>
        </div>

        {/* BUG-224: Session expired banner */}
        {sessionExpired && !loginError && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 text-amber-800 text-sm border border-amber-200">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{t('login.sessionExpired')}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium text-foreground">
              {t('login.email')}
            </label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@cutebunny.rental"
              required
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium text-foreground">
              {t('login.password')}
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {/* BUG-224: Specific error messages with retry button for network errors */}
          {loginError && (
            <div className="p-3 rounded-lg text-sm space-y-2">
              {errorType === 'network' ? (
                <div className="flex items-start gap-2 bg-orange-50 text-orange-800 p-3 rounded-lg border border-orange-200">
                  <WifiOff className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-medium">{t('login.errors.serverUnreachable')}</p>
                    <p className="text-xs text-orange-600">{t('login.errors.checkConnection')}</p>
                  </div>
                </div>
              ) : errorType === 'credentials' ? (
                <div className="flex items-center gap-2 bg-destructive/10 text-destructive p-3 rounded-lg">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{t('login.errors.invalidCredentials')}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 bg-destructive/10 text-destructive p-3 rounded-lg">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{loginError}</span>
                </div>
              )}
              {errorType === 'network' && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={handleRetry}
                  disabled={isLoggingIn}
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  {t('login.errors.retry')}
                </Button>
              )}
            </div>
          )}

          <Button type="submit" className="w-full" disabled={isLoggingIn}>
            {isLoggingIn ? t('common.loading') : t('login.submit')}
          </Button>
        </form>
      </div>
    </div>
  );
}
