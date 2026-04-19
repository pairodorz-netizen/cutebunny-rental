import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Save, Plus, Trash2, Pencil, X, Shield, User, Bell, Send, GripVertical, MapPin, Truck, Tag } from 'lucide-react';

type Tab = 'config' | 'users' | 'audit' | 'notifications' | 'categories' | 'store' | 'shipping';

interface ConfigItem {
  id: string;
  key: string;
  value: unknown;
  label: string | null;
  group: string;
}

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
  created_at: string;
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

  // Category state (#6)
  const [newCategory, setNewCategory] = useState('');
  const [editingCategory, setEditingCategory] = useState<{ index: number; value: string } | null>(null);

  // Store address state (#1)
  const [editingAddress, setEditingAddress] = useState<Record<string, unknown> | null>(null);

  // Config state
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showAddConfig, setShowAddConfig] = useState(false);
  const [newConfigKey, setNewConfigKey] = useState('');
  const [newConfigValue, setNewConfigValue] = useState('');
  const [newConfigLabel, setNewConfigLabel] = useState('');
  const [newConfigGroup, setNewConfigGroup] = useState('general');

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

  // Audit state
  const [auditPage, setAuditPage] = useState(1);

  const configQuery = useQuery({
    queryKey: ['settings-config'],
    queryFn: () => adminApi.settings.config(),
    enabled: activeTab === 'config',
  });

  const usersQuery = useQuery({
    queryKey: ['settings-users'],
    queryFn: () => adminApi.settings.users(),
    enabled: activeTab === 'users',
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

  const auditQuery = useQuery({
    queryKey: ['settings-audit', auditPage],
    queryFn: () => adminApi.settings.auditLog({ page: String(auditPage), per_page: '30' }),
    enabled: activeTab === 'audit',
  });

  const updateConfigMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      adminApi.settings.updateConfig(key, { value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-config'] });
      setEditingKey(null);
    },
  });

  const createConfigMutation = useMutation({
    mutationFn: (body: { key: string; value: string; label?: string; group?: string }) =>
      adminApi.settings.createConfig(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-config'] });
      setShowAddConfig(false);
      setNewConfigKey('');
      setNewConfigValue('');
      setNewConfigLabel('');
      setNewConfigGroup('general');
    },
  });

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

  const configs = (configQuery.data?.data ?? []) as ConfigItem[];
  const users = (usersQuery.data?.data ?? []) as AdminUserItem[];
  const notifData = notifQuery.data as { data: NotificationItem[]; meta: { page: number; per_page: number; total: number; total_pages: number } } | undefined;
  const auditData = auditQuery.data as { data: AuditLogItem[]; meta: { page: number; per_page: number; total: number; total_pages: number } } | undefined;

  // Filter out internal configs managed by dedicated tabs (Categories, Store Address)
  const visibleConfigs = configs.filter((cfg) => !['product_categories', 'store_addresses'].includes(cfg.key));

  // Group configs by group
  const groupedConfigs: Record<string, ConfigItem[]> = {};
  visibleConfigs.forEach((cfg) => {
    const g = cfg.group || 'general';
    if (!groupedConfigs[g]) groupedConfigs[g] = [];
    groupedConfigs[g].push(cfg);
  });

  const startEdit = (cfg: ConfigItem) => {
    setEditingKey(cfg.key);
    setEditValue(typeof cfg.value === 'string' ? cfg.value : JSON.stringify(cfg.value));
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t('settings.title')}</h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted rounded-lg p-1 mb-6 w-fit flex-wrap">
        {(['config', 'categories', 'store', 'shipping', 'users', 'notifications', 'audit'] as Tab[]).map((tab) => (
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

      {/* Config Tab */}
      {activeTab === 'config' && (
        <div className="space-y-6">
          {configQuery.isLoading ? (
            <div className="rounded-lg border p-8 text-center text-muted-foreground">{t('common.loading')}</div>
          ) : (
            <>
              {Object.entries(groupedConfigs).map(([group, items]) => (
                <div key={group} className="rounded-lg border">
                  <div className="p-4 border-b bg-muted/30">
                    <h3 className="font-semibold capitalize">{group.replace(/_/g, ' ')}</h3>
                  </div>
                  <div className="divide-y">
                    {items.map((cfg) => (
                      <div key={cfg.key} className="flex items-center justify-between p-3 gap-4">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{cfg.label || cfg.key}</p>
                          <p className="text-xs text-muted-foreground font-mono">{cfg.key}</p>
                        </div>
                        {editingKey === cfg.key ? (
                          <div className="flex items-center gap-2">
                            <Input
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="w-48 h-8"
                            />
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0"
                              disabled={updateConfigMutation.isPending}
                              onClick={() => updateConfigMutation.mutate({ key: cfg.key, value: editValue })}
                            >
                              <Save className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setEditingKey(null)}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-mono bg-muted px-2 py-1 rounded">{typeof cfg.value === 'string' ? cfg.value : JSON.stringify(cfg.value)}</span>
                            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => startEdit(cfg)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {visibleConfigs.length === 0 && !showAddConfig && (
                <div className="rounded-lg border p-8 text-center text-muted-foreground">
                  {t('settings.noConfig')}
                </div>
              )}

              {showAddConfig ? (
                <div className="rounded-lg border p-4 space-y-3">
                  <h3 className="font-semibold text-sm">{t('settings.addConfig')}</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground">{t('settings.configKey')}</label>
                      <Input value={newConfigKey} onChange={(e) => setNewConfigKey(e.target.value)} placeholder="late_fee_per_day" className="h-8" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">{t('settings.configValue')}</label>
                      <Input value={newConfigValue} onChange={(e) => setNewConfigValue(e.target.value)} placeholder="200" className="h-8" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">{t('settings.configLabel')}</label>
                      <Input value={newConfigLabel} onChange={(e) => setNewConfigLabel(e.target.value)} placeholder="Late Fee Per Day (THB)" className="h-8" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">{t('settings.configGroup')}</label>
                      <Input value={newConfigGroup} onChange={(e) => setNewConfigGroup(e.target.value)} placeholder="fees" className="h-8" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={!newConfigKey || !newConfigValue || createConfigMutation.isPending}
                      onClick={() => createConfigMutation.mutate({
                        key: newConfigKey, value: newConfigValue,
                        label: newConfigLabel || undefined, group: newConfigGroup || 'general',
                      })}
                    >
                      <Save className="h-3.5 w-3.5 mr-1" /> {t('common.save')}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setShowAddConfig(false)}>
                      {t('common.cancel')}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="outline" onClick={() => setShowAddConfig(true)}>
                  <Plus className="h-4 w-4 mr-2" /> {t('settings.addConfig')}
                </Button>
              )}
            </>
          )}
        </div>
      )}

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
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">{t('settings.resource')}</th>
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
                          <td className="p-3 text-sm">
                            {log.resource.replace(/_/g, ' ')}
                            {log.resource_id && <span className="text-xs text-muted-foreground ml-1 font-mono">#{log.resource_id.slice(0, 8)}</span>}
                          </td>
                          <td className="p-3 text-xs text-muted-foreground max-w-[200px] truncate">
                            {log.details ? JSON.stringify(log.details) : '-'}
                          </td>
                        </tr>
                      ))}
                      {auditData.data.length === 0 && (
                        <tr>
                          <td colSpan={5} className="p-8 text-center text-muted-foreground text-sm">{t('settings.noAuditLogs')}</td>
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
      {/* Categories Tab (#6) */}
      {activeTab === 'categories' && <CategoriesTab newCategory={newCategory} setNewCategory={setNewCategory} editingCategory={editingCategory} setEditingCategory={setEditingCategory} />}

      {/* Store Address Tab (#1) */}
      {activeTab === 'store' && <StoreAddressTab editingAddress={editingAddress} setEditingAddress={setEditingAddress} />}

      {/* Shipping Tab (#2 + #3) */}
      {activeTab === 'shipping' && <ShippingTab />}
    </div>
  );
}

// ─── CATEGORIES TAB (#6) ────────────────────────────────────────────────────

function CategoriesTab({ newCategory, setNewCategory, editingCategory, setEditingCategory }: {
  newCategory: string;
  setNewCategory: (v: string) => void;
  editingCategory: { index: number; value: string } | null;
  setEditingCategory: (v: { index: number; value: string } | null) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const categoriesQuery = useQuery({
    queryKey: ['settings-categories'],
    queryFn: () => adminApi.settings.categories(),
  });

  const updateMutation = useMutation({
    mutationFn: (categories: string[]) => adminApi.settings.updateCategories(categories),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-categories'] });
      setNewCategory('');
      setEditingCategory(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => adminApi.settings.deleteCategory(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-categories'] });
      setDeleteError(null);
    },
    onError: (err: Error) => {
      setDeleteError(err.message);
    },
  });

  const categories = categoriesQuery.data?.data ?? [];

  const handleAdd = () => {
    if (!newCategory.trim()) return;
    const updated = [...categories, newCategory.trim().toLowerCase()];
    updateMutation.mutate(updated);
  };

  const handleRename = () => {
    if (!editingCategory || !editingCategory.value.trim()) return;
    const updated = [...categories];
    updated[editingCategory.index] = editingCategory.value.trim().toLowerCase();
    updateMutation.mutate(updated);
  };

  const handleReorder = (from: number, to: number) => {
    const updated = [...categories];
    const [moved] = updated.splice(from, 1);
    updated.splice(to, 0, moved);
    updateMutation.mutate(updated);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border">
        <div className="p-4 border-b bg-muted/30">
          <h3 className="font-semibold">{t('settings.categoriesTitle')}</h3>
          <p className="text-xs text-muted-foreground mt-1">{t('settings.categoriesDesc')}</p>
        </div>
        <div className="divide-y">
          {categories.map((cat, i) => (
            <div key={`${cat}-${i}`} className="flex items-center justify-between p-3 gap-4">
              <div className="flex items-center gap-2">
                <div className="flex flex-col gap-0.5">
                  <button onClick={() => i > 0 && handleReorder(i, i - 1)} className="text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={i === 0}>
                    <svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 2L2 6h8z" fill="currentColor"/></svg>
                  </button>
                  <button onClick={() => i < categories.length - 1 && handleReorder(i, i + 1)} className="text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={i === categories.length - 1}>
                    <svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 10l4-4H2z" fill="currentColor"/></svg>
                  </button>
                </div>
                {editingCategory?.index === i ? (
                  <div className="flex items-center gap-2">
                    <Input value={editingCategory.value} onChange={(e) => setEditingCategory({ index: i, value: e.target.value })} className="w-40 h-8" />
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={handleRename} disabled={updateMutation.isPending}>
                      <Save className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setEditingCategory(null)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <span className="text-sm font-medium capitalize">{cat}</span>
                )}
              </div>
              {editingCategory?.index !== i && (
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setEditingCategory({ index: i, value: cat })}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" onClick={() => deleteMutation.mutate(cat)} disabled={deleteMutation.isPending}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {deleteError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {deleteError}
        </div>
      )}

      <div className="flex gap-2">
        <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder={t('settings.newCategoryPlaceholder')} className="w-60 h-9" onKeyDown={(e) => e.key === 'Enter' && handleAdd()} />
        <Button size="sm" onClick={handleAdd} disabled={!newCategory.trim() || updateMutation.isPending}>
          <Plus className="h-4 w-4 mr-1" /> {t('settings.addCategory')}
        </Button>
      </div>
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
        <div className="p-4 border-b bg-muted/30 flex items-center gap-2">
          <Truck className="h-5 w-5 text-muted-foreground" />
          <div>
            <h3 className="font-semibold">{t('settings.shippingTitle')}</h3>
            <p className="text-xs text-muted-foreground">{t('settings.shippingDesc')}</p>
          </div>
        </div>
      </div>

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
                      <span className="text-sm font-mono bg-muted px-2 py-1 rounded">{t('settings.baseFee')}: {zone.base_fee} THB</span>
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
                              <td className="p-2 text-right font-mono">{p.addon_fee} THB</td>
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
