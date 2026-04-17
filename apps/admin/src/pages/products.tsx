import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { adminApi, type AdminProduct, type AdminComboSet, type BulkImportResult } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Plus, Settings, X, ArrowLeft, Upload, Image, Download,
  FileSpreadsheet, FileUp, Check, AlertCircle, DollarSign, Trash2, Loader2,
} from 'lucide-react';

type Tab = 'current' | 'combo' | 'sold';
type FormMode = 'list' | 'create' | 'edit' | 'bulk_import' | 'create_combo' | 'edit_combo';

const STATUS_COLORS: Record<string, string> = {
  current: 'bg-emerald-500',
  combo: 'bg-blue-500',
  sold: 'bg-gray-500',
};

export function ProductsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('current');
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState<FormMode>('list');
  const [editingProduct, setEditingProduct] = useState<AdminProduct | null>(null);
  const [editingCombo, setEditingCombo] = useState<AdminComboSet | null>(null);


  // Search fields
  const [searchSku, setSearchSku] = useState('');
  const [searchBrand, setSearchBrand] = useState('');
  const [searchName, setSearchName] = useState('');
  const [searchCategory, setSearchCategory] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState({ sku: '', brand: '', name: '', category: '' });

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch({ sku: searchSku, brand: searchBrand, name: searchName, category: searchCategory });
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchSku, searchBrand, searchName, searchCategory]);

  // Build search params
  const searchParam = useMemo(() => {
    const parts = [debouncedSearch.sku, debouncedSearch.brand, debouncedSearch.name, debouncedSearch.category].filter(Boolean);
    return parts.join(' ');
  }, [debouncedSearch]);

  // Fetch products
  const productParams: Record<string, string> = { page: String(page), per_page: '50' };
  if (searchParam) productParams.search = searchParam;

  const { data: productsData, isLoading: productsLoading } = useQuery({
    queryKey: ['admin-products', productParams],
    queryFn: () => adminApi.products.list(productParams),
  });

  // Fetch combo sets
  const { data: comboData, isLoading: combosLoading } = useQuery({
    queryKey: ['admin-combo-sets'],
    queryFn: () => adminApi.comboSets.list(),
  });

  const allProducts = productsData?.data ?? [];
  const meta = productsData?.meta;
  const comboSets = comboData?.data ?? [];

  const currentProducts = allProducts.filter((p) => p.product_status !== 'sold');
  const soldProducts = allProducts.filter((p) => p.product_status === 'sold');

  const tabCounts = {
    current: meta?.total ?? currentProducts.length,
    combo: comboSets.length,
    sold: soldProducts.length,
  };

  // Mutations
  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.products.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-products'] }),
  });

  const deleteComboMutation = useMutation({
    mutationFn: (id: string) => adminApi.comboSets.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-combo-sets'] }),
  });

  function handleDelete(id: string) {
    if (window.confirm(t('products.confirmDelete'))) deleteMutation.mutate(id);
  }

  function handleDeleteCombo(id: string) {
    if (window.confirm(t('products.confirmDelete'))) deleteComboMutation.mutate(id);
  }

  function openEditPage(product: AdminProduct) {
    setEditingProduct(product);
    setMode('edit');
  }

  // Bulk import view
  if (mode === 'bulk_import') {
    return <BulkImportView onBack={() => setMode('list')} onComplete={() => { setMode('list'); queryClient.invalidateQueries({ queryKey: ['admin-products'] }); }} />;
  }

  // Create/Edit Product form
  if (mode === 'create' || mode === 'edit') {
    return (
      <ProductForm
        mode={mode}
        product={mode === 'edit' ? editingProduct : null}
        onBack={() => { setMode('list'); setEditingProduct(null); }}
        onSuccess={() => {
          setMode('list');
          setEditingProduct(null);
          queryClient.invalidateQueries({ queryKey: ['admin-products'] });
        }}
      />
    );
  }

  // Create/Edit Combo Set form
  if (mode === 'create_combo' || mode === 'edit_combo') {
    return (
      <ComboSetForm
        mode={mode === 'create_combo' ? 'create' : 'edit'}
        comboSet={mode === 'edit_combo' ? editingCombo : null}
        onBack={() => { setMode('list'); setEditingCombo(null); }}
        onSuccess={() => {
          setMode('list');
          setEditingCombo(null);
          queryClient.invalidateQueries({ queryKey: ['admin-combo-sets'] });
        }}
      />
    );
  }

  const isLoading = activeTab === 'combo' ? combosLoading : productsLoading;

  return (
    <div className="relative">
      {/* Sticky Search Bar */}
      <div className="sticky top-0 z-10 bg-white shadow-sm border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 grid grid-cols-4 gap-2">
            <Input
              placeholder="SKU"
              value={searchSku}
              onChange={(e) => setSearchSku(e.target.value)}
              className="text-xs h-8"
            />
            <Input
              placeholder={t('products.brand')}
              value={searchBrand}
              onChange={(e) => setSearchBrand(e.target.value)}
              className="text-xs h-8"
            />
            <Input
              placeholder={t('products.name')}
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              className="text-xs h-8"
            />
            <Input
              placeholder={t('products.category')}
              value={searchCategory}
              onChange={(e) => setSearchCategory(e.target.value)}
              className="text-xs h-8"
            />
          </div>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => {
              const token = localStorage.getItem('auth-storage');
              const parsed = token ? JSON.parse(token) : null;
              const jwt = parsed?.state?.token;
              const url = adminApi.products.exportUrl();
              const a = document.createElement('a');
              a.href = jwt ? `${url}?token=${jwt}` : url;
              a.download = 'cutebunny-products-export.csv';
              a.click();
            }}>
              <FileSpreadsheet className="h-3 w-3" />
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setMode('bulk_import')}>
              <FileUp className="h-3 w-3" />
            </Button>
            {activeTab === 'combo' ? (
              <Button size="sm" className="h-8 text-xs" onClick={() => setMode('create_combo')}>
                <Plus className="h-3 w-3 mr-1" /> {t('products.addComboSet')}
              </Button>
            ) : (
              <Button size="sm" className="h-8 text-xs" onClick={() => setMode('create')}>
                <Plus className="h-3 w-3 mr-1" /> {t('products.addProduct')}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="sticky top-[57px] z-10 bg-white border-b">
        <div className="flex">
          {([
            { key: 'current' as Tab, label: t('products.currentProducts') },
            { key: 'combo' as Tab, label: t('products.comboSets') },
            { key: 'sold' as Tab, label: t('products.soldProducts') },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setPage(1); }}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
              <span className={`ml-2 px-1.5 py-0.5 text-xs rounded-full text-white ${STATUS_COLORS[tab.key]}`}>
                {tabCounts[tab.key]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {activeTab === 'current' && (
          <CurrentProductsTable
            products={currentProducts}
            isLoading={isLoading}
            onEdit={openEditPage}
            onRowClick={(p) => navigate(`/products/${p.id}`)}
            onDelete={handleDelete}
          />
        )}

        {activeTab === 'combo' && (
          <ComboSetsTable
            comboSets={comboSets}
            isLoading={isLoading}
            onEdit={(cs) => { setEditingCombo(cs); setMode('edit_combo'); }}
            onDelete={handleDeleteCombo}
          />
        )}

        {activeTab === 'sold' && (
          <SoldProductsTable
            products={soldProducts}
            isLoading={isLoading}
          />
        )}

        {/* Pagination */}
        {activeTab !== 'combo' && meta && meta.total_pages > 1 && (
          <div className="flex justify-center gap-2 mt-4">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              ←
            </Button>
            <span className="text-sm py-1 px-2">{page} / {meta.total_pages}</span>
            <Button variant="outline" size="sm" disabled={page >= meta.total_pages} onClick={() => setPage(page + 1)}>
              →
            </Button>
          </div>
        )}
      </div>


    </div>
  );
}

// ─── Current Products Table ───────────────────────────────────────────────
function CurrentProductsTable({
  products,
  isLoading,
  onEdit,
  onRowClick,
  onDelete,
}: {
  products: AdminProduct[];
  isLoading: boolean;
  onEdit: (p: AdminProduct) => void;
  onRowClick: (p: AdminProduct) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="rounded-lg border overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="text-left p-2 text-xs font-medium w-12"></th>
            <th className="text-left p-2 text-xs font-medium">SKU</th>
            <th className="text-left p-2 text-xs font-medium">{t('products.brand')}</th>
            <th className="text-left p-2 text-xs font-medium">{t('products.name')}</th>
            <th className="text-left p-2 text-xs font-medium">{t('products.colors')}</th>
            <th className="text-left p-2 text-xs font-medium">{t('products.sizes')}</th>
            <th className="text-right p-2 text-xs font-medium">1D</th>
            <th className="text-right p-2 text-xs font-medium">3D</th>
            <th className="text-right p-2 text-xs font-medium">5D</th>
            <th className="text-right p-2 text-xs font-medium">{t('products.buyingCost')}</th>
            <th className="text-center p-2 text-xs font-medium">{t('products.rentals')}</th>
            <th className="text-center p-2 text-xs font-medium">P/L</th>
            <th className="text-right p-2 text-xs font-medium w-16"></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {isLoading ? (
            <tr><td colSpan={13} className="p-8 text-center text-muted-foreground">{t('common.loading')}</td></tr>
          ) : products.length === 0 ? (
            <tr><td colSpan={13} className="p-8 text-center text-muted-foreground">{t('products.empty')}</td></tr>
          ) : products.map((p) => {
            const totalRevenue = p.rental_count * p.rental_prices['1day'];
            const pl = totalRevenue - p.cost_price;
            return (
              <tr
                key={p.id}
                className="hover:bg-muted/30 cursor-pointer"
                onClick={() => onRowClick(p)}
              >
                <td className="p-2">
                  {p.thumbnail ? (
                    <img src={p.thumbnail} alt="" className="w-10 h-10 rounded object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
                      <Image className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                </td>
                <td className="p-2 text-xs font-mono">{p.sku}</td>
                <td className="p-2 text-xs">{p.brand ?? '-'}</td>
                <td className="p-2 text-sm font-medium">{p.name}</td>
                <td className="p-2 text-xs">{p.color?.join(', ') || '-'}</td>
                <td className="p-2 text-xs">{p.size?.join(', ') || '-'}</td>
                <td className="p-2 text-xs text-right">{p.rental_prices['1day'].toLocaleString()}</td>
                <td className="p-2 text-xs text-right">{p.rental_prices['3day'].toLocaleString()}</td>
                <td className="p-2 text-xs text-right">{p.rental_prices['5day'].toLocaleString()}</td>
                <td className="p-2 text-xs text-right">{p.cost_price.toLocaleString()}</td>
                <td className="p-2 text-xs text-center">{p.rental_count}</td>
                <td className="p-2 text-xs text-center">
                  <span className={pl >= 0 ? 'text-green-600' : 'text-red-600'}>
                    {pl >= 0 ? '+' : ''}{pl.toLocaleString()}
                  </span>
                </td>
                <td className="p-2 text-right">
                  <button
                    onClick={(e) => { e.stopPropagation(); onEdit(p); }}
                    className="p-1 hover:bg-muted rounded"
                    title={t('common.edit')}
                  >
                    <Settings className="h-4 w-4 text-muted-foreground" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Combo Sets Table ────────────────────────────────────────────────────
function ComboSetsTable({
  comboSets,
  isLoading,
  onEdit,
  onDelete,
}: {
  comboSets: AdminComboSet[];
  isLoading: boolean;
  onEdit: (cs: AdminComboSet) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="rounded-lg border overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="text-left p-2 text-xs font-medium w-12"></th>
            <th className="text-left p-2 text-xs font-medium">SKU</th>
            <th className="text-left p-2 text-xs font-medium">{t('products.brand')}</th>
            <th className="text-left p-2 text-xs font-medium">{t('products.name')}</th>
            <th className="text-left p-2 text-xs font-medium">{t('products.sizes')}</th>
            <th className="text-left p-2 text-xs font-medium">{t('products.colors')}</th>
            <th className="text-right p-2 text-xs font-medium">1D</th>
            <th className="text-right p-2 text-xs font-medium">3D</th>
            <th className="text-right p-2 text-xs font-medium">5D</th>
            <th className="text-left p-2 text-xs font-medium">{t('products.items')}</th>
            <th className="text-center p-2 text-xs font-medium">{t('products.rentals')}</th>
            <th className="text-right p-2 text-xs font-medium w-20"></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {isLoading ? (
            <tr><td colSpan={12} className="p-8 text-center text-muted-foreground">{t('common.loading')}</td></tr>
          ) : comboSets.length === 0 ? (
            <tr><td colSpan={12} className="p-8 text-center text-muted-foreground">{t('products.noComboSets')}</td></tr>
          ) : comboSets.map((cs) => (
            <tr key={cs.id} className="hover:bg-muted/30">
              <td className="p-2">
                {cs.thumbnail ? (
                  <img src={cs.thumbnail} alt="" className="w-10 h-10 rounded object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
                    <Image className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
              </td>
              <td className="p-2 text-xs font-mono">{cs.sku}</td>
              <td className="p-2 text-xs">{cs.brand ?? '-'}</td>
              <td className="p-2 text-sm font-medium">{cs.name}</td>
              <td className="p-2 text-xs">{cs.size?.join(', ') || '-'}</td>
              <td className="p-2 text-xs">{cs.color?.join(', ') || '-'}</td>
              <td className="p-2 text-xs text-right">{cs.rental_prices['1day'].toLocaleString()}</td>
              <td className="p-2 text-xs text-right">{cs.rental_prices['3day'].toLocaleString()}</td>
              <td className="p-2 text-xs text-right">{cs.rental_prices['5day'].toLocaleString()}</td>
              <td className="p-2 text-xs">
                {cs.items.map((item) => (
                  <span key={item.id} className="inline-block bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded text-[10px] mr-1">
                    {item.product_name} ({item.revenue_share_pct}%)
                  </span>
                ))}
              </td>
              <td className="p-2 text-xs text-center">{cs.rental_count}</td>
              <td className="p-2 text-right">
                <div className="flex gap-1 justify-end">
                  <button onClick={() => onEdit(cs)} className="p-1 hover:bg-muted rounded" title={t('common.edit')}>
                    <Settings className="h-4 w-4 text-muted-foreground" />
                  </button>
                  <button onClick={() => onDelete(cs.id)} className="p-1 hover:bg-muted rounded" title={t('common.delete')}>
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Sold Products Table ─────────────────────────────────────────────────
function SoldProductsTable({
  products,
  isLoading,
}: {
  products: AdminProduct[];
  isLoading: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div className="rounded-lg border overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="text-left p-2 text-xs font-medium w-12"></th>
            <th className="text-left p-2 text-xs font-medium">SKU</th>
            <th className="text-left p-2 text-xs font-medium">{t('products.brand')}</th>
            <th className="text-left p-2 text-xs font-medium">{t('products.name')}</th>
            <th className="text-right p-2 text-xs font-medium">{t('products.buyingCost')}</th>
            <th className="text-center p-2 text-xs font-medium">{t('products.rentals')}</th>
            <th className="text-right p-2 text-xs font-medium">{t('products.sellingPrice')}</th>
            <th className="text-right p-2 text-xs font-medium">{t('products.profitLoss')}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {isLoading ? (
            <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">{t('common.loading')}</td></tr>
          ) : products.length === 0 ? (
            <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">{t('products.noSoldProducts')}</td></tr>
          ) : products.map((p) => {
            const totalRevenue = p.rental_count * p.rental_prices['1day'];
            const pl = totalRevenue + p.selling_price - p.cost_price;
            return (
              <tr key={p.id} className="hover:bg-muted/30">
                <td className="p-2">
                  {p.thumbnail ? (
                    <img src={p.thumbnail} alt="" className="w-10 h-10 rounded object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
                      <Image className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                </td>
                <td className="p-2 text-xs font-mono">{p.sku}</td>
                <td className="p-2 text-xs">{p.brand ?? '-'}</td>
                <td className="p-2 text-sm font-medium">{p.name}</td>
                <td className="p-2 text-xs text-right">{p.cost_price.toLocaleString()}</td>
                <td className="p-2 text-xs text-center">{p.rental_count}</td>
                <td className="p-2 text-xs text-right">{p.selling_price.toLocaleString()}</td>
                <td className="p-2 text-xs text-right">
                  <span className={pl >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                    {pl >= 0 ? '+' : ''}{pl.toLocaleString()}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Product Form (Create / Edit) ────────────────────────────────────────
function ProductForm({
  mode,
  product,
  onBack,
  onSuccess,
}: {
  mode: 'create' | 'edit';
  product: AdminProduct | null;
  onBack: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [sku, setSku] = useState(product?.sku ?? '');
  const [name, setName] = useState(product?.name ?? '');
  const [brandName, setBrandName] = useState(product?.brand ?? '');
  const [category, setCategory] = useState(product?.category ?? 'evening');
  const [size, setSize] = useState(product?.size?.join(', ') ?? 'M');
  const [color, setColor] = useState(product?.color?.join(', ') ?? '');
  const [price1, setPrice1] = useState(product ? String(product.rental_prices['1day']) : '');
  const [price3, setPrice3] = useState(product ? String(product.rental_prices['3day']) : '');
  const [price5, setPrice5] = useState(product ? String(product.rental_prices['5day']) : '');
  const [costPrice, setCostPrice] = useState(product ? String(product.cost_price) : '');
  const [variableCost, setVariableCost] = useState(product ? String(product.variable_cost) : '100');
  const [extraDayRate, setExtraDayRate] = useState(product ? String(product.extra_day_rate ?? 0) : '0');
  const [retailPrice, setRetailPrice] = useState(product ? String(product.retail_price) : '');
  const [imageUrls, setImageUrls] = useState<string[]>(['']);
  const [uploadedImages, setUploadedImages] = useState<Array<{ url: string; name: string }>>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showSoldForm, setShowSoldForm] = useState(false);
  const [sellingPrice, setSellingPrice] = useState('');

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => adminApi.products.create(body),
    onSuccess,
  });

  const updateMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => adminApi.products.update(product!.id, body),
    onSuccess,
  });

  const markSoldMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => adminApi.products.update(product!.id, body),
    onSuccess,
  });

  function handleMarkAsSold() {
    if (!sellingPrice || Number(sellingPrice) <= 0) return;
    markSoldMutation.mutate({
      product_status: 'sold',
      selling_price: Number(sellingPrice),
    });
  }

  async function handleFileUpload(files: FileList) {
    setUploadingFiles(true);
    const newUploaded: Array<{ url: string; name: string }> = [];
    for (const file of Array.from(files)) {
      try {
        const result = await adminApi.images.uploadGeneric(file, 'products');
        newUploaded.push({ url: result.data.url, name: file.name });
      } catch {
        // skip failed uploads silently
      }
    }
    setUploadedImages((prev) => [...prev, ...newUploaded]);
    setUploadingFiles(false);
  }

  function handleSubmit() {
    const manualUrls = imageUrls.filter((u) => u.trim());
    const uploadUrls = uploadedImages.map((img) => img.url);
    const allUrls = [...uploadUrls, ...manualUrls];
    const body: Record<string, unknown> = {
      sku,
      name,
      brand_name: brandName || undefined,
      category,
      size: size.split(',').map((s) => s.trim()).filter(Boolean),
      color: color.split(',').map((s) => s.trim()).filter(Boolean),
      rental_price_1day: Number(price1),
      rental_price_3day: Number(price3),
      rental_price_5day: Number(price5),
      cost_price: Number(costPrice) || 0,
      variable_cost: Number(variableCost) || 100,
      extra_day_rate: Number(extraDayRate) || 0,
      retail_price: Number(retailPrice) || 0,
    };
    if (allUrls.length > 0) body.image_urls = allUrls;

    if (mode === 'edit' && product) {
      updateMutation.mutate(body);
    } else {
      createMutation.mutate(body);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-1 hover:bg-muted rounded"><ArrowLeft className="h-5 w-5" /></button>
        <h1 className="text-2xl font-bold">
          {mode === 'create' ? t('products.createTitle') : t('products.editTitle')}
        </h1>
      </div>

      <div className="max-w-2xl space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">SKU</label>
            <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="D001" />
          </div>
          <div>
            <label className="text-sm font-medium">{t('products.category')}</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
              {['wedding', 'evening', 'cocktail', 'casual', 'costume', 'traditional', 'accessories'].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium">{t('products.name')}</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('products.namePlaceholder')} />
        </div>

        <div>
          <label className="text-sm font-medium">{t('products.brand')}</label>
          <Input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder={t('products.brandPlaceholder')} />
          <p className="text-xs text-muted-foreground mt-1">{t('products.brandHint')}</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">{t('products.sizes')}</label>
            <Input value={size} onChange={(e) => setSize(e.target.value)} placeholder="S, M, L" />
          </div>
          <div>
            <label className="text-sm font-medium">{t('products.colors')}</label>
            <Input value={color} onChange={(e) => setColor(e.target.value)} placeholder="red, blue" />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium">{t('products.pricing')}</label>
          <div className="grid grid-cols-4 gap-3 mt-1">
            <div>
              <span className="text-xs text-muted-foreground">1 {t('products.day')}</span>
              <Input type="number" value={price1} onChange={(e) => setPrice1(e.target.value)} />
            </div>
            <div>
              <span className="text-xs text-muted-foreground">3 {t('products.days')}</span>
              <Input type="number" value={price3} onChange={(e) => setPrice3(e.target.value)} />
            </div>
            <div>
              <span className="text-xs text-muted-foreground">5 {t('products.days')}</span>
              <Input type="number" value={price5} onChange={(e) => setPrice5(e.target.value)} />
            </div>
            <div>
              <span className="text-xs text-muted-foreground">{t('products.extraDay')}</span>
              <Input type="number" value={extraDayRate} onChange={(e) => setExtraDayRate(e.target.value)} placeholder="0" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-sm font-medium">{t('products.buyingCost')}</label>
            <Input type="number" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} placeholder="0" />
          </div>
          <div>
            <label className="text-sm font-medium">{t('products.variableCost')}</label>
            <Input type="number" value={variableCost} onChange={(e) => setVariableCost(e.target.value)} placeholder="100" />
          </div>
          <div>
            <label className="text-sm font-medium">{t('products.retailPrice')}</label>
            <Input type="number" value={retailPrice} onChange={(e) => setRetailPrice(e.target.value)} placeholder="0" />
          </div>
        </div>

        {/* Image Upload */}
        <div>
          <label className="text-sm font-medium flex items-center gap-2">
            <Image className="h-4 w-4" />
            {t('products.images')}
          </label>

          {/* Upload Button */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={(e) => { if (e.target.files?.length) handleFileUpload(e.target.files); e.target.value = ''; }}
          />
          <div className="mt-2 flex gap-2 flex-wrap">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingFiles}
            >
              {uploadingFiles ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
              {uploadingFiles ? t('common.loading') : t('products.uploadImages')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowUrlInput(!showUrlInput)}
              className="text-xs text-muted-foreground"
            >
              {showUrlInput ? t('products.hideUrlInput') : t('products.addByUrl')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">JPEG, PNG, WebP, GIF — max 5MB each</p>

          {/* Uploaded Image Previews */}
          {uploadedImages.length > 0 && (
            <div className="mt-3 flex gap-2 flex-wrap">
              {uploadedImages.map((img, idx) => (
                <div key={idx} className="relative group">
                  <img src={img.url} alt={img.name} className="w-20 h-20 rounded-md object-cover border" />
                  <button
                    onClick={() => setUploadedImages(uploadedImages.filter((_, i) => i !== idx))}
                    className="absolute -top-1.5 -right-1.5 bg-destructive text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                  <p className="text-[10px] text-muted-foreground truncate w-20 mt-0.5">{img.name}</p>
                </div>
              ))}
            </div>
          )}

          {/* URL input (secondary option) */}
          {showUrlInput && (
            <div className="mt-3 border-t pt-3">
              <span className="text-xs font-medium text-muted-foreground">{t('products.imageUrls')}</span>
              {imageUrls.map((url, idx) => (
                <div key={idx} className="flex gap-2 mt-2">
                  <Input
                    value={url}
                    onChange={(e) => {
                      const newUrls = [...imageUrls];
                      newUrls[idx] = e.target.value;
                      setImageUrls(newUrls);
                    }}
                    placeholder="https://..."
                    className="text-sm"
                  />
                  {imageUrls.length > 1 && (
                    <button onClick={() => setImageUrls(imageUrls.filter((_, i) => i !== idx))} className="p-2 hover:bg-muted rounded">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              <Button variant="outline" size="sm" className="mt-2" onClick={() => setImageUrls([...imageUrls, ''])}>
                <Plus className="h-3 w-3 mr-1" /> {t('products.addImageUrl')}
              </Button>
            </div>
          )}
        </div>

        {/* Product Image Manager (edit mode only) */}
        {mode === 'edit' && product && <ProductImageManager productId={product.id} />}

        {/* Mark as Sold Section (edit mode only) */}
        {mode === 'edit' && product && product.product_status !== 'sold' && (
          <div className="border-t pt-4">
            {!showSoldForm ? (
              <Button
                variant="outline"
                size="sm"
                className="w-full text-orange-600 border-orange-300 hover:bg-orange-50"
                onClick={() => setShowSoldForm(true)}
              >
                <DollarSign className="h-4 w-4 mr-1" />
                {t('products.markAsSold')}
              </Button>
            ) : (
              <div className="space-y-3 p-3 rounded border border-orange-200 bg-orange-50">
                <p className="text-sm font-medium text-orange-700">{t('products.markAsSoldTitle')}</p>
                <div>
                  <label className="text-xs text-orange-700">{t('products.sellingPrice')}</label>
                  <Input
                    type="number"
                    value={sellingPrice}
                    onChange={(e) => setSellingPrice(e.target.value)}
                    className="h-8 text-sm"
                    placeholder="0"
                  />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setShowSoldForm(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    size="sm"
                    className="bg-orange-600 hover:bg-orange-700"
                    onClick={handleMarkAsSold}
                    disabled={markSoldMutation.isPending || !sellingPrice}
                  >
                    {markSoldMutation.isPending ? t('common.loading') : t('products.confirmSold')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-4">
          <Button variant="outline" onClick={onBack}>{t('common.cancel')}</Button>
          <Button onClick={handleSubmit} disabled={isPending || !sku || !name}>
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

// ─── Combo Set Form ──────────────────────────────────────────────────────
function ComboSetForm({
  mode,
  comboSet,
  onBack,
  onSuccess,
}: {
  mode: 'create' | 'edit';
  comboSet: AdminComboSet | null;
  onBack: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [sku, setSku] = useState(comboSet?.sku ?? '');
  const [name, setName] = useState(comboSet?.name ?? '');
  const [brandName, setBrandName] = useState(comboSet?.brand ?? '');
  const [size, setSize] = useState(comboSet?.size?.join(', ') ?? '');
  const [color, setColor] = useState(comboSet?.color?.join(', ') ?? '');
  const [price1, setPrice1] = useState(comboSet ? String(comboSet.rental_prices['1day']) : '');
  const [price3, setPrice3] = useState(comboSet ? String(comboSet.rental_prices['3day']) : '');
  const [price5, setPrice5] = useState(comboSet ? String(comboSet.rental_prices['5day']) : '');
  const [variableCost, setVariableCost] = useState(comboSet ? String(comboSet.variable_cost) : '0');
  const [extraDayRate, setExtraDayRate] = useState(comboSet ? String(comboSet.extra_day_rate ?? 0) : '0');
  const [thumbnailUrl, setThumbnailUrl] = useState(comboSet?.thumbnail ?? '');
  const [uploadingThumbnail, setUploadingThumbnail] = useState(false);
  const comboFileInputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Array<{ product_id: string; revenue_share_pct: number; label: string }>>(
    comboSet?.items?.map((i) => ({ product_id: i.product_id, revenue_share_pct: i.revenue_share_pct, label: i.label ?? '' })) ?? [
      { product_id: '', revenue_share_pct: 50, label: '' },
    ]
  );

  // Fetch products for selection
  const { data: productsData } = useQuery({
    queryKey: ['admin-products', { per_page: '100' }],
    queryFn: () => adminApi.products.list({ per_page: '100' }),
  });
  const allProducts = productsData?.data ?? [];

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => adminApi.comboSets.create(body),
    onSuccess,
  });

  const updateMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => adminApi.comboSets.update(comboSet!.id, body),
    onSuccess,
  });

  async function handleThumbnailUpload(file: File) {
    setUploadingThumbnail(true);
    try {
      const result = await adminApi.images.uploadGeneric(file, 'combo-sets');
      setThumbnailUrl(result.data.url);
    } catch {
      // skip
    }
    setUploadingThumbnail(false);
  }

  function handleSubmit() {
    const validItems = items.filter((i) => i.product_id);
    const body: Record<string, unknown> = {
      sku,
      name,
      brand_name: brandName || undefined,
      color: color.split(',').map((s) => s.trim()).filter(Boolean),
      size: size.split(',').map((s) => s.trim()).filter(Boolean),
      rental_price_1day: Number(price1),
      rental_price_3day: Number(price3),
      rental_price_5day: Number(price5),
      variable_cost: Number(variableCost) || 0,
      extra_day_rate: Number(extraDayRate) || 0,
      thumbnail_url: thumbnailUrl || undefined,
      items: validItems,
    };

    if (mode === 'edit' && comboSet) {
      updateMutation.mutate(body);
    } else {
      createMutation.mutate(body);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-1 hover:bg-muted rounded"><ArrowLeft className="h-5 w-5" /></button>
        <h1 className="text-2xl font-bold">
          {mode === 'create' ? t('products.createComboSet') : t('products.editComboSet')}
        </h1>
      </div>

      <div className="max-w-2xl space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">SKU</label>
            <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="C001" />
          </div>
          <div>
            <label className="text-sm font-medium">{t('products.name')}</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Top & Bottom" />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium">{t('products.brand')}</label>
          <Input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder={t('products.brandPlaceholder')} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">{t('products.sizes')}</label>
            <Input value={size} onChange={(e) => setSize(e.target.value)} placeholder="S, M, L" />
          </div>
          <div>
            <label className="text-sm font-medium">{t('products.colors')}</label>
            <Input value={color} onChange={(e) => setColor(e.target.value)} placeholder="red, blue" />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium">{t('products.pricing')}</label>
          <div className="grid grid-cols-4 gap-3 mt-1">
            <div>
              <span className="text-xs text-muted-foreground">1 {t('products.day')}</span>
              <Input type="number" value={price1} onChange={(e) => setPrice1(e.target.value)} />
            </div>
            <div>
              <span className="text-xs text-muted-foreground">3 {t('products.days')}</span>
              <Input type="number" value={price3} onChange={(e) => setPrice3(e.target.value)} />
            </div>
            <div>
              <span className="text-xs text-muted-foreground">5 {t('products.days')}</span>
              <Input type="number" value={price5} onChange={(e) => setPrice5(e.target.value)} />
            </div>
            <div>
              <span className="text-xs text-muted-foreground">{t('products.extraDay')}</span>
              <Input type="number" value={extraDayRate} onChange={(e) => setExtraDayRate(e.target.value)} placeholder="0" />
            </div>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium">{t('products.variableCost')}</label>
          <Input type="number" value={variableCost} onChange={(e) => setVariableCost(e.target.value)} className="max-w-xs" />
        </div>

        {/* Thumbnail Upload */}
        <div>
          <label className="text-sm font-medium flex items-center gap-2">
            <Image className="h-4 w-4" />
            {t('products.thumbnail')}
          </label>
          <input
            ref={comboFileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => { if (e.target.files?.[0]) handleThumbnailUpload(e.target.files[0]); e.target.value = ''; }}
          />
          <div className="mt-2 flex items-center gap-3">
            {thumbnailUrl ? (
              <div className="relative group">
                <img src={thumbnailUrl} alt="Thumbnail" className="w-20 h-20 rounded-md object-cover border" />
                <button
                  onClick={() => setThumbnailUrl('')}
                  className="absolute -top-1.5 -right-1.5 bg-destructive text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : null}
            <div className="space-y-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => comboFileInputRef.current?.click()}
                disabled={uploadingThumbnail}
              >
                {uploadingThumbnail ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
                {uploadingThumbnail ? t('common.loading') : thumbnailUrl ? t('products.changeThumbnail') : t('products.uploadThumbnail')}
              </Button>
              <p className="text-xs text-muted-foreground">JPEG, PNG, WebP, GIF — max 5MB</p>
            </div>
          </div>
          {!thumbnailUrl && (
            <div className="mt-2">
              <Input
                value={thumbnailUrl}
                onChange={(e) => setThumbnailUrl(e.target.value)}
                placeholder="https://... (or upload above)"
                className="text-sm"
              />
            </div>
          )}
        </div>

        {/* Combo Items */}
        <div>
          <label className="text-sm font-medium">{t('products.comboItems')}</label>
          {items.map((item, idx) => (
            <div key={idx} className="flex gap-2 mt-2 items-end">
              <div className="flex-1">
                <span className="text-xs text-muted-foreground">{t('products.product')}</span>
                <select
                  value={item.product_id}
                  onChange={(e) => {
                    const newItems = [...items];
                    newItems[idx] = { ...newItems[idx], product_id: e.target.value };
                    setItems(newItems);
                  }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">{t('products.selectProduct')}</option>
                  {allProducts.map((p) => (
                    <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>
                  ))}
                </select>
              </div>
              <div className="w-24">
                <span className="text-xs text-muted-foreground">{t('products.revenueShare')} %</span>
                <Input
                  type="number"
                  value={String(item.revenue_share_pct)}
                  onChange={(e) => {
                    const newItems = [...items];
                    newItems[idx] = { ...newItems[idx], revenue_share_pct: Number(e.target.value) };
                    setItems(newItems);
                  }}
                  min={0}
                  max={100}
                />
              </div>
              <div className="w-24">
                <span className="text-xs text-muted-foreground">{t('products.label')}</span>
                <Input
                  value={item.label}
                  onChange={(e) => {
                    const newItems = [...items];
                    newItems[idx] = { ...newItems[idx], label: e.target.value };
                    setItems(newItems);
                  }}
                  placeholder="top/bottom"
                />
              </div>
              {items.length > 1 && (
                <button onClick={() => setItems(items.filter((_, i) => i !== idx))} className="p-2 hover:bg-muted rounded mb-0.5">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          <Button variant="outline" size="sm" className="mt-2" onClick={() => setItems([...items, { product_id: '', revenue_share_pct: 50, label: '' }])}>
            <Plus className="h-3 w-3 mr-1" /> {t('products.addItem')}
          </Button>
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <Button variant="outline" onClick={onBack}>{t('common.cancel')}</Button>
          <Button onClick={handleSubmit} disabled={isPending || !sku || !name}>
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

// ─── Product Image Manager ───────────────────────────────────────────────
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['product-images', productId] }),
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
      <label className="text-xs font-medium flex items-center gap-2 mb-2 text-muted-foreground">
        <Image className="h-4 w-4" />
        {t('products.images')}
      </label>
      {isLoading ? (
        <div className="flex gap-2">
          {[1, 2].map((i) => <div key={i} className="w-20 h-20 rounded border bg-muted animate-pulse" />)}
        </div>
      ) : images.length > 0 ? (
        <div className="flex flex-wrap gap-2 mb-2">
          {images.map((img) => (
            <div key={img.id} className="relative group">
              <img src={img.url} alt={img.alt_text} className="w-20 h-20 object-cover rounded border" />
              <button
                onClick={() => deleteMutation.mutate(img.id)}
                className="absolute -top-1 -right-1 w-4 h-4 bg-destructive text-white rounded-full flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground mb-2">{t('products.noImages')}</p>
      )}
      <label className="inline-flex items-center gap-1 px-2 py-1.5 rounded border border-dashed border-input hover:border-primary cursor-pointer text-xs transition-colors">
        <Upload className="h-3 w-3" />
        {uploading ? t('common.loading') : t('products.uploadImage')}
        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={handleUpload} disabled={uploading} className="sr-only" />
      </label>
    </div>
  );
}

// ─── Bulk Import View (preserved from original) ─────────────────────────
function BulkImportView({ onBack, onComplete }: { onBack: () => void; onComplete: () => void }) {
  const { t } = useTranslation();
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload');
  const [preview, setPreview] = useState<BulkImportResult | null>(null);
  const [validationErrors, setValidationErrors] = useState<Array<{ row: number; field: string; message: string }> | null>(null);

  const previewMutation = useMutation({
    mutationFn: (csv: string) => adminApi.products.bulkImport(csv, true),
    onSuccess: (data) => {
      const result = data.data;
      if (result.errors && result.errors.length > 0) {
        setValidationErrors(result.errors);
      } else {
        setValidationErrors(null);
        setPreview(result);
        setStep('preview');
      }
    },
  });

  const importMutation = useMutation({
    mutationFn: (csv: string) => adminApi.products.bulkImport(csv, false),
    onSuccess: (data) => {
      setPreview(data.data);
      setStep('done');
    },
  });

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      setCsvText(text);
    };
    reader.readAsText(file);
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-1 hover:bg-muted rounded"><ArrowLeft className="h-5 w-5" /></button>
        <h1 className="text-2xl font-bold">{t('products.bulkImportTitle')}</h1>
      </div>

      {step === 'upload' && (
        <div className="max-w-2xl space-y-6">
          <div className="rounded-lg border p-6 space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <FileUp className="h-5 w-5" />
              {t('products.uploadCsv')}
            </h3>
            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer hover:border-primary transition-colors">
              <Upload className="h-8 w-8 text-muted-foreground mb-2" />
              <span className="text-sm text-muted-foreground">{fileName || t('products.selectCsvFile')}</span>
              <input type="file" accept=".csv,text/csv" onChange={handleFileUpload} className="sr-only" />
            </label>
            <div>
              <label className="text-sm font-medium">{t('products.orPasteCsv')}</label>
              <textarea value={csvText} onChange={(e) => setCsvText(e.target.value)} rows={6} className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono" />
            </div>
            <Button onClick={() => { if (csvText.trim()) previewMutation.mutate(csvText); }} disabled={!csvText.trim() || previewMutation.isPending}>
              {previewMutation.isPending ? t('common.loading') : t('products.previewImport')}
            </Button>
            {validationErrors && validationErrors.length > 0 && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
                <h4 className="font-semibold text-destructive flex items-center gap-2 mb-2">
                  <AlertCircle className="h-4 w-4" />
                  {t('products.validationErrors')}
                </h4>
                <ul className="text-sm space-y-1">
                  {validationErrors.map((e, i) => (
                    <li key={i} className="text-destructive">Row {e.row}, {e.field}: {e.message}</li>
                  ))}
                </ul>
              </div>
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
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep('upload')}>{t('common.cancel')}</Button>
            <Button onClick={() => { if (csvText.trim()) importMutation.mutate(csvText); }} disabled={importMutation.isPending}>
              {importMutation.isPending ? t('common.loading') : t('products.confirmImport')}
            </Button>
          </div>
        </div>
      )}

      {step === 'done' && preview && (
        <div className="text-center py-8">
          <Check className="h-12 w-12 text-green-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">{t('products.importComplete')}</h3>
          <p className="text-muted-foreground">{preview.created ?? 0} {t('products.created')}, {preview.updated ?? 0} {t('products.updated')}</p>
          <Button className="mt-4" onClick={onComplete}>{t('common.close')}</Button>
        </div>
      )}
    </div>
  );
}
