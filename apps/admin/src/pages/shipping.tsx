import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Truck, MapPin, Edit2, Save, X, Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';

interface ProvinceConfig {
  id?: string;
  province_code: string;
  province_name?: string;
  addon_fee: number;
  shipping_days?: number;
  total_fee?: number;
}

interface ZoneData {
  id: string;
  zone_name: string;
  base_fee: number;
  provinces: ProvinceConfig[];
}

export function ShippingPage() {
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

  const { data: zonesData, isLoading } = useQuery({
    queryKey: ['shipping-zones'],
    queryFn: () => adminApi.shipping.zones(),
  });

  const updateZoneMutation = useMutation({
    mutationFn: ({ zoneId, body }: { zoneId: string; body: { base_fee: number } }) =>
      adminApi.shipping.updateZone(zoneId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipping-zones'] });
      setEditingZone(null);
    },
  });

  const updateProvinceMutation = useMutation({
    mutationFn: ({ provinceId, body }: { provinceId: string; body: { addon_fee?: number; shipping_days?: number } }) =>
      adminApi.shipping.updateProvince(provinceId, body),
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
    mutationFn: (provinceId: string) => adminApi.shipping.deleteProvince(provinceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipping-zones'] });
    },
  });

  const zones: ZoneData[] = zonesData?.data ?? [];
  const totalProvinces = zones.reduce((sum, z) => sum + z.provinces.length, 0);

  function toggleZone(zoneId: string) {
    setExpandedZones((prev) => {
      const next = new Set(prev);
      if (next.has(zoneId)) next.delete(zoneId);
      else next.add(zoneId);
      return next;
    });
  }

  function startEditZone(zone: ZoneData) {
    setEditingZone(zone.id);
    setEditBaseFee(String(zone.base_fee));
  }

  function saveZone(zoneId: string) {
    updateZoneMutation.mutate({ zoneId, body: { base_fee: Number(editBaseFee) } });
  }

  function startEditProvince(province: ProvinceConfig) {
    setEditingProvince(province.id ?? null);
    setEditAddonFee(String(province.addon_fee));
    setEditShippingDays(String(province.shipping_days ?? 2));
  }

  function saveProvince(provinceId: string) {
    updateProvinceMutation.mutate({ provinceId, body: { addon_fee: Number(editAddonFee), shipping_days: Number(editShippingDays) } });
  }

  function addProvince(zoneId: string) {
    addProvinceMutation.mutate({
      zoneId,
      body: {
        province_code: newProvinceCode.toUpperCase(),
        province_name: newProvinceName,
        addon_fee: Number(newAddonFee),
      },
    });
  }

  if (isLoading) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">{t('shipping.title')}</h1>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-lg border bg-card p-6 animate-pulse">
              <div className="h-6 w-48 bg-muted rounded mb-3" />
              <div className="h-4 w-32 bg-muted rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{t('shipping.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('shipping.subtitle', { zones: zones.length, provinces: totalProvinces })}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {zones.map((zone) => {
          const isExpanded = expandedZones.has(zone.id);
          const isEditingThisZone = editingZone === zone.id;

          return (
            <div key={zone.id} className="rounded-lg border bg-card overflow-hidden">
              {/* Zone header */}
              <div className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/30" onClick={() => toggleZone(zone.id)}>
                {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                <Truck className="h-5 w-5 text-primary" />
                <div className="flex-1">
                  <h3 className="font-semibold">{zone.zone_name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {zone.provinces.length} {t('shipping.provinces')}
                  </p>
                </div>
                <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                  {isEditingThisZone ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">{t('shipping.baseFee')}:</span>
                      <Input
                        type="number"
                        value={editBaseFee}
                        onChange={(e) => setEditBaseFee(e.target.value)}
                        className="w-24 h-8"
                      />
                      <span className="text-sm">THB</span>
                      <Button size="sm" variant="ghost" onClick={() => saveZone(zone.id)} disabled={updateZoneMutation.isPending}>
                        <Save className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingZone(null)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <span className="text-sm font-medium bg-primary/10 text-primary px-2 py-1 rounded">
                        {t('shipping.baseFee')}: {zone.base_fee} THB
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => startEditZone(zone)}>
                        <Edit2 className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {/* Expanded province list */}
              {isExpanded && (
                <div className="border-t">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/40">
                        <th className="text-left px-4 py-2 font-medium">{t('shipping.code')}</th>
                        <th className="text-left px-4 py-2 font-medium">{t('shipping.provinceName')}</th>
                        <th className="text-right px-4 py-2 font-medium">{t('shipping.addonFee')}</th>
                        <th className="text-right px-4 py-2 font-medium">{t('shipping.shippingDays')}</th>
                        <th className="text-right px-4 py-2 font-medium">{t('shipping.totalFee')}</th>
                        <th className="text-right px-4 py-2 font-medium w-24">{t('shipping.actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {zone.provinces.map((province) => {
                        const isEditingThis = editingProvince === province.id;
                        return (
                          <tr key={province.id} className="border-t hover:bg-muted/20">
                            <td className="px-4 py-2">
                              <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{province.province_code}</span>
                            </td>
                            <td className="px-4 py-2 flex items-center gap-2">
                              <MapPin className="h-3 w-3 text-muted-foreground" />
                              {province.province_name ?? province.province_code}
                            </td>
                            <td className="px-4 py-2 text-right">
                              {isEditingThis ? (
                                <Input
                                  type="number"
                                  value={editAddonFee}
                                  onChange={(e) => setEditAddonFee(e.target.value)}
                                  className="w-20 h-7 text-right"
                                />
                              ) : (
                                <span>{province.addon_fee} THB</span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-right">
                              {isEditingThis ? (
                                <Input
                                  type="number"
                                  value={editShippingDays}
                                  onChange={(e) => setEditShippingDays(e.target.value)}
                                  className="w-16 h-7 text-right"
                                  min={1}
                                  max={30}
                                />
                              ) : (
                                <span>{province.shipping_days ?? 2} {t('shipping.days')}</span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-right font-medium">
                              {(province.total_fee ?? (zone.base_fee + province.addon_fee))} THB
                            </td>
                            <td className="px-4 py-2 text-right">
                              {isEditingThis ? (
                                <div className="flex items-center justify-end gap-1">
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => saveProvince(province.id!)}>
                                    <Save className="h-3 w-3" />
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditingProvince(null)}>
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex items-center justify-end gap-1">
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => startEditProvince(province)}>
                                    <Edit2 className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                    onClick={() => {
                                      if (confirm(t('shipping.confirmDelete', { name: province.province_name ?? province.province_code }))) {
                                        deleteProvinceMutation.mutate(province.id!);
                                      }
                                    }}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {/* Add province form */}
                  {addingToZone === zone.id ? (
                    <div className="p-4 border-t bg-muted/20 flex items-center gap-3">
                      <Input
                        placeholder={t('shipping.codePlaceholder')}
                        value={newProvinceCode}
                        onChange={(e) => setNewProvinceCode(e.target.value)}
                        className="w-24 h-8"
                      />
                      <Input
                        placeholder={t('shipping.namePlaceholder')}
                        value={newProvinceName}
                        onChange={(e) => setNewProvinceName(e.target.value)}
                        className="flex-1 h-8"
                      />
                      <Input
                        type="number"
                        placeholder={t('shipping.addonFee')}
                        value={newAddonFee}
                        onChange={(e) => setNewAddonFee(e.target.value)}
                        className="w-24 h-8"
                      />
                      <Button
                        size="sm"
                        onClick={() => addProvince(zone.id)}
                        disabled={!newProvinceCode || !newProvinceName || addProvinceMutation.isPending}
                      >
                        {t('shipping.add')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setAddingToZone(null)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <div className="p-3 border-t">
                      <Button size="sm" variant="outline" onClick={() => setAddingToZone(zone.id)}>
                        <Plus className="h-3 w-3 mr-1" /> {t('shipping.addProvince')}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
