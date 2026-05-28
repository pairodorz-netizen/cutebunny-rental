'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import { encodeIntent, type AuthIntent } from '@/lib/auth/intent';
import { setStoredToken } from '@/lib/auth/token';

interface AuthSheetProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (token: string) => void;
  intent?: AuthIntent;
}

export function AuthSheet({ open, onClose, onSuccess, intent }: AuthSheetProps) {
  const t = useTranslations('auth');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regFirstName, setRegFirstName] = useState('');
  const [regLastName, setRegLastName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [authError, setAuthError] = useState('');

  const loginMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      api.customer.login(email, password),
    onSuccess: (res) => {
      const accessToken = res.data.access_token;
      setStoredToken(accessToken);
      setAuthError('');
      onSuccess(accessToken);
    },
    onError: () => {
      setAuthError(t('loginError'));
    },
  });

  const registerMutation = useMutation({
    mutationFn: (data: { email: string; password: string; first_name: string; last_name: string; phone?: string }) =>
      api.customer.register(data),
    onSuccess: (res) => {
      const accessToken = res.data.access_token;
      setStoredToken(accessToken);
      setAuthError('');
      onSuccess(accessToken);
    },
    onError: () => {
      setAuthError(t('registerError'));
    },
  });

  const handleLogin = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate({ email: loginEmail, password: loginPassword });
  }, [loginEmail, loginPassword, loginMutation]);

  const handleRegister = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    registerMutation.mutate({
      email: regEmail,
      password: regPassword,
      first_name: regFirstName,
      last_name: regLastName,
      phone: regPhone || undefined,
    });
  }, [regEmail, regPassword, regFirstName, regLastName, regPhone, registerMutation]);

  const handleLineLogin = useCallback(() => {
    const intentStr = intent ? encodeIntent(intent) : '';
    const params = new URLSearchParams();
    if (intentStr) params.set('intent', intentStr);
    window.location.href = `/api/v1/customer/auth/line/start?${params.toString()}`;
  }, [intent]);

  if (!open) return null;

  const featureLineLogin = typeof window !== 'undefined'
    ? document.querySelector('meta[name="feature-line-login"]')?.getAttribute('content') === 'on'
    : false;

  return (
    <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Sheet */}
      <div className="relative z-10 w-full max-w-md bg-white rounded-t-2xl md:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white rounded-t-2xl md:rounded-t-2xl p-4 flex justify-between items-center border-b">
          <h2 className="text-lg font-semibold text-cb-heading">{t('signInTitle')}</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Email/Password Form */}
          <div className="space-y-4">
            {authMode === 'login' ? (
              <form onSubmit={handleLogin} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('email')}
                  </label>
                  <input
                    type="email"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-cb-lavender-200 focus:border-cb-lavender-200 outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('password')}
                  </label>
                  <input
                    type="password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-cb-lavender-200 focus:border-cb-lavender-200 outline-none"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={loginMutation.isPending}
                  className="w-full py-2.5 bg-cb-active text-white rounded-lg font-medium text-sm hover:opacity-90 disabled:opacity-50"
                >
                  {loginMutation.isPending ? t('signingIn') : t('signIn')}
                </button>
                <div className="text-center text-sm text-gray-500">
                  <button type="button" onClick={() => { setAuthMode('register'); setAuthError(''); }} className="text-cb-active hover:underline">
                    {t('createAccount')}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleRegister} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('firstName')}
                    </label>
                    <input
                      type="text"
                      value={regFirstName}
                      onChange={(e) => setRegFirstName(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-cb-lavender-200 focus:border-cb-lavender-200 outline-none"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('lastName')}
                    </label>
                    <input
                      type="text"
                      value={regLastName}
                      onChange={(e) => setRegLastName(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-cb-lavender-200 focus:border-cb-lavender-200 outline-none"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('email')}
                  </label>
                  <input
                    type="email"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-cb-lavender-200 focus:border-cb-lavender-200 outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('password')}
                  </label>
                  <input
                    type="password"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-cb-lavender-200 focus:border-cb-lavender-200 outline-none"
                    minLength={8}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('phone')} <span className="text-gray-400">({t('optional')})</span>
                  </label>
                  <input
                    type="tel"
                    value={regPhone}
                    onChange={(e) => setRegPhone(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-cb-lavender-200 focus:border-cb-lavender-200 outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={registerMutation.isPending}
                  className="w-full py-2.5 bg-cb-active text-white rounded-lg font-medium text-sm hover:opacity-90 disabled:opacity-50"
                >
                  {registerMutation.isPending ? t('creatingAccount') : t('createAccountBtn')}
                </button>
                <div className="text-center text-sm text-gray-500">
                  <button type="button" onClick={() => { setAuthMode('login'); setAuthError(''); }} className="text-cb-active hover:underline">
                    {t('alreadyHaveAccount')}
                  </button>
                </div>
              </form>
            )}
          </div>

          {authError && (
            <div className="text-sm text-red-500 text-center">{authError}</div>
          )}

          {/* LINE Login Option */}
          {featureLineLogin && (
            <>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-sm text-gray-400">{t('or')}</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>

              <button
                type="button"
                onClick={handleLineLogin}
                className="w-full flex items-center justify-center gap-3 py-2.5 rounded-lg font-medium text-sm text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: '#06C755' }}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M17.5 8.84C17.5 5.27 14.14 2.37 10 2.37C5.86 2.37 2.5 5.27 2.5 8.84C2.5 12.05 5.18 14.72 8.84 15.23C9.09 15.28 9.43 15.4 9.52 15.62C9.6 15.82 9.57 16.13 9.55 16.33L9.45 16.94C9.41 17.18 9.27 17.82 10.01 17.51C10.75 17.19 14.05 15.15 15.59 13.37C16.69 12.15 17.5 10.58 17.5 8.84Z" fill="white"/>
                </svg>
                {t('continueWithLine')}
              </button>

              <p className="text-[11px] text-gray-400 text-center leading-tight">
                {t('privacyNotice')}{' '}
                <a href="/privacy" className="underline">{t('privacyLink')}</a>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
