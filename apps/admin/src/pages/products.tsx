import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Plus, Pencil, Trash2, X } from 'lucide-react';

type FormMode = 'list' | 'create' | 'edit';

export function ProductsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<FormMode>('list');
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state
  const [formSku, setFormSku] = useState('');
  const [formCategory, setFormCategory] = useState('evening');
  const [formNameEn, setFormNameEn] = useState('');
  const [formNameTh, setFormNameTh] = useState('');
  const [formNameZh, setFormNameZh] = useState('');
  const [formDescEn, setFormDescEn] = useState('');
  const [formDescTh, setFormDescTh] = useState('');
  const [formDescZh, setFormDescZh] = useState('');
  const [formSize, setFormSize] = useState('M');
  const [formColor, setFormColor] = useState('');
  const [formPrice1, setFormPrice1] = useState('');
  const [formPrice3, setFormPrice3] = useState('');
  const [formPrice5, setFormPrice5] = useState('');
  const [formDeposit, setFormDeposit] = useState('');
  const [formRefPrice, setFormRefPrice] = useState('');
  const [i18nTab, setI18nTab] = useState<'en' | 'th' | 'zh'>('en');

  const params: Record<string, string> = { page: String(page), per_page: '20' };
  if (search) params.search = search;

  const { data, isLoading } = useQuery({
    queryKey: ['admin-products', params],
    queryFn: () => adminApi.products.list(params),
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => adminApi.products.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => adminApi.products.update(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.products.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-products'] });
    },
  });

  const products = data?.data ?? [];
  const meta = data?.meta;

  function resetForm() {
    setMode('list');
    setEditingId(null);
    setFormSku('');
    setFormCategory('evening');
    setFormNameEn('');
    setFormNameTh('');
    setFormNameZh('');
    setFormDescEn('');
    setFormDescTh('');
    setFormDescZh('');
    setFormSize('M');
    setFormColor('');
    setFormPrice1('');
    setFormPrice3('');
    setFormPrice5('');
    setFormDeposit('');
    setFormRefPrice('');
    setI18nTab('en');
  }

  function handleEdit(product: (typeof products)[0]) {
    setMode('edit');
    setEditingId(product.id);
    setFormSku(product.sku);
    setFormCategory(product.category);
    setFormNameEn(product.name_i18n?.en ?? product.name);
    setFormNameTh(product.name_i18n?.th ?? '');
    setFormNameZh(product.name_i18n?.zh ?? '');
    setFormSize(product.size[0] ?? 'M');
    setFormColor(product.color.join(', '));
    setFormPrice1(String(product.price_1day));
    setFormPrice3(String(product.price_3day));
    setFormPrice5(String(product.price_5day));
    setFormDeposit(String(product.deposit));
  }

  function handleSubmit() {
    const body: Record<string, unknown> = {
      sku: formSku,
      category: formCategory,
      name_i18n: { en: formNameEn, th: formNameTh, zh: formNameZh },
      description_i18n: { en: formDescEn, th: formDescTh, zh: formDescZh },
      size: formSize.split(',').map((s) => s.trim()).filter(Boolean),
      color: formColor.split(',').map((s) => s.trim()).filter(Boolean),
      price_1day: Number(formPrice1),
      price_3day: Number(formPrice3),
      price_5day: Number(formPrice5),
      deposit: Number(formDeposit),
      ref_price: Number(formRefPrice) || 0,
    };

    if (mode === 'edit' && editingId) {
      updateMutation.mutate({ id: editingId, body });
    } else {
      createMutation.mutate(body);
    }
  }

  function handleDelete(id: string) {
    if (window.confirm(t('products.confirmDelete'))) {
      deleteMutation.mutate(id);
    }
  }

  // Form View
  if (mode !== 'list') {
    const isPending = createMutation.isPending || updateMutation.isPending;

    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">
            {mode === 'create' ? t('products.createTitle') : t('products.editTitle')}
          </h1>
          <button onClick={resetForm} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-w-2xl space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">SKU</label>
              <Input value={formSku} onChange={(e) => setFormSku(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium">{t('products.category')}</label>
              <select
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {['wedding', 'evening', 'cocktail', 'casual', 'costume', 'traditional'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {/* i18n Name Tabs */}
          <div>
            <label className="text-sm font-medium">{t('products.name')}</label>
            <div className="flex gap-1 mt-1 mb-2">
              {(['en', 'th', 'zh'] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => setI18nTab(lang)}
                  className={`px-3 py-1 text-xs rounded ${i18nTab === lang ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
                >
                  {lang.toUpperCase()}
                </button>
              ))}
            </div>
            {i18nTab === 'en' && <Input value={formNameEn} onChange={(e) => setFormNameEn(e.target.value)} placeholder="English name" />}
            {i18nTab === 'th' && <Input value={formNameTh} onChange={(e) => setFormNameTh(e.target.value)} placeholder="ชื่อภาษาไทย" />}
            {i18nTab === 'zh' && <Input value={formNameZh} onChange={(e) => setFormNameZh(e.target.value)} placeholder="中文名称" />}
          </div>

          {/* i18n Description */}
          <div>
            <label className="text-sm font-medium">{t('products.description')}</label>
            {i18nTab === 'en' && (
              <textarea value={formDescEn} onChange={(e) => setFormDescEn(e.target.value)} className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm h-24" placeholder="English description" />
            )}
            {i18nTab === 'th' && (
              <textarea value={formDescTh} onChange={(e) => setFormDescTh(e.target.value)} className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm h-24" placeholder="คำอธิบายภาษาไทย" />
            )}
            {i18nTab === 'zh' && (
              <textarea value={formDescZh} onChange={(e) => setFormDescZh(e.target.value)} className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm h-24" placeholder="中文描述" />
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">{t('products.sizes')}</label>
              <Input value={formSize} onChange={(e) => setFormSize(e.target.value)} placeholder="S, M, L" />
            </div>
            <div>
              <label className="text-sm font-medium">{t('products.colors')}</label>
              <Input value={formColor} onChange={(e) => setFormColor(e.target.value)} placeholder="red, blue" />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">{t('products.pricing')}</label>
            <div className="grid grid-cols-3 gap-3 mt-1">
              <div>
                <span className="text-xs text-muted-foreground">1 {t('products.day')}</span>
                <Input type="number" value={formPrice1} onChange={(e) => setFormPrice1(e.target.value)} />
              </div>
              <div>
                <span className="text-xs text-muted-foreground">3 {t('products.days')}</span>
                <Input type="number" value={formPrice3} onChange={(e) => setFormPrice3(e.target.value)} />
              </div>
              <div>
                <span className="text-xs text-muted-foreground">5 {t('products.days')}</span>
                <Input type="number" value={formPrice5} onChange={(e) => setFormPrice5(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">{t('products.deposit')}</label>
              <Input type="number" value={formDeposit} onChange={(e) => setFormDeposit(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium">{t('products.refPrice')}</label>
              <Input type="number" value={formRefPrice} onChange={(e) => setFormRefPrice(e.target.value)} />
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={resetForm}>{t('common.cancel')}</Button>
            <Button onClick={handleSubmit} disabled={isPending || !formSku || !formNameEn}>
              {isPending ? t('common.loading') : mode === 'create' ? t('common.create') : t('common.save')}
            </Button>
          </div>

          {(createMutation.isError || updateMutation.isError) && (
            <p className="text-sm text-destructive">
              {((createMutation.error || updateMutation.error) as Error)?.message}
            </p>
          )}
        </div>
      </div>
    );
  }

  // List View
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('products.title')}</h1>
        <Button onClick={() => setMode('create')}>
          <Plus className="h-4 w-4 mr-2" /> {t('products.addProduct')}
        </Button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t('common.search')}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="pl-9"
        />
      </div>

      <div className="rounded-lg border">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-4 text-sm font-medium">SKU</th>
              <th className="text-left p-4 text-sm font-medium">{t('products.name')}</th>
              <th className="text-left p-4 text-sm font-medium">{t('products.category')}</th>
              <th className="text-right p-4 text-sm font-medium">{t('products.price1d')}</th>
              <th className="text-right p-4 text-sm font-medium">{t('products.deposit')}</th>
              <th className="text-center p-4 text-sm font-medium">{t('products.rentals')}</th>
              <th className="text-right p-4 text-sm font-medium">{t('products.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted-foreground">{t('common.loading')}</td>
              </tr>
            ) : products.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted-foreground">{t('products.empty')}</td>
              </tr>
            ) : (
              products.map((product) => (
                <tr key={product.id} className="border-b">
                  <td className="p-4 font-mono text-xs">{product.sku}</td>
                  <td className="p-4 text-sm">
                    <div className="font-medium">{product.name}</div>
                    {product.brand_name && <div className="text-xs text-muted-foreground">{product.brand_name}</div>}
                  </td>
                  <td className="p-4 text-sm capitalize">{product.category}</td>
                  <td className="p-4 text-sm text-right">{product.price_1day.toLocaleString()}</td>
                  <td className="p-4 text-sm text-right">{product.deposit.toLocaleString()}</td>
                  <td className="p-4 text-sm text-center">{product.rental_count}</td>
                  <td className="p-4 text-right">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => handleEdit(product)} className="p-1 hover:text-primary">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => handleDelete(product.id)} className="p-1 hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {meta && meta.total_pages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}>
            {t('products.prev')}
          </Button>
          <span className="text-sm text-muted-foreground">{page} / {meta.total_pages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage(Math.min(meta.total_pages, page + 1))} disabled={page >= meta.total_pages}>
            {t('products.next')}
          </Button>
        </div>
      )}
    </div>
  );
}
