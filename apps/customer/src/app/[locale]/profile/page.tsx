'use client';

import { useTranslations } from 'next-intl';
import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type CustomerProfile, type CustomerOrder } from '@/lib/api';
import { User, Package, Clock, Edit3, Mail, Phone, LogOut, LogIn } from 'lucide-react';

const TOKEN_KEY = 'cb_customer_token';

function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

function setStoredToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearStoredToken() {
  localStorage.removeItem(TOKEN_KEY);
}

interface EditForm {
  first_name: string;
  last_name: string;
  phone: string;
}

export default function ProfilePage() {
  const t = useTranslations('profile');
  const queryClient = useQueryClient();

  const [token, setToken] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regFirstName, setRegFirstName] = useState('');
  const [regLastName, setRegLastName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [authError, setAuthError] = useState('');

  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditForm>({ first_name: '', last_name: '', phone: '' });

  useEffect(() => {
    setToken(getStoredToken());
  }, []);

  const profileQuery = useQuery({
    queryKey: ['customer', 'me', token],
    queryFn: () => api.customer.me(token!),
    enabled: !!token,
    retry: false,
  });

  const ordersQuery = useQuery({
    queryKey: ['customer', 'orders', token],
    queryFn: () => api.customer.orders(token!),
    enabled: !!token,
    retry: false,
  });

  const profile: CustomerProfile | null = profileQuery.data?.data ?? null;
  const orders: CustomerOrder[] = ordersQuery.data?.data ?? [];

  // If token is invalid (401), clear it
  useEffect(() => {
    if (profileQuery.error && token) {
      clearStoredToken();
      setToken(null);
    }
  }, [profileQuery.error, token]);

  const loginMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      api.customer.login(email, password),
    onSuccess: (res) => {
      const accessToken = res.data.access_token;
      setStoredToken(accessToken);
      setToken(accessToken);
      setAuthError('');
      setLoginEmail('');
      setLoginPassword('');
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
      setToken(accessToken);
      setAuthError('');
    },
    onError: () => {
      setAuthError(t('registerError'));
    },
  });

  const updateProfileMutation = useMutation({
    mutationFn: (data: { first_name?: string; last_name?: string; phone?: string }) =>
      api.customer.updateProfile(token!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer', 'me', token] });
      setIsEditing(false);
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

  function handleLogout() {
    clearStoredToken();
    setToken(null);
    queryClient.removeQueries({ queryKey: ['customer'] });
  }

  function startEdit() {
    if (profile) {
      setEditForm({
        first_name: profile.first_name,
        last_name: profile.last_name,
        phone: profile.phone ?? '',
      });
      setIsEditing(true);
    }
  }

  function handleSave() {
    updateProfileMutation.mutate({
      first_name: editForm.first_name,
      last_name: editForm.last_name,
      phone: editForm.phone,
    });
  }

  const statusColor: Record<string, string> = {
    unpaid: 'bg-yellow-100 text-yellow-700',
    paid_locked: 'bg-blue-100 text-blue-700',
    shipped: 'bg-purple-100 text-purple-700',
    returned: 'bg-green-100 text-green-700',
    cleaning: 'bg-orange-100 text-orange-700',
    ready: 'bg-emerald-100 text-emerald-700',
  };

  // Not logged in: show login/register form
  if (!token) {
    return (
      <div className="min-h-screen">
        <div className="container py-8">
          <h1 className="text-2xl md:text-3xl font-display font-semibold text-cb-heading mb-8">
            {t('title')}
          </h1>

          <div className="max-w-md mx-auto">
            <div className="rounded-2xl bg-white p-6 shadow-soft">
              <div className="flex flex-col items-center text-center mb-6">
                <div className="w-20 h-20 rounded-full bg-cb-lavender-100 flex items-center justify-center mb-4">
                  <LogIn className="h-10 w-10 text-cb-lavender-300" />
                </div>
                <h2 className="text-lg font-semibold text-cb-heading">
                  {authMode === 'login' ? t('loginTitle') : t('registerTitle')}
                </h2>
                <p className="text-sm text-cb-secondary mt-1">
                  {authMode === 'login' ? t('loginHint') : t('registerHint')}
                </p>
              </div>

              {authError && (
                <div className="mb-4 p-3 rounded-xl bg-red-50 text-red-600 text-sm text-center">
                  {authError}
                </div>
              )}

              {authMode === 'login' ? (
                <form onSubmit={handleLogin} className="space-y-3">
                  <div>
                    <label className="text-xs text-cb-secondary">{t('email')}</label>
                    <input
                      type="email"
                      required
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      className="w-full mt-1 rounded-xl border border-border px-3 py-2 text-sm text-cb-heading focus:outline-none focus:ring-2 focus:ring-cb-active/50"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-cb-secondary">{t('password')}</label>
                    <input
                      type="password"
                      required
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      className="w-full mt-1 rounded-xl border border-border px-3 py-2 text-sm text-cb-heading focus:outline-none focus:ring-2 focus:ring-cb-active/50"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loginMutation.isPending}
                    className="w-full py-2.5 rounded-xl bg-cb-active text-white text-sm font-medium hover:brightness-110 transition-all disabled:opacity-50"
                  >
                    {loginMutation.isPending ? '...' : t('loginBtn')}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleRegister} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-cb-secondary">{t('firstName')}</label>
                      <input
                        type="text"
                        required
                        value={regFirstName}
                        onChange={(e) => setRegFirstName(e.target.value)}
                        className="w-full mt-1 rounded-xl border border-border px-3 py-2 text-sm text-cb-heading focus:outline-none focus:ring-2 focus:ring-cb-active/50"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-cb-secondary">{t('lastName')}</label>
                      <input
                        type="text"
                        required
                        value={regLastName}
                        onChange={(e) => setRegLastName(e.target.value)}
                        className="w-full mt-1 rounded-xl border border-border px-3 py-2 text-sm text-cb-heading focus:outline-none focus:ring-2 focus:ring-cb-active/50"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-cb-secondary">{t('email')}</label>
                    <input
                      type="email"
                      required
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      className="w-full mt-1 rounded-xl border border-border px-3 py-2 text-sm text-cb-heading focus:outline-none focus:ring-2 focus:ring-cb-active/50"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-cb-secondary">{t('password')}</label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      className="w-full mt-1 rounded-xl border border-border px-3 py-2 text-sm text-cb-heading focus:outline-none focus:ring-2 focus:ring-cb-active/50"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-cb-secondary">{t('phone')}</label>
                    <input
                      type="tel"
                      value={regPhone}
                      onChange={(e) => setRegPhone(e.target.value)}
                      className="w-full mt-1 rounded-xl border border-border px-3 py-2 text-sm text-cb-heading focus:outline-none focus:ring-2 focus:ring-cb-active/50"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={registerMutation.isPending}
                    className="w-full py-2.5 rounded-xl bg-cb-active text-white text-sm font-medium hover:brightness-110 transition-all disabled:opacity-50"
                  >
                    {registerMutation.isPending ? '...' : t('registerBtn')}
                  </button>
                </form>
              )}

              <div className="mt-4 text-center">
                <button
                  onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError(''); }}
                  className="text-sm text-cb-active hover:underline"
                >
                  {authMode === 'login' ? t('switchToRegister') : t('switchToLogin')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Logged in: show profile + rental history
  return (
    <div className="min-h-screen">
      <div className="container py-8">
        <h1 className="text-2xl md:text-3xl font-display font-semibold text-cb-heading mb-8">
          {t('title')}
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Profile Card */}
          <div className="lg:col-span-1">
            <div className="rounded-2xl bg-white p-6 shadow-soft">
              <div className="flex flex-col items-center text-center mb-6">
                <div className="w-20 h-20 rounded-full bg-cb-lavender-100 flex items-center justify-center mb-4">
                  <User className="h-10 w-10 text-cb-lavender-300" />
                </div>
                {profileQuery.isLoading ? (
                  <div className="animate-pulse space-y-2">
                    <div className="h-5 w-32 bg-muted rounded" />
                    <div className="h-4 w-40 bg-muted rounded" />
                  </div>
                ) : (
                  <>
                    <h2 className="text-lg font-semibold text-cb-heading">
                      {profile ? `${profile.first_name} ${profile.last_name}` : t('guestUser')}
                    </h2>
                    <p className="text-sm text-cb-secondary mt-1">
                      {profile?.email ?? t('noEmail')}
                    </p>
                    {profile?.tier && (
                      <span className="mt-2 inline-block text-xs font-medium px-3 py-1 rounded-full bg-cb-lavender-100 text-cb-lavender-300">
                        {profile.tier}
                      </span>
                    )}
                  </>
                )}
              </div>

              {profile && !isEditing ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Mail className="h-4 w-4 text-cb-secondary shrink-0" />
                    <span className="text-sm text-cb-heading">{profile.email}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Phone className="h-4 w-4 text-cb-secondary shrink-0" />
                    <span className="text-sm text-cb-heading">{profile.phone || '-'}</span>
                  </div>
                  {profile.credit_balance > 0 && (
                    <div className="flex items-center gap-3">
                      <Package className="h-4 w-4 text-cb-secondary shrink-0" />
                      <span className="text-sm text-cb-heading">
                        {t('credit')}: ฿{profile.credit_balance.toLocaleString()}
                      </span>
                    </div>
                  )}
                  <button
                    onClick={startEdit}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-cb-active text-white text-sm font-medium hover:brightness-110 transition-all mt-4"
                  >
                    <Edit3 className="h-4 w-4" />
                    {t('editProfile')}
                  </button>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-border text-cb-heading text-sm font-medium hover:bg-cb-surface transition-all"
                  >
                    <LogOut className="h-4 w-4" />
                    {t('logout')}
                  </button>
                </div>
              ) : isEditing ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-cb-secondary">{t('firstName')}</label>
                      <input
                        type="text"
                        value={editForm.first_name}
                        onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })}
                        className="w-full mt-1 rounded-xl border border-border px-3 py-2 text-sm text-cb-heading focus:outline-none focus:ring-2 focus:ring-cb-active/50"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-cb-secondary">{t('lastName')}</label>
                      <input
                        type="text"
                        value={editForm.last_name}
                        onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })}
                        className="w-full mt-1 rounded-xl border border-border px-3 py-2 text-sm text-cb-heading focus:outline-none focus:ring-2 focus:ring-cb-active/50"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-cb-secondary">{t('phone')}</label>
                    <input
                      type="tel"
                      value={editForm.phone}
                      onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                      className="w-full mt-1 rounded-xl border border-border px-3 py-2 text-sm text-cb-heading focus:outline-none focus:ring-2 focus:ring-cb-active/50"
                    />
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={handleSave}
                      disabled={updateProfileMutation.isPending}
                      className="flex-1 py-2.5 rounded-xl bg-cb-active text-white text-sm font-medium hover:brightness-110 transition-all disabled:opacity-50"
                    >
                      {updateProfileMutation.isPending ? '...' : t('save')}
                    </button>
                    <button
                      onClick={() => setIsEditing(false)}
                      className="flex-1 py-2.5 rounded-xl border border-border text-cb-heading text-sm font-medium hover:bg-cb-surface transition-all"
                    >
                      {t('cancel')}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* Rental History */}
          <div className="lg:col-span-2">
            <div className="rounded-2xl bg-white p-6 shadow-soft">
              <div className="flex items-center gap-2 mb-6">
                <Clock className="h-5 w-5 text-cb-heading" />
                <h2 className="text-lg font-semibold text-cb-heading">{t('rentalHistory')}</h2>
              </div>

              {ordersQuery.isLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="animate-pulse flex items-center gap-4 p-4 rounded-xl border border-border">
                      <div className="w-16 h-20 rounded-lg bg-muted" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 w-48 bg-muted rounded" />
                        <div className="h-3 w-32 bg-muted rounded" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : orders.length === 0 ? (
                <div className="text-center py-12">
                  <Package className="h-12 w-12 text-cb-secondary/40 mx-auto mb-4" />
                  <p className="text-sm text-cb-secondary">{t('noHistory')}</p>
                  <p className="text-xs text-cb-secondary mt-1">{t('noHistoryHint')}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {orders.map((order) => (
                    <div
                      key={order.id}
                      className="p-4 rounded-xl border border-border hover:shadow-soft transition-all"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <span className="text-sm font-medium text-cb-heading">{order.order_number}</span>
                          <span className="text-xs text-cb-secondary ml-2">
                            {order.rental_start} → {order.rental_end}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`inline-block text-xs font-medium px-2 py-1 rounded-full ${statusColor[order.status] || 'bg-gray-100 text-gray-700'}`}>
                            {order.status}
                          </span>
                          <span className="text-sm font-semibold text-cb-heading">
                            ฿{order.total_amount.toLocaleString()}
                          </span>
                        </div>
                      </div>
                      {order.items.length > 0 && (
                        <div className="space-y-2">
                          {order.items.map((item, idx) => (
                            <div key={idx} className="flex items-center gap-3">
                              <div className="w-10 h-12 rounded-lg bg-muted overflow-hidden shrink-0">
                                {item.thumbnail && (
                                  <img src={item.thumbnail} alt={item.product_name} className="w-full h-full object-cover" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-cb-heading truncate">{item.product_name}</p>
                                <p className="text-xs text-cb-secondary">
                                  {item.size} • {t('qty')} {item.quantity}
                                </p>
                              </div>
                              <span className="text-xs text-cb-secondary">฿{item.subtotal.toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
