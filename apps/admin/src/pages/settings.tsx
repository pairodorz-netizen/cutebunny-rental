import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminApi } from '@/lib/api';
import { AdminApiError } from '@cutebunny/shared/diagnostics';
import { useAdminCategoriesWithDriftGuard } from '@/lib/categories-drift-guard';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Save, Plus, Trash2, Pencil, X, Shield, User, Bell, Send, GripVertical, MapPin, Truck, Tag, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { SystemConfigForm } from '@/components/settings/SystemConfigForm';
import { DriftBanner } from '@/components/drift-banner';

type Tab = 'config' | 'users' | 'audit' | 'notifications' | 'categories' | 'store' | 'shipping';

interface AdminUserItem {
  id: string;
  email: string;
  name: string | null;
  role: string;
  lastLoginAt: string | null;
  createdAt: string;
}

interface NotificationItem {
  id: string;
  order_id: string | null;
  customer_id: string | null;
  channel: string;
  recipient: string;
  subject: string | null;
  body: string;
  status: string;
  error_message: string | null;
  created_at: string;
}

interface AuditLogItem {
  id: string;
  admin_email: string;
  admin_name: string;
  action: string;
  resource: string;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  // BUG-AUDIT-UI-A01: server-derived per-row UI conveniences.
  key: string | null;
  section: string | null;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
}

