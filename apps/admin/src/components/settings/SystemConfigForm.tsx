import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wallet, CalendarDays, Truck, Sparkles, Save, Zap, Search } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { THAI_PROVINCES } from '@/data/thai-provinces';

interface ConfigItem {
  id: string;
  key: string;
  value: unknown;
  label: string | null;
  group: string;
}

type FormState = {
  late_return_fee: string;
  shipping_duration_days: string;
  wash_duration_days: string;
  origin_province: string;
  shipping_days: Record<string, string>; // province_code -> value (string)
};

const DEFAULTS: FormState = {
  late_return_fee: '0',
  shipping_duration_days: '2',
  wash_duration_days: '1',
  origin_province: 'BKK',
  shipping_days: Object.fromEntries(THAI_PROVINCES.map((p) => [p.code, String(p.flashDefaultDays)])),
};

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return String(value);
}

function buildInitialState(configs: ConfigItem[]): FormState {
  const byKey = new Map<string, string>();
  for (const cfg of configs) {
    const v = asString(cfg.value);
    if (v !== null) byKey.set(cfg.key, v);
  }
  return {
    late_return_fee: byKey.get('late_return_fee') ?? DEFAULTS.late_return_fee,
    shipping_duration_days: byKey.get('shipping_duration_days') ?? DEFAULTS.shipping_duration_days,
    wash_duration_days: byKey.get('wash_duration_days') ?? DEFAULTS.wash_duration_days,
    origin_province: byKey.get('origin_province') ?? DEFAULTS.origin_province,
    shipping_days: Object.fromEntries(
      THAI_PROVINCES.map((p) => [p.code, byKey.get(`shipping_days_${p.code}`) ?? String(p.flashDefaultDays)]),
    ),
  };
}

function validateNonNegativeNumber(s: string): string | null {
  if (s.trim() === '') return 'required';
  const n = Number(s);
  if (!Number.isFinite(n)) return 'invalid_number';
  if (n < 0) return 'min_zero';
  return null;
}

function validatePositiveInteger(s: string): string | null {
  if (s.trim() === '') return 'required';
  const n = Number(s);
  if (!Number.isFinite(n)) return 'invalid_number';
  if (!Number.isInteger(n)) return 'must_be_integer';
  if (n < 1) return 'min_one';
  return null;
}

