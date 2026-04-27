'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { User, Package, Clock, Edit3, Mail, Phone, MapPin } from 'lucide-react';

interface ProfileData {
  name: string;
  email: string;
  phone: string;
  address: string;
}

interface RentalHistoryItem {
  id: string;
  orderNumber: string;
  productName: string;
  thumbnail: string | null;
  rentalDays: number;
  rentalStart: string;
  status: string;
  total: number;
}

export default function ProfilePage() {
  const t = useTranslations('profile');

  const [isEditing, setIsEditing] = useState(false);
  const [profile, setProfile] = useState<ProfileData>({
    name: '',
    email: '',
    phone: '',
    address: '',
  });
  const [editForm, setEditForm] = useState<ProfileData>(profile);

  // Placeholder rental history
  const [rentalHistory] = useState<RentalHistoryItem[]>([]);

  function handleSave() {
    setProfile(editForm);
    setIsEditing(false);
  }

  function handleCancel() {
    setEditForm(profile);
    setIsEditing(false);
  }

  const statusColor: Record<string, string> = {
    unpaid: 'bg-yellow-100 text-yellow-700',
    paid_locked: 'bg-blue-100 text-blue-700',
    shipped: 'bg-purple-100 text-purple-700',
    returned: 'bg-green-100 text-green-700',
    cleaning: 'bg-orange-100 text-orange-700',
    ready: 'bg-emerald-100 text-emerald-700',
  };

  return (
    <div className="bg-cb-surface min-h-screen">
      <div className="container py-8">
        <h1 className="text-2xl md:text-3xl font-display font-semibold text-cb-heading mb-8">
          {t('title')}
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Profile Card */}
          <div className="lg:col-span-1">
            <div className="rounded-2xl bg-white p-6 shadow-soft">
              <div className="flex flex-col items-center text-center mb-6">
                <div className="w-20 h-20 rounded-full bg-cb-purple/10 flex items-center justify-center mb-4">
                  <User className="h-10 w-10 text-cb-purple" />
                </div>
                <h2 className="text-lg font-semibold text-cb-heading">
                  {profile.name || t('guestUser')}
                </h2>
                <p className="text-sm text-cb-secondary mt-1">
                  {profile.email || t('noEmail')}
                </p>
              </div>

              {!isEditing ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Mail className="h-4 w-4 text-cb-secondary shrink-0" />
                    <span className="text-sm text-cb-heading">{profile.email || '-'}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Phone className="h-4 w-4 text-cb-secondary shrink-0" />
                    <span className="text-sm text-cb-heading">{profile.phone || '-'}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <MapPin className="h-4 w-4 text-cb-secondary shrink-0" />
                    <span className="text-sm text-cb-heading">{profile.address || '-'}</span>
                  </div>
                  <button
                    onClick={() => { setEditForm(profile); setIsEditing(true); }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-cb-active text-white text-sm font-medium hover:brightness-110 transition-all mt-4"
                  >
                    <Edit3 className="h-4 w-4" />
                    {t('editProfile')}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-cb-secondary">{t('name')}</label>
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className="w-full mt-1 rounded-xl border border-border px-3 py-2 text-sm text-cb-heading focus:outline-none focus:ring-2 focus:ring-cb-active/50"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-cb-secondary">{t('email')}</label>
                    <input
                      type="email"
                      value={editForm.email}
                      onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                      className="w-full mt-1 rounded-xl border border-border px-3 py-2 text-sm text-cb-heading focus:outline-none focus:ring-2 focus:ring-cb-active/50"
                    />
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
                  <div>
                    <label className="text-xs text-cb-secondary">{t('address')}</label>
                    <textarea
                      value={editForm.address}
                      onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                      rows={2}
                      className="w-full mt-1 rounded-xl border border-border px-3 py-2 text-sm text-cb-heading focus:outline-none focus:ring-2 focus:ring-cb-active/50 resize-none"
                    />
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={handleSave}
                      className="flex-1 py-2.5 rounded-xl bg-cb-active text-white text-sm font-medium hover:brightness-110 transition-all"
                    >
                      {t('save')}
                    </button>
                    <button
                      onClick={handleCancel}
                      className="flex-1 py-2.5 rounded-xl border border-border text-cb-heading text-sm font-medium hover:bg-cb-surface transition-all"
                    >
                      {t('cancel')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Rental History */}
          <div className="lg:col-span-2">
            <div className="rounded-2xl bg-white p-6 shadow-soft">
              <div className="flex items-center gap-2 mb-6">
                <Clock className="h-5 w-5 text-cb-heading" />
                <h2 className="text-lg font-semibold text-cb-heading">{t('rentalHistory')}</h2>
              </div>

              {rentalHistory.length === 0 ? (
                <div className="text-center py-12">
                  <Package className="h-12 w-12 text-cb-secondary/40 mx-auto mb-4" />
                  <p className="text-sm text-cb-secondary">{t('noHistory')}</p>
                  <p className="text-xs text-cb-secondary mt-1">{t('noHistoryHint')}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {rentalHistory.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-4 p-4 rounded-xl border border-border hover:shadow-soft transition-all"
                    >
                      <div className="w-16 h-20 rounded-lg bg-muted overflow-hidden shrink-0">
                        {item.thumbnail && (
                          <img src={item.thumbnail} alt={item.productName} className="w-full h-full object-cover" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-cb-heading truncate">{item.productName}</p>
                        <p className="text-xs text-cb-secondary mt-0.5">
                          {item.orderNumber} • {item.rentalDays} วัน • {item.rentalStart}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`inline-block text-xs font-medium px-2 py-1 rounded-full ${statusColor[item.status] || 'bg-gray-100 text-gray-700'}`}>
                          {item.status}
                        </span>
                        <p className="text-sm font-semibold text-cb-heading mt-1">
                          ฿{item.total.toLocaleString()}
                        </p>
                      </div>
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