// BUG-AUDIT-UI-A01: known SystemConfig groups (mirrors the server-side
// FIXED_ALLOWED_KEYS group set). The shipping group also catches the
// `shipping_days_*` regex family on the server; both surface here.
const AUDIT_SECTIONS = ['finance', 'calendar', 'shipping', 'customer_ux'] as const;
type AuditSection = (typeof AUDIT_SECTIONS)[number];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function sevenDaysAgoIso(): string {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function SettingsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab') as Tab | null;
  const [activeTab, setActiveTab] = useState<Tab>(tabFromUrl && ['config','users','audit','notifications','categories','store','shipping'].includes(tabFromUrl) ? tabFromUrl : 'config');

  useEffect(() => {
    if (tabFromUrl && tabFromUrl !== activeTab && ['config','users','audit','notifications','categories','store','shipping'].includes(tabFromUrl)) {
      setActiveTab(tabFromUrl);
    }
  }, [tabFromUrl]);

  const switchTab = (tab: Tab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  // Store address state (#1)
  const [editingAddress, setEditingAddress] = useState<Record<string, unknown> | null>(null);

  // User state
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState('staff');

  // Notification state
  const [notifPage, setNotifPage] = useState(1);
  const [showSendNotif, setShowSendNotif] = useState(false);
  const [notifChannel, setNotifChannel] = useState('email');
  const [notifRecipient, setNotifRecipient] = useState('');
  const [notifSubject, setNotifSubject] = useState('');
  const [notifBody, setNotifBody] = useState('');

  // Audit state — BUG-AUDIT-UI-A01 filter row + URL sync.
  const [auditPage, setAuditPage] = useState<number>(() => {
    const raw = searchParams.get('page');
    const n = raw ? parseInt(raw, 10) : 1;
    return Number.isFinite(n) && n > 0 ? n : 1;
  });
  const [auditFrom, setAuditFrom] = useState<string>(
    searchParams.get('from') ?? sevenDaysAgoIso(),
  );
  const [auditTo, setAuditTo] = useState<string>(
    searchParams.get('to') ?? todayIso(),
  );
  const [auditSections, setAuditSections] = useState<AuditSection[]>(() => {
    const all = searchParams.getAll('section');
    return all.filter((s): s is AuditSection =>
      (AUDIT_SECTIONS as readonly string[]).includes(s),
    );
  });
  const [auditActor, setAuditActor] = useState<string>(searchParams.get('actor') ?? '');
  const [auditQ, setAuditQ] = useState<string>(searchParams.get('q') ?? '');
  // 300ms debounce on the free-text search to avoid hammering the
  // server on every keystroke; mirrors BUG-CAL-03 pattern from PR #69.
  const [auditQDebounced, setAuditQDebounced] = useState(auditQ);
  useEffect(() => {
    const id = setTimeout(() => setAuditQDebounced(auditQ), 300);
    return () => clearTimeout(id);
  }, [auditQ]);

  const usersQuery = useQuery({
    queryKey: ['settings-users'],
    queryFn: () => adminApi.settings.users(),
    // BUG-AUDIT-UI-A01: also fetch the admin user list when the audit
    // tab is active so the actor dropdown can resolve adminId→name.
    enabled: activeTab === 'users' || activeTab === 'audit',
  });

  const notifQuery = useQuery({
    queryKey: ['settings-notifications', notifPage],
    queryFn: () => adminApi.settings.notifications({ page: String(notifPage), per_page: '30' }),
    enabled: activeTab === 'notifications',
  });

  const sendNotifMutation = useMutation({
    mutationFn: (body: { channel: string; recipient: string; subject?: string; body: string }) =>
      adminApi.settings.sendNotification(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-notifications'] });
      setShowSendNotif(false);
      setNotifRecipient('');
      setNotifSubject('');
      setNotifBody('');
    },
  });

  // BUG-AUDIT-UI-A01: build query params from filter state. `from`/`to`
  // are sent as ISO 8601 with the day clamped to UTC midnight →
  // 23:59:59.999 so a `to=2026-04-26` request includes every entry
  // from that day. Empty filters are omitted so they don't override
  // server defaults.
  const auditParams = useMemo(() => {
    const p: Record<string, string | string[]> = {
      page: String(auditPage),
      pageSize: '50',
      resource: 'system_config',
    };
    if (auditFrom) p.from = `${auditFrom}T00:00:00.000Z`;
    if (auditTo) p.to = `${auditTo}T23:59:59.999Z`;
    if (auditSections.length > 0) p.section = auditSections;
    if (auditActor) p.actor = auditActor;
    if (auditQDebounced) p.q = auditQDebounced;
    return p;
  }, [auditPage, auditFrom, auditTo, auditSections, auditActor, auditQDebounced]);

  const auditQuery = useQuery({
    queryKey: ['settings-audit', auditParams],
    queryFn: () => adminApi.settings.auditLog(auditParams),
    enabled: activeTab === 'audit',
  });

  // URL sync: when any audit filter changes, reflect into ?tab=audit&…
  // so the view is bookmarkable and the back button restores filters.
  // Reset to page 1 whenever a filter (other than the page itself)
  // changes — stale page numbers on a narrowed result set are a
  // common UX hazard.
  useEffect(() => {
    if (activeTab !== 'audit') return;
    const next = new URLSearchParams();
    next.set('tab', 'audit');
    if (auditFrom) next.set('from', auditFrom);
    if (auditTo) next.set('to', auditTo);
    auditSections.forEach((s) => next.append('section', s));
    if (auditActor) next.set('actor', auditActor);
    if (auditQDebounced) next.set('q', auditQDebounced);
    if (auditPage > 1) next.set('page', String(auditPage));
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, auditFrom, auditTo, auditSections, auditActor, auditQDebounced, auditPage]);

  const [createUserError, setCreateUserError] = useState('');

  const createUserMutation = useMutation({
    mutationFn: (body: { email: string; password: string; name?: string; role?: string }) =>
      adminApi.settings.createUser(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-users'] });
      setShowAddUser(false);
      setNewUserEmail('');
      setNewUserName('');
      setNewUserPassword('');
      setNewUserRole('staff');
      setCreateUserError('');
    },
    onError: (err: Error & { message?: string }) => {
      setCreateUserError(err.message || 'Failed to create user');
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: (id: string) => adminApi.settings.deleteUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-users'] });
    },
  });

  const users = (usersQuery.data?.data ?? []) as AdminUserItem[];
  const notifData = notifQuery.data as { data: NotificationItem[]; meta: { page: number; per_page: number; total: number; total_pages: number } } | undefined;
  const auditData = auditQuery.data as { data: AuditLogItem[]; meta: { page: number; per_page: number; pageSize: number; total: number; total_pages: number } } | undefined;
  const adminRole = useAuthStore((s) => s.user?.role ?? null);
  const isSuperadmin = adminRole === 'superadmin';

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t('settings.title')}</h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted rounded-lg p-1 mb-6 w-fit flex-wrap">
        {(['config', 'categories', 'store', 'shipping', 'users', 'notifications', 'audit'] as Tab[])
          // BUG-AUDIT-UI-A01: cosmetic role hide — server is the real
          // gate (403). Keeps the tab from showing for staff who would
          // only ever see a 403 if they clicked it.
          .filter((tab) => tab !== 'audit' || isSuperadmin)
          .map((tab) => (
          <button
            key={tab}
            onClick={() => switchTab(tab)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              activeTab === tab ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t(`settings.tab_${tab}`)}
          </button>
        ))}
      </div>

      {/* Config Tab — redesigned grouped form UI (#31) */}
      {activeTab === 'config' && <SystemConfigForm />}

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          {usersQuery.isLoading ? (
            <div className="rounded-lg border p-8 text-center text-muted-foreground">{t('common.loading')}</div>
          ) : (
            <>
              <div className="rounded-lg border">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">{t('settings.email')}</th>
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">{t('settings.name')}</th>
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">{t('settings.role')}</th>
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">{t('settings.lastLogin')}</th>
                        <th className="text-right p-3 text-xs font-medium text-muted-foreground">{t('settings.actions')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {users.map((user) => (
                        <tr key={user.id} className="hover:bg-muted/30">
                          <td className="p-3 text-sm font-medium">{user.email}</td>
                          <td className="p-3 text-sm">{user.name ?? '-'}</td>
                          <td className="p-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
                              user.role === 'superadmin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                            }`}>
                              {user.role === 'superadmin' ? <Shield className="h-3 w-3" /> : <User className="h-3 w-3" />}
                              {user.role}
                            </span>
                          </td>
                          <td className="p-3 text-sm text-muted-foreground">
                            {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : t('settings.never')}
                          </td>
                          <td className="p-3 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-red-500 hover:text-red-700"
                              disabled={deleteUserMutation.isPending}
                              onClick={() => {
                                if (confirm(t('settings.confirmDeleteUser', { email: user.email }))) {
                                  deleteUserMutation.mutate(user.id);
                                }
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {showAddUser ? (
                <div className="rounded-lg border p-4 space-y-3">
                  <h3 className="font-semibold text-sm">{t('settings.addUser')}</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground">{t('settings.email')}</label>
                      <Input type="email" value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} placeholder="admin@cutebunny.com" className="h-8" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">{t('settings.name')}</label>
                      <Input value={newUserName} onChange={(e) => setNewUserName(e.target.value)} placeholder="Admin Name" className="h-8" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">{t('settings.password')}</label>
                      <Input type="password" value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} placeholder="Min 8 characters" className="h-8" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">{t('settings.role')}</label>
                      <select
                        value={newUserRole}
                        onChange={(e) => setNewUserRole(e.target.value)}
                        className="w-full h-8 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="staff">Staff</option>
                        <option value="superadmin">Superadmin</option>
                      </select>
                    </div>
                  </div>
                  {createUserError && (
                    <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{createUserError}</p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={!newUserEmail || !newUserPassword || newUserPassword.length < 8 || createUserMutation.isPending}
                      onClick={() => {
                        setCreateUserError('');
                        createUserMutation.mutate({
                          email: newUserEmail, password: newUserPassword,
                          name: newUserName || undefined, role: newUserRole,
                        });
                      }}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" /> {t('settings.createUser')}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { setShowAddUser(false); setCreateUserError(''); }}>
                      {t('common.cancel')}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="outline" onClick={() => setShowAddUser(true)}>
                  <Plus className="h-4 w-4 mr-2" /> {t('settings.addUser')}
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {/* Notifications Tab */}
      {activeTab === 'notifications' && (
        <div className="space-y-4">
          {notifQuery.isLoading ? (
            <div className="rounded-lg border p-8 text-center text-muted-foreground">{t('common.loading')}</div>
          ) : (
            <>
              <div className="rounded-lg border">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">{t('settings.timestamp')}</th>
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">{t('settings.notifChannel')}</th>
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">{t('settings.notifRecipient')}</th>
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">{t('settings.notifSubject')}</th>
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">{t('settings.notifStatus')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {notifData?.data.map((notif) => (
                        <tr key={notif.id} className="hover:bg-muted/30">
                          <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(notif.created_at).toLocaleString()}
                          </td>
                          <td className="p-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              notif.channel === 'email' ? 'bg-blue-100 text-blue-700' :
                              notif.channel === 'line' ? 'bg-green-100 text-green-700' :
                              'bg-gray-100 text-gray-700'
                            }`}>
                              {notif.channel}
                            </span>
                          </td>
                          <td className="p-3 text-sm font-mono">{notif.recipient}</td>
                          <td className="p-3 text-sm">{notif.subject ?? '-'}</td>
                          <td className="p-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              notif.status === 'sent' ? 'bg-green-100 text-green-700' :
                              notif.status === 'failed' ? 'bg-red-100 text-red-700' :
                              'bg-yellow-100 text-yellow-700'
                            }`}>
                              {notif.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {(!notifData?.data || notifData.data.length === 0) && (
                        <tr>
                          <td colSpan={5} className="p-8 text-center text-muted-foreground text-sm">{t('settings.noNotifications')}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              {notifData && notifData.meta.total_pages > 1 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {t('settings.page')} {notifData.meta.page} / {notifData.meta.total_pages} ({notifData.meta.total} {t('settings.entries')})
                  </span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={notifPage <= 1} onClick={() => setNotifPage((p) => p - 1)}>
                      {t('common.prev')}
                    </Button>
                    <Button size="sm" variant="outline" disabled={notifPage >= notifData.meta.total_pages} onClick={() => setNotifPage((p) => p + 1)}>
                      {t('common.next')}
                    </Button>
                  </div>
                </div>
              )}

              {showSendNotif ? (
                <div className="rounded-lg border p-4 space-y-3">
                  <h3 className="font-semibold text-sm flex items-center gap-2">
                    <Send className="h-4 w-4" /> {t('settings.sendNotification')}
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground">{t('settings.notifChannel')}</label>
                      <select
                        value={notifChannel}
                        onChange={(e) => setNotifChannel(e.target.value)}
                        className="w-full h-8 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="email">Email</option>
                        <option value="line">LINE</option>
                        <option value="sms">SMS</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">{t('settings.notifRecipient')}</label>
                      <Input value={notifRecipient} onChange={(e) => setNotifRecipient(e.target.value)} placeholder="user@example.com" className="h-8" />
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs text-muted-foreground">{t('settings.notifSubject')}</label>
                      <Input value={notifSubject} onChange={(e) => setNotifSubject(e.target.value)} placeholder="Subject" className="h-8" />
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs text-muted-foreground">{t('settings.notifBody')}</label>
                      <textarea
                        value={notifBody}
                        onChange={(e) => setNotifBody(e.target.value)}
                        placeholder="Message body..."
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px]"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={!notifRecipient || !notifBody || sendNotifMutation.isPending}
                      onClick={() => sendNotifMutation.mutate({
                        channel: notifChannel,
                        recipient: notifRecipient,
                        subject: notifSubject || undefined,
                        body: notifBody,
                      })}
                    >
                      <Send className="h-3.5 w-3.5 mr-1" /> {t('settings.send')}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setShowSendNotif(false)}>
                      {t('common.cancel')}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="outline" onClick={() => setShowSendNotif(true)}>
                  <Bell className="h-4 w-4 mr-2" /> {t('settings.sendNotification')}
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {/* Audit Log Tab */}
      {activeTab === 'audit' && (
        <div>
          {/* BUG-AUDIT-UI-A01: filter row */}
          <div className="rounded-lg border p-3 mb-4 grid gap-3 md:grid-cols-2 lg:grid-cols-5">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {t('settings.audit.filters.dateFrom')}
              </label>
              <Input
                type="date"
                value={auditFrom}
                onChange={(e) => { setAuditFrom(e.target.value); setAuditPage(1); }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {t('settings.audit.filters.dateTo')}
              </label>
              <Input
                type="date"
                value={auditTo}
                onChange={(e) => { setAuditTo(e.target.value); setAuditPage(1); }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {t('settings.audit.filters.section')}
              </label>
              <div className="flex flex-wrap gap-1">
                {AUDIT_SECTIONS.map((s) => {
                  const active = auditSections.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setAuditSections((prev) =>
                          prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
                        );
                        setAuditPage(1);
                      }}
                      className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                        active
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {t(`settings.audit.section.${s}`)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {t('settings.audit.filters.actor')}
              </label>
              <select
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                value={auditActor}
                onChange={(e) => { setAuditActor(e.target.value); setAuditPage(1); }}
              >
                <option value="">{t('settings.audit.filters.actorAll')}</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name || u.email}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {t('settings.audit.filters.search')}
              </label>
              <Input
                value={auditQ}
                placeholder={t('settings.audit.filters.searchPlaceholder')}
                onChange={(e) => { setAuditQ(e.target.value); setAuditPage(1); }}
              />
            </div>
          </div>

          {auditQuery.isLoading ? (
            <div className="rounded-lg border p-8 text-center text-muted-foreground">{t('common.loading')}</div>
          ) : auditData ? (
            <>
              <div className="rounded-lg border">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">{t('settings.timestamp')}</th>
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">{t('settings.admin')}</th>
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">{t('settings.action')}</th>
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">{t('settings.audit.column.section')}</th>
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">{t('settings.audit.column.key')}</th>
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">{t('settings.details')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {auditData.data.map((log) => (
                        <tr key={log.id} className="hover:bg-muted/30">
                          <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(log.created_at).toLocaleString()}
                          </td>
                          <td className="p-3 text-sm">{log.admin_name}</td>
                          <td className="p-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              log.action === 'CREATE' ? 'bg-green-100 text-green-700' :
                              log.action === 'UPDATE' ? 'bg-blue-100 text-blue-700' :
                              log.action === 'DELETE' ? 'bg-red-100 text-red-700' :
                              'bg-gray-100 text-gray-700'
                            }`}>
                              {log.action}
                            </span>
                          </td>
                          <td className="p-3 text-xs text-muted-foreground">
                            {log.section ? t(`settings.audit.section.${log.section}`) : '—'}
                          </td>
                          <td className="p-3 text-xs font-mono text-muted-foreground">
                            {log.key ?? '—'}
                          </td>
                          <td className="p-3 text-xs text-muted-foreground max-w-[260px] truncate">
                            {log.details ? JSON.stringify(log.details) : '-'}
                          </td>
                        </tr>
                      ))}
                      {auditData.data.length === 0 && (
                        <tr>
                          <td colSpan={6} className="p-8 text-center text-muted-foreground text-sm">{t('settings.noAuditLogs')}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              {auditData.meta.total_pages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <span className="text-sm text-muted-foreground">
                    {t('settings.page')} {auditData.meta.page} / {auditData.meta.total_pages} ({auditData.meta.total} {t('settings.entries')})
                  </span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={auditPage <= 1} onClick={() => setAuditPage((p) => p - 1)}>
                      {t('common.prev')}
                    </Button>
                    <Button size="sm" variant="outline" disabled={auditPage >= auditData.meta.total_pages} onClick={() => setAuditPage((p) => p + 1)}>
                      {t('common.next')}
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      )}
      {/* Categories Tab (#6) — BUG-504-A03 DB-backed CRUD */}
      {activeTab === 'categories' && <CategoriesTab />}

      {/* Store Address Tab (#1) */}
      {activeTab === 'store' && <StoreAddressTab editingAddress={editingAddress} setEditingAddress={setEditingAddress} />}

      {/* Shipping Tab (#2 + #3) */}
      {activeTab === 'shipping' && <ShippingTab />}
    </div>
  );
}

// ─── CATEGORIES TAB (#6) ────────────────────────────────────────────────────

// BUG-504-A03: DB-backed categories CRUD (replaces the legacy
// SystemConfig.product_categories string[] experience). The legacy
// endpoint is still consumed by products.tsx:create-dropdown; its
// retirement is scheduled for the A04 customer-wiring atom so this
// change stays strictly non-breaking.
interface CategoryRow {
  id: string;
  slug: string;
  name_th: string;
  name_en: string;
  sort_order: number;
  visible_frontend: boolean;
  visible_backend: boolean;
}

type DraftRow = Omit<CategoryRow, 'id'>;

function CategoriesTab() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<DraftRow | null>(null);
  const [newDraft, setNewDraft] = useState<DraftRow>({
    slug: '',
    name_th: '',
    name_en: '',
    sort_order: 0,
    visible_frontend: true,
    visible_backend: true,
  });
  const [pendingDelete, setPendingDelete] = useState<CategoryRow | null>(null);

  // BUG-504-A06.5: wrap the admin categories fetch with the drift guard
  // hook (parallel fetch of /api/v1/categories + detectCategoryDrift).
  // The query key stays `['admin-categories']` so existing mutation
  // invalidations work unchanged.
  const categoriesQuery = useAdminCategoriesWithDriftGuard();

  const rows: CategoryRow[] = categoriesQuery.data?.admin ?? [];
  const driftReport = categoriesQuery.data?.report;
  const slugSet = new Set(rows.map((r) => r.slug));
  const nextSort = rows.length > 0 ? Math.max(...rows.map((r) => r.sort_order)) + 10 : 10;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-categories'] });
    // A02 public list cached ≤ 5min; keep admin query invalidation
    // separate so the admin reads stay fresh regardless of edge TTL.
    queryClient.invalidateQueries({ queryKey: ['settings-categories'] });
  };

  // BUG-504-RC2: translate the API 409 IN_USE envelope into a localized,
  // actionable message. Falls back to `err.message` for every other error
  // (validation, conflict, server) so existing flows keep their current
  // copy. Reads `details.products_count` from AdminApiError.payload.
  const formatCategoryError = (err: Error): string => {
    if (err instanceof AdminApiError) {
      const { code, details, message } = err.payload;
      if (code === 'IN_USE') {
        const detailsObj =
          details && typeof details === 'object' ? (details as Record<string, unknown>) : null;
        const rawCount = detailsObj?.products_count;
        const count = typeof rawCount === 'number' ? rawCount : 0;
        return t('settings.categoryErrorInUse', { count, defaultValue: message });
      }
    }
    return err.message;
  };

  const createMutation = useMutation({
    mutationFn: (body: DraftRow) => adminApi.categories.create(body),
    onSuccess: () => {
      invalidate();
      setNewDraft({
        slug: '',
        name_th: '',
        name_en: '',
        sort_order: nextSort,
        visible_frontend: true,
        visible_backend: true,
      });
      setFormError(null);
    },
    onError: (err: Error) => setFormError(formatCategoryError(err)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<DraftRow> }) =>
      adminApi.categories.update(id, body),
    onSuccess: () => {
      invalidate();
      setEditingId(null);
      setEditDraft(null);
      setFormError(null);
    },
    onError: (err: Error) => setFormError(formatCategoryError(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.categories.remove(id),
    onSuccess: () => {
      invalidate();
      setPendingDelete(null);
      setFormError(null);
    },
    onError: (err: Error) => setFormError(formatCategoryError(err)),
  });

  const SLUG_RE = /^[a-z0-9_-]+$/;

  const handleCreate = () => {
    const slug = newDraft.slug.trim();
    const nameTh = newDraft.name_th.trim();
    const nameEn = newDraft.name_en.trim();
    if (!slug || !SLUG_RE.test(slug)) {
      setFormError(t('settings.categoryErrorSlugFormat'));
      return;
    }
    if (slugSet.has(slug)) {
      setFormError(t('settings.categoryErrorSlugDuplicate'));
      return;
    }
    if (!nameTh || !nameEn) {
      setFormError(t('settings.categoryErrorNameRequired'));
      return;
    }
    createMutation.mutate({
      ...newDraft,
      slug,
      name_th: nameTh,
      name_en: nameEn,
      sort_order: Number.isFinite(newDraft.sort_order) ? newDraft.sort_order : nextSort,
    });
  };

  const startEdit = (row: CategoryRow) => {
    setEditingId(row.id);
    setEditDraft({
      slug: row.slug,
      name_th: row.name_th,
      name_en: row.name_en,
      sort_order: row.sort_order,
      visible_frontend: row.visible_frontend,
      visible_backend: row.visible_backend,
    });
    setFormError(null);
  };

  const commitEdit = () => {
    if (!editingId || !editDraft) return;
    const original = rows.find((r) => r.id === editingId);
    if (!original) return;
    const slug = editDraft.slug.trim();
    const nameTh = editDraft.name_th.trim();
    const nameEn = editDraft.name_en.trim();
    if (!slug || !SLUG_RE.test(slug)) {
      setFormError(t('settings.categoryErrorSlugFormat'));
      return;
    }
    if (slug !== original.slug && slugSet.has(slug)) {
      setFormError(t('settings.categoryErrorSlugDuplicate'));
      return;
    }
    if (!nameTh || !nameEn) {
      setFormError(t('settings.categoryErrorNameRequired'));
      return;
    }
    const body: Partial<DraftRow> = {};
    if (slug !== original.slug) body.slug = slug;
    if (nameTh !== original.name_th) body.name_th = nameTh;
    if (nameEn !== original.name_en) body.name_en = nameEn;
    if (editDraft.sort_order !== original.sort_order) body.sort_order = editDraft.sort_order;
    if (editDraft.visible_frontend !== original.visible_frontend) body.visible_frontend = editDraft.visible_frontend;
    if (editDraft.visible_backend !== original.visible_backend) body.visible_backend = editDraft.visible_backend;
    if (Object.keys(body).length === 0) {
      setEditingId(null);
      setEditDraft(null);
      return;
    }
    updateMutation.mutate({ id: editingId, body });
  };

  const toggleVisibility = (row: CategoryRow, field: 'visible_frontend' | 'visible_backend') => {
    updateMutation.mutate({ id: row.id, body: { [field]: !row[field] } });
  };

  return (
    <div className="space-y-4">
      <DriftBanner report={driftReport} />
      <div className="rounded-lg border">
        <div className="p-4 border-b bg-muted/30">
          <h3 className="font-semibold">{t('settings.categoriesTitle')}</h3>
          <p className="text-xs text-muted-foreground mt-1">{t('settings.categoriesDesc')}</p>
        </div>

        {categoriesQuery.isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">{t('common.loading')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/20 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">{t('settings.categoryCol_slug')}</th>
                  <th className="px-3 py-2 text-left">{t('settings.categoryCol_nameTh')}</th>
                  <th className="px-3 py-2 text-left">{t('settings.categoryCol_nameEn')}</th>
                  <th className="px-3 py-2 text-right">{t('settings.categoryCol_sortOrder')}</th>
                  <th className="px-3 py-2 text-center">{t('settings.categoryCol_visibleFrontend')}</th>
                  <th className="px-3 py-2 text-center">{t('settings.categoryCol_visibleBackend')}</th>
                  <th className="px-3 py-2 text-right">{t('common.edit')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => {
                  const editing = editingId === row.id && editDraft;
                  return (
                    <tr key={row.id} data-slug={row.slug}>
                      <td className="px-3 py-2 font-mono text-xs">
                        {editing ? (
                          <Input value={editDraft.slug} onChange={(e) => setEditDraft({ ...editDraft, slug: e.target.value })} className="h-8 w-32" />
                        ) : (
                          row.slug
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {editing ? (
                          <Input value={editDraft.name_th} onChange={(e) => setEditDraft({ ...editDraft, name_th: e.target.value })} className="h-8 w-40" />
                        ) : (
                          row.name_th
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {editing ? (
                          <Input value={editDraft.name_en} onChange={(e) => setEditDraft({ ...editDraft, name_en: e.target.value })} className="h-8 w-40" />
                        ) : (
                          row.name_en
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {editing ? (
                          <Input
                            type="number"
                            value={editDraft.sort_order}
                            onChange={(e) => setEditDraft({ ...editDraft, sort_order: Number(e.target.value) })}
                            className="h-8 w-20 text-right"
                          />
                        ) : (
                          row.sort_order
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          disabled={updateMutation.isPending}
                          onClick={() => toggleVisibility(row, 'visible_frontend')}
                          aria-label={t('settings.categoryCol_visibleFrontend')}
                          aria-pressed={row.visible_frontend}
                        >
                          {row.visible_frontend ? (
                            <Eye className="h-3.5 w-3.5" />
                          ) : (
                            <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                        </Button>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          disabled={updateMutation.isPending}
                          onClick={() => toggleVisibility(row, 'visible_backend')}
                          aria-label={t('settings.categoryCol_visibleBackend')}
                          aria-pressed={row.visible_backend}
                        >
                          {row.visible_backend ? (
                            <Eye className="h-3.5 w-3.5" />
                          ) : (
                            <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                        </Button>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          {editing ? (
                            <>
                              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={commitEdit} disabled={updateMutation.isPending} aria-label={t('common.save')}>
                                <Save className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => { setEditingId(null); setEditDraft(null); setFormError(null); }} aria-label={t('common.cancel')}>
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => startEdit(row)} aria-label={t('common.edit')}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" onClick={() => setPendingDelete(row)} aria-label={t('common.delete')}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-sm text-muted-foreground">
                      {t('settings.categoriesEmpty')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {formError && (
        <div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {formError}
        </div>
      )}

      {/* ── Create-new form ───────────────────────────────────────── */}
      <div className="rounded-lg border p-4 space-y-3">
        <h4 className="font-semibold text-sm">{t('settings.categoryCreateTitle')}</h4>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t('settings.categoryCol_slug')}</label>
            <Input value={newDraft.slug} onChange={(e) => setNewDraft({ ...newDraft, slug: e.target.value })} placeholder="new-slug" className="h-9 font-mono text-xs" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t('settings.categoryCol_nameTh')}</label>
            <Input value={newDraft.name_th} onChange={(e) => setNewDraft({ ...newDraft, name_th: e.target.value })} placeholder="ชื่อภาษาไทย" className="h-9" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t('settings.categoryCol_nameEn')}</label>
            <Input value={newDraft.name_en} onChange={(e) => setNewDraft({ ...newDraft, name_en: e.target.value })} placeholder="English name" className="h-9" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t('settings.categoryCol_sortOrder')}</label>
            <Input
              type="number"
              value={newDraft.sort_order || ''}
              onChange={(e) => setNewDraft({ ...newDraft, sort_order: Number(e.target.value) })}
              placeholder={String(nextSort)}
              className="h-9"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={handleCreate} disabled={createMutation.isPending}>
            <Plus className="h-4 w-4 mr-1" /> {t('settings.addCategory')}
          </Button>
        </div>
      </div>

      {/* ── Delete confirm dialog ───────────────────────────────── */}
      {pendingDelete && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => !deleteMutation.isPending && setPendingDelete(null)}
        >
          <div className="bg-background rounded-lg shadow-lg p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h4 className="font-semibold mb-2">{t('settings.categoryDeleteTitle')}</h4>
            <p className="text-sm text-muted-foreground mb-4">
              {t('settings.categoryDeleteConfirm', { slug: pendingDelete.slug })}
            </p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setPendingDelete(null)} disabled={deleteMutation.isPending}>
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => deleteMutation.mutate(pendingDelete.id)}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" /> {t('common.delete')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── STORE ADDRESS TAB (#1) ─────────────────────────────────────────────────

function StoreAddressTab({ editingAddress, setEditingAddress }: {
  editingAddress: Record<string, unknown> | null;
  setEditingAddress: (v: Record<string, unknown> | null) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const addressesQuery = useQuery({
    queryKey: ['settings-store-addresses'],
    queryFn: () => adminApi.settings.storeAddresses(),
  });

  const updateMutation = useMutation({
    mutationFn: (addresses: Array<Record<string, unknown>>) => adminApi.settings.updateStoreAddresses(addresses),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-store-addresses'] });
      setEditingAddress(null);
    },
  });

  const addresses = (addressesQuery.data?.data ?? []) as Array<Record<string, unknown>>;

  const handleSave = () => {
    if (!editingAddress) return;
    const existing = [...addresses];
    const idx = existing.findIndex((a) => a.id === editingAddress.id);
    if (idx >= 0) {
      existing[idx] = editingAddress;
    } else {
      existing.push({ ...editingAddress, id: `addr_${Date.now()}` });
    }
    // Ensure only one primary
    if (editingAddress.is_primary) {
      existing.forEach((a) => { if (a.id !== editingAddress.id) a.is_primary = false; });
    }
    updateMutation.mutate(existing);
  };

  const handleDelete = (id: string) => {
    updateMutation.mutate(addresses.filter((a) => a.id !== id));
  };

  const handleSetPrimary = (id: string) => {
    const updated = addresses.map((a) => ({ ...a, is_primary: a.id === id }));
    updateMutation.mutate(updated);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border">
        <div className="p-4 border-b bg-muted/30">
          <h3 className="font-semibold">{t('settings.storeAddressTitle')}</h3>
          <p className="text-xs text-muted-foreground mt-1">{t('settings.storeAddressDesc')}</p>
        </div>
        <div className="divide-y">
          {addresses.map((addr) => (
            <div key={String(addr.id)} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-sm">{String(addr.name || '')}</span>
                    {!!addr.is_primary && <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">{t('settings.primary')}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {[addr.address_line, addr.district, addr.province, addr.postal_code].filter(Boolean).join(', ')}
                  </p>
                  {!!addr.phone && <p className="text-xs text-muted-foreground">{t('settings.phone')}: {String(addr.phone)}</p>}
                  {!!addr.contact_person && <p className="text-xs text-muted-foreground">{t('settings.contactPerson')}: {String(addr.contact_person)}</p>}
                </div>
                <div className="flex gap-1">
                  {!addr.is_primary && (
                    <Button size="sm" variant="outline" onClick={() => handleSetPrimary(String(addr.id))}>
                      {t('settings.setPrimary')}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setEditingAddress({ ...addr })}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" onClick={() => handleDelete(String(addr.id))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {addresses.length === 0 && !editingAddress && (
            <div className="p-8 text-center text-muted-foreground text-sm">{t('settings.noAddresses')}</div>
          )}
        </div>
      </div>

      {editingAddress ? (
        <div className="rounded-lg border p-4 space-y-3">
          <h3 className="font-semibold text-sm">{editingAddress.id ? t('settings.editAddress') : t('settings.addAddress')}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">{t('settings.shopName')}</label>
              <Input value={String(editingAddress.name || '')} onChange={(e) => setEditingAddress({ ...editingAddress, name: e.target.value })} className="h-8" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t('settings.contactPerson')}</label>
              <Input value={String(editingAddress.contact_person || '')} onChange={(e) => setEditingAddress({ ...editingAddress, contact_person: e.target.value })} className="h-8" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t('settings.phone')}</label>
              <Input value={String(editingAddress.phone || '')} onChange={(e) => setEditingAddress({ ...editingAddress, phone: e.target.value })} className="h-8" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t('settings.addressLine')}</label>
              <Input value={String(editingAddress.address_line || '')} onChange={(e) => setEditingAddress({ ...editingAddress, address_line: e.target.value })} className="h-8" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t('settings.province')}</label>
              <Input value={String(editingAddress.province || '')} onChange={(e) => setEditingAddress({ ...editingAddress, province: e.target.value })} className="h-8" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t('settings.district')}</label>
              <Input value={String(editingAddress.district || '')} onChange={(e) => setEditingAddress({ ...editingAddress, district: e.target.value })} className="h-8" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t('settings.subdistrict')}</label>
              <Input value={String(editingAddress.subdistrict || '')} onChange={(e) => setEditingAddress({ ...editingAddress, subdistrict: e.target.value })} className="h-8" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t('settings.postalCode')}</label>
              <Input value={String(editingAddress.postal_code || '')} onChange={(e) => setEditingAddress({ ...editingAddress, postal_code: e.target.value })} className="h-8" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">{t('settings.note')}</label>
            <textarea className="w-full border rounded-md p-2 text-sm h-16 resize-none" value={String(editingAddress.note || '')} onChange={(e) => setEditingAddress({ ...editingAddress, note: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!editingAddress.is_primary} onChange={(e) => setEditingAddress({ ...editingAddress, is_primary: e.target.checked })} />
            {t('settings.markPrimary')}
          </label>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={!editingAddress.name || updateMutation.isPending}>
              <Save className="h-3.5 w-3.5 mr-1" /> {t('common.save')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditingAddress(null)}>{t('common.cancel')}</Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" onClick={() => setEditingAddress({ name: '', is_primary: addresses.length === 0 })}>
          <Plus className="h-4 w-4 mr-2" /> {t('settings.addAddress')}
        </Button>
      )}
    </div>
  );
}

// ─── SHIPPING TAB (#2 + #3) ─────────────────────────────────────────────────

interface ShippingZone {
  id: string;
  zone_name: string;
  base_fee: number;
  provinces: Array<{
    id: string;
    province_code: string;
    province_name: string;
    addon_fee: number;
    shipping_days: number;
  }>;
}

function ShippingTab() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [expandedZones, setExpandedZones] = useState<Set<string>>(new Set());
  const [editingZone, setEditingZone] = useState<string | null>(null);
  const [editBaseFee, setEditBaseFee] = useState('');
  const [editingProvince, setEditingProvince] = useState<string | null>(null);
  const [editAddonFee, setEditAddonFee] = useState('');
  const [editShippingDays, setEditShippingDays] = useState('');
  const [addingToZone, setAddingToZone] = useState<string | null>(null);
  const [newProvinceCode, setNewProvinceCode] = useState('');
  const [newProvinceName, setNewProvinceName] = useState('');
  const [newAddonFee, setNewAddonFee] = useState('0');

  const zonesQuery = useQuery({
    queryKey: ['shipping-zones'],
    queryFn: () => adminApi.shipping.zones(),
  });

  // #36: Global shipping-fee toggle.
  const feeToggleQuery = useQuery({
    queryKey: ['shipping-fee-toggle'],
    queryFn: () => adminApi.shipping.feeToggleStatus(),
  });
  const feeEnabled = feeToggleQuery.data?.data.enabled ?? true;

  const feeToggleMutation = useMutation({
    mutationFn: (enabled: boolean) => adminApi.shipping.setFeeToggle(enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['shipping-fee-toggle'] }),
  });

  const requestFeeToggle = (next: boolean) => {
    if (feeToggleMutation.isPending) return;
    const key = next ? 'shipping.confirmFeeToggleOn' : 'shipping.confirmFeeToggleOff';
    if (!confirm(t(key))) return;
    feeToggleMutation.mutate(next);
  };

  const updateZoneMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { zone_name?: string; base_fee?: number } }) =>
      adminApi.shipping.updateZone(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipping-zones'] });
      setEditingZone(null);
    },
  });

  const updateProvinceMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { addon_fee?: number; shipping_days?: number } }) =>
      adminApi.shipping.updateProvince(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipping-zones'] });
      setEditingProvince(null);
    },
  });

  const addProvinceMutation = useMutation({
    mutationFn: ({ zoneId, body }: { zoneId: string; body: { province_code: string; province_name: string; addon_fee: number } }) =>
      adminApi.shipping.addProvince(zoneId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipping-zones'] });
      setAddingToZone(null);
      setNewProvinceCode('');
      setNewProvinceName('');
      setNewAddonFee('0');
    },
  });

  const deleteProvinceMutation = useMutation({
    mutationFn: (id: string) => adminApi.shipping.deleteProvince(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['shipping-zones'] }),
  });

  const zones = (zonesQuery.data?.data ?? []) as ShippingZone[];

  const toggleZone = (id: string) => {
    setExpandedZones((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border">
        <div className="p-4 border-b bg-muted/30 flex items-center gap-3 flex-wrap">
          <Truck className="h-5 w-5 text-muted-foreground" />
          <div className="flex-1 min-w-[200px]">
            <h3 className="font-semibold">{t('settings.shippingTitle')}</h3>
            <p className="text-xs text-muted-foreground">{t('settings.shippingDesc')}</p>
          </div>
          {/* #36: Global shipping-fee toggle */}
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-medium">{t('shipping.feeToggleLabel')}</div>
              <div className="text-xs text-muted-foreground">
                {feeEnabled ? t('shipping.feeToggleOnHint') : t('shipping.feeToggleOffHint')}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={feeEnabled}
              aria-label={t('shipping.feeToggleLabel')}
              onClick={() => requestFeeToggle(!feeEnabled)}
              disabled={feeToggleMutation.isPending || feeToggleQuery.isLoading}
              className={
                'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60 ' +
                (feeEnabled ? 'bg-primary border-primary' : 'bg-muted border-input')
              }
            >
              <span
                className={
                  'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ' +
                  (feeEnabled ? 'translate-x-5' : 'translate-x-0.5')
                }
              />
            </button>
          </div>
        </div>
      </div>

      {!feeEnabled && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-medium">{t('shipping.freeShippingBannerTitle')}</div>
            <div className="text-amber-800">{t('shipping.freeShippingBannerBody')}</div>
          </div>
        </div>
      )}

      {zonesQuery.isLoading ? (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">{t('common.loading')}</div>
      ) : (
        <div className="space-y-3">
          {zones.map((zone) => (
            <div key={zone.id} className="rounded-lg border">
              <div className="p-3 flex items-center justify-between cursor-pointer hover:bg-muted/30" onClick={() => toggleZone(zone.id)}>
                <div className="flex items-center gap-3">
                  <span className={`transition-transform ${expandedZones.has(zone.id) ? 'rotate-90' : ''}`}>&#9654;</span>
                  <div>
                    <span className="font-medium text-sm">{zone.zone_name}</span>
                    <span className="text-xs text-muted-foreground ml-2">({zone.provinces?.length ?? 0} {t('settings.provinces')})</span>
                  </div>
                </div>
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  {editingZone === zone.id ? (
                    <div className="flex items-center gap-1">
                      <Input value={editBaseFee} onChange={(e) => setEditBaseFee(e.target.value)} className="w-24 h-8" type="number" />
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => updateZoneMutation.mutate({ id: zone.id, body: { base_fee: parseInt(editBaseFee) || 0 } })}>
                        <Save className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setEditingZone(null)}><X className="h-3.5 w-3.5" /></Button>
                    </div>
                  ) : (
                    <>
                      <span
                        className={
                          'text-sm font-mono bg-muted px-2 py-1 rounded ' +
                          (feeEnabled ? '' : 'line-through opacity-60')
                        }
                        title={feeEnabled ? undefined : t('shipping.feeToggleOffHint')}
                      >
                        {t('settings.baseFee')}: {zone.base_fee} THB
                      </span>
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => { setEditingZone(zone.id); setEditBaseFee(String(zone.base_fee)); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {expandedZones.has(zone.id) && (
                <div className="border-t">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-muted/30 text-xs">
                        <th className="p-2 text-left">{t('settings.code')}</th>
                        <th className="p-2 text-left">{t('settings.provinceName')}</th>
                        <th className="p-2 text-right">{t('settings.addonFee')}</th>
                        <th className="p-2 text-right">{t('settings.shippingDays')}</th>
                        <th className="p-2 text-right">{t('settings.actions')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {(zone.provinces ?? []).map((p) => (
                        <tr key={p.id} className="hover:bg-muted/20 text-sm">
                          <td className="p-2 font-mono text-xs">{p.province_code}</td>
                          <td className="p-2">{p.province_name}</td>
                          {editingProvince === p.id ? (
                            <>
                              <td className="p-2 text-right">
                                <Input value={editAddonFee} onChange={(e) => setEditAddonFee(e.target.value)} className="w-20 h-7 text-right ml-auto" type="number" />
                              </td>
                              <td className="p-2 text-right">
                                <Input value={editShippingDays} onChange={(e) => setEditShippingDays(e.target.value)} className="w-16 h-7 text-right ml-auto" type="number" />
                              </td>
                              <td className="p-2 text-right">
                                <div className="flex justify-end gap-1">
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => updateProvinceMutation.mutate({ id: p.id, body: { addon_fee: parseInt(editAddonFee) || 0, shipping_days: parseInt(editShippingDays) || 2 } })}>
                                    <Save className="h-3 w-3" />
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditingProvince(null)}><X className="h-3 w-3" /></Button>
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className={'p-2 text-right font-mono ' + (feeEnabled ? '' : 'line-through opacity-60')}>{p.addon_fee} THB</td>
                              <td className="p-2 text-right">{p.shipping_days} {t('settings.days')}</td>
                              <td className="p-2 text-right">
                                <div className="flex justify-end gap-1">
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditingProvince(p.id); setEditAddonFee(String(p.addon_fee)); setEditShippingDays(String(p.shipping_days)); }}>
                                    <Pencil className="h-3 w-3" />
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => deleteProvinceMutation.mutate(p.id)}>
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {addingToZone === zone.id ? (
                    <div className="p-3 border-t bg-muted/10 flex items-end gap-2">
                      <div>
                        <label className="text-xs text-muted-foreground">{t('settings.code')}</label>
                        <Input value={newProvinceCode} onChange={(e) => setNewProvinceCode(e.target.value)} className="w-20 h-8" placeholder="BKK" />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">{t('settings.provinceName')}</label>
                        <Input value={newProvinceName} onChange={(e) => setNewProvinceName(e.target.value)} className="w-36 h-8" placeholder="Bangkok" />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">{t('settings.addonFee')}</label>
                        <Input value={newAddonFee} onChange={(e) => setNewAddonFee(e.target.value)} className="w-20 h-8" type="number" />
                      </div>
                      <Button size="sm" onClick={() => addProvinceMutation.mutate({ zoneId: zone.id, body: { province_code: newProvinceCode, province_name: newProvinceName, addon_fee: parseInt(newAddonFee) || 0 } })} disabled={!newProvinceCode || !newProvinceName}>
                        <Plus className="h-3.5 w-3.5 mr-1" /> {t('common.save')}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setAddingToZone(null)}>{t('common.cancel')}</Button>
                    </div>
                  ) : (
                    <div className="p-2 border-t">
                      <Button size="sm" variant="ghost" onClick={() => setAddingToZone(zone.id)}>
                        <Plus className="h-3.5 w-3.5 mr-1" /> {t('settings.addProvince')}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
