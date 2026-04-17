import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { adminApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Save, Plus, Trash2, Pencil, X, Shield, User, Bell, Send } from 'lucide-react';

type Tab = 'config' | 'users' | 'audit' | 'notifications';

interface ConfigItem {
  id: string;
  key: string;
  value: string;
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
  const [activeTab, setActiveTab] = useState<Tab>('config');

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

  // Group configs by group
  const groupedConfigs: Record<string, ConfigItem[]> = {};
  configs.forEach((cfg) => {
    const g = cfg.group || 'general';
    if (!groupedConfigs[g]) groupedConfigs[g] = [];
    groupedConfigs[g].push(cfg);
  });

  const startEdit = (cfg: ConfigItem) => {
    setEditingKey(cfg.key);
    setEditValue(cfg.value);
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t('settings.title')}</h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted rounded-lg p-1 mb-6 w-fit">
        {(['config', 'users', 'notifications', 'audit'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
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
                            <span className="text-sm font-mono bg-muted px-2 py-1 rounded">{cfg.value}</span>
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

              {configs.length === 0 && !showAddConfig && (
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
    </div>
  );
}