export function SystemConfigForm() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const configQuery = useQuery<{ data: ConfigItem[] }>({
    queryKey: ['settings-config'],
    queryFn: () => adminApi.settings.config(),
  });

  const initialState = useMemo<FormState>(
    () => buildInitialState(configQuery.data?.data ?? []),
    [configQuery.data],
  );

  const [form, setForm] = useState<FormState>(initialState);
  const [provinceFilter, setProvinceFilter] = useState('');

  // Reset form when remote data (re)loads
  useEffect(() => {
    setForm(initialState);
  }, [initialState]);

  const batchMutation = useMutation({
    mutationFn: (updates: Record<string, string>) => adminApi.settings.batchUpdateConfig(updates),
    onSuccess: (res) => {
      const count = res?.data?.updated?.length ?? 0;
      queryClient.invalidateQueries({ queryKey: ['settings-config'] });
      toast(
        count === 0
          ? t('settings.systemConfig.toastNoChanges')
          : t('settings.systemConfig.toastSaved', { count }),
        'success',
      );
    },
    onError: (err: Error) => {
      toast(t('settings.systemConfig.toastError', { error: err.message || 'unknown' }), 'error');
    },
  });

  // Flatten form into key/value pairs for comparison + save
  const flatForm: Record<string, string> = useMemo(() => ({
    late_return_fee: form.late_return_fee,
    shipping_duration_days: form.shipping_duration_days,
    wash_duration_days: form.wash_duration_days,
    origin_province: form.origin_province,
    ...Object.fromEntries(
      THAI_PROVINCES.map((p) => [`shipping_days_${p.code}`, form.shipping_days[p.code] ?? String(p.flashDefaultDays)]),
    ),
  }), [form]);

  const flatInitial: Record<string, string> = useMemo(() => ({
    late_return_fee: initialState.late_return_fee,
    shipping_duration_days: initialState.shipping_duration_days,
    wash_duration_days: initialState.wash_duration_days,
    origin_province: initialState.origin_province,
    ...Object.fromEntries(
      THAI_PROVINCES.map((p) => [`shipping_days_${p.code}`, initialState.shipping_days[p.code] ?? String(p.flashDefaultDays)]),
    ),
  }), [initialState]);

  const changedKeys = useMemo(
    () => Object.keys(flatForm).filter((k) => flatForm[k] !== flatInitial[k]),
    [flatForm, flatInitial],
  );

  // ─── Field validation ─────────────────────────────────────────────────
  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    const err1 = validateNonNegativeNumber(form.late_return_fee);
    if (err1) e.late_return_fee = err1;
    const err2 = validatePositiveInteger(form.shipping_duration_days);
    if (err2) e.shipping_duration_days = err2;
    const err3 = validatePositiveInteger(form.wash_duration_days);
    if (err3) e.wash_duration_days = err3;
    for (const p of THAI_PROVINCES) {
      const v = form.shipping_days[p.code] ?? '';
      const err = validatePositiveInteger(v);
      if (err) e[`shipping_days_${p.code}`] = err;
    }
    return e;
  }, [form]);

  const hasErrors = Object.keys(errors).length > 0;
  const isDirty = changedKeys.length > 0;

  const applyFlashDefaults = () => {
    setForm((prev) => ({
      ...prev,
      shipping_days: Object.fromEntries(
        THAI_PROVINCES.map((p) => [p.code, String(p.flashDefaultDays)]),
      ),
    }));
  };

  const filteredProvinces = useMemo(() => {
    const q = provinceFilter.trim().toLowerCase();
    if (!q) return THAI_PROVINCES;
    return THAI_PROVINCES.filter(
      (p) =>
        p.code.toLowerCase().includes(q) ||
        p.nameEn.toLowerCase().includes(q) ||
        p.nameTh.toLowerCase().includes(q),
    );
  }, [provinceFilter]);

  const provinceLabel = (code: string) => {
    const p = THAI_PROVINCES.find((x) => x.code === code);
    if (!p) return code;
    return i18n.language.startsWith('th') ? p.nameTh : p.nameEn;
  };

  const translateFieldError = (e: string | undefined): string | null => {
    if (!e) return null;
    switch (e) {
      case 'required':
        return t('settings.systemConfig.errRequired');
      case 'invalid_number':
        return t('settings.systemConfig.errInvalidNumber');
      case 'min_zero':
        return t('settings.systemConfig.errMinZero');
      case 'min_one':
        return t('settings.systemConfig.errMinOne');
      case 'must_be_integer':
        return t('settings.systemConfig.errMustBeInteger');
      default:
        return e;
    }
  };

  const handleSave = () => {
    if (!isDirty || hasErrors || batchMutation.isPending) return;
    const updates: Record<string, string> = {};
    for (const k of changedKeys) updates[k] = flatForm[k];
    batchMutation.mutate(updates);
  };

  if (configQuery.isLoading) {
    return (
      <div className="rounded-lg border p-8 text-center text-muted-foreground">
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24">
      {/* Section 1 — Finance / Orders ------------------------------------ */}
      <SectionCard
        icon={<Wallet className="h-5 w-5 text-amber-600" />}
        title={t('settings.systemConfig.section1Title')}
        description={t('settings.systemConfig.section1Desc')}
      >
        <Field
          label={t('settings.systemConfig.lateReturnFeeLabel')}
          helper={t('settings.systemConfig.lateReturnFeeHelper')}
          error={translateFieldError(errors.late_return_fee)}
          htmlFor="cfg-late-return-fee"
          trailing={<span className="text-sm text-muted-foreground">{t('settings.systemConfig.unitBahtPerDay')}</span>}
        >
          <Input
            id="cfg-late-return-fee"
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={form.late_return_fee}
            onChange={(e) => setForm((s) => ({ ...s, late_return_fee: e.target.value }))}
            className="w-40"
          />
        </Field>
      </SectionCard>

      {/* Section 2 — Calendar -------------------------------------------- */}
      <SectionCard
        icon={<CalendarDays className="h-5 w-5 text-sky-600" />}
        title={t('settings.systemConfig.section2Title')}
        description={t('settings.systemConfig.section2Desc')}
      >
        <Field
          label={t('settings.systemConfig.shippingDurationLabel')}
          helper={t('settings.systemConfig.shippingDurationHelper')}
          error={translateFieldError(errors.shipping_duration_days)}
          htmlFor="cfg-shipping-duration"
          trailing={<span className="text-sm text-muted-foreground">{t('settings.systemConfig.unitDays')}</span>}
        >
          <Input
            id="cfg-shipping-duration"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={form.shipping_duration_days}
            onChange={(e) => setForm((s) => ({ ...s, shipping_duration_days: e.target.value }))}
            className="w-40"
          />
        </Field>
        <Field
          label={t('settings.systemConfig.washDurationLabel')}
          helper={t('settings.systemConfig.washDurationHelper')}
          error={translateFieldError(errors.wash_duration_days)}
          htmlFor="cfg-wash-duration"
          trailing={<span className="text-sm text-muted-foreground">{t('settings.systemConfig.unitDays')}</span>}
        >
          <Input
            id="cfg-wash-duration"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={form.wash_duration_days}
            onChange={(e) => setForm((s) => ({ ...s, wash_duration_days: e.target.value }))}
            className="w-40"
          />
        </Field>
      </SectionCard>

      {/* Section 3 — Shipping / Logistics -------------------------------- */}
      <SectionCard
        icon={<Truck className="h-5 w-5 text-emerald-600" />}
        title={t('settings.systemConfig.section3Title')}
        description={t('settings.systemConfig.section3Desc')}
      >
        <Field
          label={t('settings.systemConfig.originProvinceLabel')}
          helper={t('settings.systemConfig.originProvinceHelper')}
          htmlFor="cfg-origin-province"
        >
          <select
            id="cfg-origin-province"
            value={form.origin_province}
            onChange={(e) => setForm((s) => ({ ...s, origin_province: e.target.value }))}
            className="h-9 w-64 rounded-md border border-input bg-background px-3 text-sm"
          >
            {THAI_PROVINCES.map((p) => (
              <option key={p.code} value={p.code}>
                {provinceLabel(p.code)} ({p.code})
              </option>
            ))}
          </select>
        </Field>

        <div className="pt-4 border-t">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h4 className="font-medium text-sm">{t('settings.systemConfig.shippingDaysTableTitle')}</h4>
              <p className="text-xs text-muted-foreground">{t('settings.systemConfig.shippingDaysTableDesc')}</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={applyFlashDefaults}
              className="gap-1.5"
            >
              <Zap className="h-3.5 w-3.5 text-yellow-500" />
              {t('settings.systemConfig.useFlashDefaults')}
            </Button>
          </div>

          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={provinceFilter}
              onChange={(e) => setProvinceFilter(e.target.value)}
              placeholder={t('settings.systemConfig.filterProvinces')}
              className="pl-8 h-9"
            />
          </div>

          <div className="rounded-md border max-h-[420px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="text-left p-2 font-medium text-xs text-muted-foreground w-24">
                    {t('settings.systemConfig.colProvinceCode')}
                  </th>
                  <th className="text-left p-2 font-medium text-xs text-muted-foreground">
                    {t('settings.systemConfig.colProvinceName')}
                  </th>
                  <th className="text-right p-2 font-medium text-xs text-muted-foreground w-48">
                    {t('settings.systemConfig.colShippingDays')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredProvinces.map((p) => {
                  const key = `shipping_days_${p.code}`;
                  const val = form.shipping_days[p.code] ?? '';
                  const err = translateFieldError(errors[key]);
                  const dirty = flatForm[key] !== flatInitial[key];
                  return (
                    <tr key={p.code} className={dirty ? 'bg-amber-50/50' : ''}>
                      <td className="p-2 font-mono text-xs">{p.code}</td>
                      <td className="p-2">{provinceLabel(p.code)}</td>
                      <td className="p-2">
                        <div className="flex items-center justify-end gap-2">
                          <Input
                            type="number"
                            min={1}
                            step={1}
                            inputMode="numeric"
                            value={val}
                            onChange={(e) =>
                              setForm((s) => ({
                                ...s,
                                shipping_days: { ...s.shipping_days, [p.code]: e.target.value },
                              }))
                            }
                            aria-invalid={!!err}
                            className={`h-8 w-24 text-right ${err ? 'border-red-500' : ''}`}
                          />
                          <span className="text-xs text-muted-foreground w-10">
                            {t('settings.systemConfig.unitDays')}
                          </span>
                        </div>
                        {err && <p className="text-xs text-red-600 mt-1 text-right">{err}</p>}
                      </td>
                    </tr>
                  );
                })}
                {filteredProvinces.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-6 text-center text-sm text-muted-foreground">
                      {t('settings.systemConfig.noProvinceMatch')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </SectionCard>

      {/* Section 4 — Customer UX placeholder ----------------------------- */}
      <SectionCard
        icon={<Sparkles className="h-5 w-5 text-pink-600" />}
        title={t('settings.systemConfig.section4Title')}
        description={t('settings.systemConfig.section4Desc')}
      >
        <div className="rounded-md border border-dashed bg-muted/30 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {t('settings.systemConfig.section4Placeholder')}
          </p>
        </div>
      </SectionCard>

      {/* Sticky Save bar ------------------------------------------------- */}
      <div className="sticky bottom-0 left-0 right-0 -mx-6 -mb-6 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75 border-t px-6 py-3 flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {hasErrors
            ? t('settings.systemConfig.hasErrors')
            : isDirty
              ? t('settings.systemConfig.unsavedChanges', { count: changedKeys.length })
              : t('settings.systemConfig.noChanges')}
        </div>
        <Button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || hasErrors || batchMutation.isPending}
          className="gap-2"
        >
          <Save className="h-4 w-4" />
          {batchMutation.isPending ? t('common.loading') : t('settings.systemConfig.saveAll')}
        </Button>
      </div>
    </div>
  );
}

// ─── Presentational helpers ─────────────────────────────────────────────

function SectionCard({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card">
      <header className="flex items-start gap-3 p-4 border-b bg-muted/20">
        <div className="mt-0.5 shrink-0">{icon}</div>
        <div>
          <h3 className="font-semibold text-base leading-tight">{title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
      </header>
      <div className="p-4 space-y-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  helper,
  error,
  htmlFor,
  children,
  trailing,
}: {
  label: string;
  helper?: string;
  error?: string | null;
  htmlFor?: string;
  children: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="grid md:grid-cols-[1fr_auto] gap-3 items-start">
      <div>
        <label htmlFor={htmlFor} className="text-sm font-medium block">
          {label}
        </label>
        {helper && <p className="text-xs text-muted-foreground mt-0.5">{helper}</p>}
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      </div>
      <div className="flex items-center gap-2">
        {children}
        {trailing}
      </div>
    </div>
  );
}
