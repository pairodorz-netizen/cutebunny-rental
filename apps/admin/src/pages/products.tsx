import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, type ProductROI, type ProductMetrics, type BulkImportResult } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Plus, Pencil, Trash2, X, ArrowLeft, TrendingUp, TrendingDown, Minus, BarChart3, Upload, Image, Download, FileSpreadsheet, FileUp, Check, AlertCircle } from 'lucide-react';

type FormMode = 'list' | 'create' | 'edit' | 'detail' | 'bulk_import';

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
    setFormSize(product.size?.join(', ') ?? 'M');
    setFormColor(product.color?.join(', ') ?? '');
    setFormPrice1(String(product.rental_prices['1day']));
    setFormPrice3(String(product.rental_prices['3day']));
    setFormPrice5(String(product.rental_prices['5day']));
    setFormDeposit(String(product.deposit));
  }

  function handleSubmit() {
    const body: Record<string, unknown> = {
      sku: formSku,
      name: formNameEn,
      category: formCategory,
      name_i18n: { en: formNameEn, th: formNameTh, zh: formNameZh },
      description: formDescEn,
      description_i18n: { en: formDescEn, th: formDescTh, zh: formDescZh },
      size: formSize.split(',').map((s) => s.trim()).filter(Boolean),
      color: formColor.split(',').map((s) => s.trim()).filter(Boolean),
      rental_price_1day: Number(formPrice1),
      rental_price_3day: Number(formPrice3),
      rental_price_5day: Number(formPrice5),
      deposit: Number(formDeposit),
      retail_price: Number(formRefPrice) || 0,
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

  // Detail View with ROI & Metrics
  if (mode === 'detail' && editingId) {
    return <ProductDetailView productId={editingId} onBack={resetForm} />;
  }

  // Bulk Import View
  if (mode === 'bulk_import') {
    return <BulkImportView onBack={resetForm} onComplete={() => { resetForm(); queryClient.invalidateQueries({ queryKey: ['admin-products'] }); }} />;
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

          {/* Image Upload (only in edit mode — product must exist first) */}
          {mode === 'edit' && editingId && (
            <ProductImageManager productId={editingId} />
          )}

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
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => {
            const token = localStorage.getItem('auth-storage');
            const parsed = token ? JSON.parse(token) : null;
            const jwt = parsed?.state?.token;
            const url = adminApi.products.templateUrl();
            const a = document.createElement('a');
            a.href = jwt ? `${url}?token=${jwt}` : url;
            a.download = 'cutebunny-products-template.csv';
            a.click();
          }}>
            <Download className="h-4 w-4 mr-1" /> {t('products.downloadTemplate')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => {
            const token = localStorage.getItem('auth-storage');
            const parsed = token ? JSON.parse(token) : null;
            const jwt = parsed?.state?.token;
            const url = adminApi.products.exportUrl();
            const a = document.createElement('a');
            a.href = jwt ? `${url}?token=${jwt}` : url;
            a.download = 'cutebunny-products-export.csv';
            a.click();
          }}>
            <FileSpreadsheet className="h-4 w-4 mr-1" /> {t('products.exportCsv')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setMode('bulk_import')}>
            <FileUp className="h-4 w-4 mr-1" /> {t('products.bulkImport')}
          </Button>
          <Button onClick={() => setMode('create')}>
            <Plus className="h-4 w-4 mr-2" /> {t('products.addProduct')}
          </Button>
        </div>
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
                    <button onClick={() => { setMode('detail'); setEditingId(product.id); }} className="text-left hover:text-primary">
                      <div className="font-medium">{product.name}</div>
                      {product.brand && <div className="text-xs text-muted-foreground">{product.brand}</div>}
                    </button>
                  </td>
                  <td className="p-4 text-sm capitalize">{product.category}</td>
                  <td className="p-4 text-sm text-right">{product.rental_prices['1day'].toLocaleString()}</td>
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

function BulkImportView({ onBack, onComplete }: { onBack: () => void; onComplete: () => void }) {
  const { t } = useTranslation();
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<BulkImportResult | null>(null);
  const [importResult, setImportResult] = useState<BulkImportResult | null>(null);
  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload');
  const [validationErrors, setValidationErrors] = useState<Array<{ row: number; field: string; message: string }> | null>(null);

  const previewMutation = useMutation({
    mutationFn: (csv: string) => adminApi.products.bulkImport(csv, true),
    onSuccess: (data) => {
      setPreview(data.data);
      setValidationErrors(null);
      setStep('preview');
    },
    onError: (err: Error & { cause?: { details?: { errors?: Array<{ row: number; field: string; message: string }> } } }) => {
      try {
        const parsed = JSON.parse(err.message.replace(/^.*?(\{)/, '$1'));
        if (parsed?.errors) {
          setValidationErrors(parsed.errors);
        }
      } catch {
        setValidationErrors(null);
      }
    },
  });

  const importMutation = useMutation({
    mutationFn: (csv: string) => adminApi.products.bulkImport(csv, false),
    onSuccess: (data) => {
      setImportResult(data.data);
      setStep('done');
    },
  });

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setCsvText(text);
    };
    reader.readAsText(file);
  }

  function handlePreview() {
    if (!csvText.trim()) return;
    previewMutation.mutate(csvText);
  }

  function handleConfirmImport() {
    if (!csvText.trim()) return;
    importMutation.mutate(csvText);
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-1 hover:bg-muted rounded">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-2xl font-bold">{t('products.bulkImportTitle')}</h1>
      </div>

      {step === 'upload' && (
        <div className="max-w-2xl space-y-6">
          <div className="rounded-lg border p-6 space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <FileUp className="h-5 w-5" />
              {t('products.uploadCsv')}
            </h3>
            <p className="text-sm text-muted-foreground">{t('products.bulkImportDesc')}</p>

            {/* File Upload */}
            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer hover:border-primary transition-colors">
              <Upload className="h-8 w-8 text-muted-foreground mb-2" />
              <span className="text-sm text-muted-foreground">
                {fileName || t('products.selectCsvFile')}
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileUpload}
                className="sr-only"
              />
            </label>

            {/* Or paste CSV */}
            <div>
              <label className="text-sm font-medium">{t('products.orPasteCsv')}</label>
              <textarea
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                rows={6}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                placeholder="product_name_en,product_name_th,product_name_zh,category,..."
              />
            </div>

            <div className="flex gap-3">
              <Button onClick={handlePreview} disabled={!csvText.trim() || previewMutation.isPending}>
                {previewMutation.isPending ? t('common.loading') : t('products.previewImport')}
              </Button>
            </div>

            {/* Validation errors */}
            {validationErrors && validationErrors.length > 0 && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
                <h4 className="font-semibold text-destructive flex items-center gap-2 mb-2">
                  <AlertCircle className="h-4 w-4" />
                  {t('products.validationErrors')}
                </h4>
                <ul className="text-sm space-y-1">
                  {validationErrors.map((e, i) => (
                    <li key={i} className="text-destructive">
                      Row {e.row}, {e.field}: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {previewMutation.isError && !validationErrors && (
              <p className="text-sm text-destructive">{(previewMutation.error as Error).message}</p>
            )}
          </div>
        </div>
      )}

      {step === 'preview' && preview && (
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="rounded-lg border p-4 text-center flex-1">
              <div className="text-2xl font-bold">{preview.total}</div>
              <div className="text-sm text-muted-foreground">{t('products.totalRows')}</div>
            </div>
            <div className="rounded-lg border p-4 text-center flex-1">
              <div className="text-2xl font-bold text-green-600">{preview.creates ?? 0}</div>
              <div className="text-sm text-muted-foreground">{t('products.newProducts')}</div>
            </div>
            <div className="rounded-lg border p-4 text-center flex-1">
              <div className="text-2xl font-bold text-blue-600">{preview.updates ?? 0}</div>
              <div className="text-sm text-muted-foreground">{t('products.updatedProducts')}</div>
            </div>
          </div>

          {preview.preview && preview.preview.length > 0 && (
            <div className="rounded-lg border">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 text-sm font-medium">#</th>
                    <th className="text-left p-3 text-sm font-medium">{t('products.name')}</th>
                    <th className="text-left p-3 text-sm font-medium">{t('products.category')}</th>
                    <th className="text-right p-3 text-sm font-medium">{t('products.price1d')}</th>
                    <th className="text-center p-3 text-sm font-medium">{t('products.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.preview.map((row) => (
                    <tr key={row.row} className="border-b">
                      <td className="p-3 text-sm">{row.row}</td>
                      <td className="p-3 text-sm">{row.name}</td>
                      <td className="p-3 text-sm capitalize">{row.category}</td>
                      <td className="p-3 text-sm text-right">฿{row.price_1day.toLocaleString()}</td>
                      <td className="p-3 text-sm text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          row.action === 'create' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {row.action === 'create' ? t('common.create') : t('common.edit')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep('upload')}>
              <ArrowLeft className="h-4 w-4 mr-1" /> {t('common.back')}
            </Button>
            <Button onClick={handleConfirmImport} disabled={importMutation.isPending}>
              {importMutation.isPending ? t('common.loading') : t('products.confirmImport')}
            </Button>
          </div>

          {importMutation.isError && (
            <p className="text-sm text-destructive">{(importMutation.error as Error).message}</p>
          )}
        </div>
      )}

      {step === 'done' && importResult && (
        <div className="max-w-2xl space-y-6">
          <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-center">
            <Check className="h-12 w-12 text-green-600 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-green-800">{t('products.importComplete')}</h3>
            <p className="text-sm text-green-700 mt-1">
              {t('products.importSummary', { created: importResult.created ?? 0, updated: importResult.updated ?? 0 })}
            </p>
          </div>

          {importResult.results && importResult.results.length > 0 && (
            <div className="rounded-lg border">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 text-sm font-medium">#</th>
                    <th className="text-left p-3 text-sm font-medium">{t('products.name')}</th>
                    <th className="text-center p-3 text-sm font-medium">{t('products.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {importResult.results.map((r) => (
                    <tr key={r.row} className="border-b">
                      <td className="p-3 text-sm">{r.row}</td>
                      <td className="p-3 text-sm">{r.name}</td>
                      <td className="p-3 text-sm text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          r.action === 'created' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {r.action}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Button onClick={onComplete}>
            {t('common.back')}
          </Button>
        </div>
      )}
    </div>
  );
}

function ProductImageManager({ productId }: { productId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);

  const { data: imagesData, isLoading } = useQuery({
    queryKey: ['product-images', productId],
    queryFn: () => adminApi.images.list(productId),
  });

  const deleteMutation = useMutation({
    mutationFn: (imageId: string) => adminApi.images.delete(imageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-images', productId] });
    },
  });

  const images = imagesData?.data ?? [];

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        await adminApi.images.upload(productId, files[i]);
      }
      queryClient.invalidateQueries({ queryKey: ['product-images', productId] });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  return (
    <div>
      <label className="text-sm font-medium flex items-center gap-2 mb-2">
        <Image className="h-4 w-4" />
        {t('products.images')}
      </label>

      {/* Current images */}
      {isLoading ? (
        <div className="flex gap-2">
          {[1, 2].map((i) => (
            <div key={i} className="w-24 h-24 rounded border bg-muted animate-pulse" />
          ))}
        </div>
      ) : images.length > 0 ? (
        <div className="flex flex-wrap gap-3 mb-3">
          {images.map((img) => (
            <div key={img.id} className="relative group">
              <img
                src={img.url}
                alt={img.alt_text}
                className="w-24 h-24 object-cover rounded border"
              />
              <button
                onClick={() => deleteMutation.mutate(img.id)}
                className="absolute -top-2 -right-2 w-5 h-5 bg-destructive text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                title={t('common.delete')}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground mb-3">{t('products.noImages')}</p>
      )}

      {/* Upload button */}
      <label className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-dashed border-input hover:border-primary cursor-pointer text-sm transition-colors">
        <Upload className="h-4 w-4" />
        {uploading ? t('common.loading') : t('products.uploadImage')}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          onChange={handleUpload}
          disabled={uploading}
          className="sr-only"
        />
      </label>
    </div>
  );
}

function ProductDetailView({ productId, onBack }: { productId: string; onBack: () => void }) {
  const { t } = useTranslation();

  const roiQuery = useQuery({
    queryKey: ['product-roi', productId],
    queryFn: () => adminApi.products.roi(productId),
  });

  const metricsQuery = useQuery({
    queryKey: ['product-metrics', productId],
    queryFn: () => adminApi.products.metrics(productId),
  });

  const roi: ProductROI | undefined = roiQuery.data?.data;
  const metrics: ProductMetrics | undefined = metricsQuery.data?.data;

  const trendIcon = (trend: string) => {
    if (trend === 'up') return <TrendingUp className="h-4 w-4 text-green-500" />;
    if (trend === 'down') return <TrendingDown className="h-4 w-4 text-red-500" />;
    return <Minus className="h-4 w-4 text-gray-400" />;
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-1 hover:bg-muted rounded">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-2xl font-bold">{roi?.product_name ?? metrics?.product_name ?? t('common.loading')}</h1>
      </div>

      {/* ROI Section */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          {t('finance.roi')}
        </h2>
        {roiQuery.isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="rounded-lg border p-4 animate-pulse">
                <div className="h-3 w-16 bg-muted rounded mb-2" />
                <div className="h-6 w-12 bg-muted rounded" />
              </div>
            ))}
          </div>
        ) : roi ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground mb-1">{t('finance.purchaseCost')}</p>
                <p className="text-lg font-bold">{roi.purchase_cost.toLocaleString()} THB</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground mb-1">{t('finance.totalRevenue')}</p>
                <p className="text-lg font-bold text-green-600">{roi.total_revenue.toLocaleString()} THB</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground mb-1">{t('finance.netProfitLabel')}</p>
                <p className={`text-lg font-bold ${roi.net_profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {roi.net_profit.toLocaleString()} THB
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground mb-1">{t('finance.roiPercent')}</p>
                <p className={`text-lg font-bold ${roi.roi >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {roi.roi.toFixed(1)}%
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{t('finance.totalRentals')}</p>
                <p className="text-base font-semibold">{roi.total_rentals}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{t('finance.revenuePerRental')}</p>
                <p className="text-base font-semibold">{roi.revenue_per_rental.toLocaleString()} THB</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{t('finance.breakEven')}</p>
                <p className="text-base font-semibold">{roi.break_even_rentals}</p>
              </div>
            </div>

            {/* Cost History */}
            {roi.cost_history.length > 0 && (
              <div className="rounded-lg border">
                <div className="p-3 border-b">
                  <h3 className="text-sm font-semibold">{t('finance.costHistory')}</h3>
                </div>
                <div className="divide-y max-h-60 overflow-y-auto">
                  {roi.cost_history.map((entry, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3">
                      <div>
                        <span className="text-sm">{entry.type.replace(/_/g, ' ')}</span>
                        {entry.note && <p className="text-xs text-muted-foreground">{entry.note}</p>}
                      </div>
                      <div className="text-right">
                        <span className={`text-sm font-medium ${entry.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {entry.amount >= 0 ? '+' : ''}{entry.amount.toLocaleString()} THB
                        </span>
                        <p className="text-xs text-muted-foreground">{new Date(entry.date).toLocaleDateString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : roiQuery.isError ? (
          <p className="text-sm text-muted-foreground">{t('finance.noData')}</p>
        ) : null}
      </div>

      {/* Metrics Section */}
      <div>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          {t('finance.popularity')}
        </h2>
        {metricsQuery.isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="rounded-lg border p-4 animate-pulse">
                <div className="h-3 w-16 bg-muted rounded mb-2" />
                <div className="h-6 w-12 bg-muted rounded" />
              </div>
            ))}
          </div>
        ) : metrics ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground mb-1">{t('finance.totalRentals')}</p>
                <p className="text-lg font-bold">{metrics.rental_count}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground mb-1">{t('finance.occupancyRate')}</p>
                <p className="text-lg font-bold">{metrics.occupancy_rate.toFixed(1)}%</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground mb-1">{t('finance.avgDuration')}</p>
                <p className="text-lg font-bold">{metrics.average_rental_duration.toFixed(1)} {t('products.days')}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground mb-1">{t('finance.trend')}</p>
                <div className="flex items-center gap-2">
                  {trendIcon(metrics.trend)}
                  <span className="text-sm font-medium">
                    {metrics.trend === 'up' ? t('finance.trendUp') : metrics.trend === 'down' ? t('finance.trendDown') : t('finance.trendStable')}
                  </span>
                </div>
              </div>
            </div>

            {metrics.last_rented_date && (
              <p className="text-sm text-muted-foreground mb-4">
                {t('finance.lastRented')}: {new Date(metrics.last_rented_date).toLocaleDateString()}
              </p>
            )}

            {/* Monthly Breakdown */}
            {metrics.monthly_breakdown.length > 0 && (
              <div className="rounded-lg border">
                <div className="p-3 border-b">
                  <h3 className="text-sm font-semibold">{t('finance.monthlyBreakdown')}</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">{t('finance.period')}</th>
                        <th className="text-right p-3 text-xs font-medium text-muted-foreground">{t('finance.rentalCount')}</th>
                        <th className="text-right p-3 text-xs font-medium text-muted-foreground">{t('finance.revenue')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {metrics.monthly_breakdown.map((m) => (
                        <tr key={m.month} className="hover:bg-muted/30">
                          <td className="p-3 text-sm">{m.month}</td>
                          <td className="p-3 text-sm text-right">{m.rental_count}</td>
                          <td className="p-3 text-sm text-right text-green-600">{m.revenue.toLocaleString()} THB</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ) : metricsQuery.isError ? (
          <p className="text-sm text-muted-foreground">{t('finance.noData')}</p>
        ) : null}
      </div>
    </div>
  );
}
