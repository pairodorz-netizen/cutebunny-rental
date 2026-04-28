'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations, useLocale } from 'next-intl';
import { useState, useEffect, useRef, useCallback } from 'react';
import { api, type Category } from '@/lib/api';
import { ProductCard } from '@/components/product-card';
import { Search, SlidersHorizontal, X } from 'lucide-react';

const SIZES = ['XS', 'S', 'M', 'L', 'XL'];

const COLOR_OPTIONS = [
  { key: 'white', hex: '#FFFFFF' },
  { key: 'black', hex: '#1a1a1a' },
  { key: 'red', hex: '#EF4444' },
  { key: 'pink', hex: '#EC4899' },
  { key: 'orange', hex: '#F97316' },
  { key: 'yellow', hex: '#EAB308' },
  { key: 'green', hex: '#22C55E' },
  { key: 'blue', hex: '#3B82F6' },
  { key: 'navy', hex: '#1E3A5F' },
  { key: 'purple', hex: '#A855F7' },
  { key: 'cream', hex: '#FFFDD0' },
  { key: 'beige', hex: '#F5F5DC' },
  { key: 'brown', hex: '#92400E' },
  { key: 'gray', hex: '#9CA3AF' },
  { key: 'gold', hex: '#D4AF37' },
  { key: 'silver', hex: '#C0C0C0' },
] as const;

interface PriceRange {
  key: string;
  min?: number;
  max?: number;
}

const PRICE_RANGES: PriceRange[] = [
  { key: 'under200', max: 200 },
  { key: '201to400', min: 201, max: 400 },
  { key: '401to600', min: 401, max: 600 },
  { key: 'above601', min: 601 },
];

const SORT_OPTIONS = [
  { key: 'featured', value: '' },
  { key: 'priceLow', value: 'price_asc' },
  { key: 'priceHigh', value: 'price_desc' },
  { key: 'newest', value: 'newest' },
];

export default function ProductsPage() {
  const t = useTranslations('products');
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPriceRange, setSelectedPriceRange] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState('');
  const [availDate, setAvailDate] = useState('');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchQuery(value);
      setPage(1);
    }, 500);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.categories.list(),
    staleTime: 5 * 60 * 1000,
  });

  const visibleCategories: Category[] = (categoriesQuery.data?.data ?? [])
    .filter((row) => row.visible_frontend);

  const activePriceRange = PRICE_RANGES.find((r) => r.key === selectedPriceRange);

  const params: Record<string, string> = {
    locale,
    page: String(page),
    per_page: '12',
  };
  if (selectedSize) params.size = selectedSize;
  if (selectedColor) params.color = selectedColor;
  if (selectedCategory) params.category = selectedCategory;
  if (searchQuery) params.search = searchQuery;
  if (activePriceRange?.min) params.price_min = String(activePriceRange.min);
  if (activePriceRange?.max) params.price_max = String(activePriceRange.max);
  if (sortBy) params.sort = sortBy;
  if (availDate) {
    params.available_start = availDate;
    params.available_end = availDate;
  }

  const { data, isLoading, isError } = useQuery({
    queryKey: ['products', params],
    queryFn: () => api.products.list(params),
  });

  const products = data?.data ?? [];
  const meta = data?.meta;

  function categoryLabel(row: Category): string {
    return locale === 'th' ? row.name_th : row.name_en;
  }

  const hasActiveFilters =
    selectedSize !== null ||
    selectedColor !== null ||
    selectedCategory !== null ||
    searchQuery !== '' ||
    selectedPriceRange !== null ||
    availDate !== '';

  function clearAllFilters() {
    setSelectedSize(null);
    setSelectedColor(null);
    setSelectedCategory(null);
    setSearchInput('');
    setSearchQuery('');
    setSelectedPriceRange(null);
    setAvailDate('');
    setPage(1);
  }

  const filterSidebar = (
    <div className="space-y-6">
      {/* Date Availability Filter */}
      <div>
        <h3 className="text-sm font-semibold text-cb-heading mb-3">{t('filter.availability')}</h3>
        <input
          type="date"
          lang={locale === 'th' ? 'th' : 'en'}
          value={availDate}
          onChange={(e) => { setAvailDate(e.target.value); setPage(1); }}
          min={new Date().toISOString().split('T')[0]}
          className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-cb-heading focus:outline-none focus:ring-2 focus:ring-cb-active/50"
        />
      </div>

      {/* Category filter */}
      <div>
        <h3 className="text-sm font-semibold text-cb-heading mb-3">{t('filter.category')}</h3>
        <div className="space-y-1.5">
          {categoriesQuery.isLoading && (
            <div className="space-y-1.5" aria-busy="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-8 w-full rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          )}
          {categoriesQuery.isError && (
            <button
              type="button"
              onClick={() => categoriesQuery.refetch()}
              className="w-full text-sm text-center py-2 rounded-xl border border-destructive text-destructive hover:bg-destructive/5 transition-colors"
            >
              {t('retry')}
            </button>
          )}
          {!categoriesQuery.isLoading && !categoriesQuery.isError && (
            <div data-testid="category-filter-list">
              {visibleCategories.map((row) => {
                const label = categoryLabel(row);
                const active = selectedCategory === row.slug;
                return (
                  <label
                    key={row.slug}
                    data-testid="category-filter-option"
                    data-slug={row.slug}
                    className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-cb-surface transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => {
                        setSelectedCategory(active ? null : row.slug);
                        setPage(1);
                      }}
                      className="rounded border-border text-cb-active focus:ring-cb-active"
                    />
                    <span className="text-sm text-cb-heading">{label}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Size filter */}
      <div>
        <h3 className="text-sm font-semibold text-cb-heading mb-3">{t('filter.size')}</h3>
        <div className="flex flex-wrap gap-2">
          {SIZES.map((size) => (
            <button
              key={size}
              onClick={() => {
                setSelectedSize(selectedSize === size ? null : size);
                setPage(1);
              }}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
                selectedSize === size
                  ? 'bg-cb-active text-white'
                  : 'bg-cb-surface text-cb-heading hover:bg-border'
              }`}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      {/* Color filter */}
      <div>
        <h3 className="text-sm font-semibold text-cb-heading mb-3">{t('filter.color')}</h3>
        <div className="grid grid-cols-5 gap-2">
          {COLOR_OPTIONS.map(({ key, hex }) => {
            const active = selectedColor === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setSelectedColor(active ? null : key);
                  setPage(1);
                }}
                className="flex flex-col items-center gap-1"
                title={t(`filter.colors.${key}`)}
              >
                <span
                  className={`block h-7 w-7 rounded-full border-2 transition-all ${
                    active ? 'border-cb-active ring-2 ring-cb-active/30 scale-110' : 'border-border'
                  }`}
                  style={{ backgroundColor: hex }}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Price range filter */}
      <div>
        <h3 className="text-sm font-semibold text-cb-heading mb-3">{t('filter.priceRange')}</h3>
        <div className="space-y-2">
          {PRICE_RANGES.map((range) => {
            const checked = selectedPriceRange === range.key;
            return (
              <label
                key={range.key}
                className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-cb-surface transition-colors"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    setSelectedPriceRange(checked ? null : range.key);
                    setPage(1);
                  }}
                  className="rounded border-border text-cb-active focus:ring-cb-active"
                />
                <span className="text-sm text-cb-heading">
                  {t(`filter.priceRanges.${range.key}`)}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Clear all */}
      {hasActiveFilters && (
        <button
          type="button"
          onClick={clearAllFilters}
          className="w-full text-sm text-center py-2.5 rounded-xl border border-cb-active text-cb-active hover:bg-cb-active hover:text-white transition-colors font-medium"
        >
          {t('filter.clearAll')}
        </button>
      )}
    </div>
  );

  return (
    <div className="min-h-screen">
      <div className="container py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl md:text-3xl font-display font-semibold text-cb-heading">
              {t('title')}
            </h1>
            {meta && (
              <p className="text-sm text-cb-secondary mt-1">
                {meta.total} {t('resultCount')}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* Sort */}
            <select
              value={sortBy}
              onChange={(e) => { setSortBy(e.target.value); setPage(1); }}
              className="rounded-xl border border-border bg-white px-4 py-2.5 text-sm text-cb-heading focus:outline-none focus:ring-2 focus:ring-cb-active/50"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.value}>
                  {t(`sort.${opt.key}`)}
                </option>
              ))}
            </select>
            {/* Mobile filter toggle */}
            <button
              type="button"
              className="md:hidden flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-white text-sm text-cb-heading"
              onClick={() => setMobileFiltersOpen(!mobileFiltersOpen)}
            >
              <SlidersHorizontal className="h-4 w-4" />
              {t('filter.filters')}
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div className="relative mb-6">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-cb-secondary" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (debounceRef.current) clearTimeout(debounceRef.current);
                setSearchQuery(searchInput);
                setPage(1);
              }
            }}
            placeholder={t('filter.searchPlaceholder')}
            className="w-full rounded-2xl border border-border bg-white px-12 py-3 text-sm text-cb-heading placeholder:text-cb-secondary focus:outline-none focus:ring-2 focus:ring-cb-active/50"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => { setSearchInput(''); setSearchQuery(''); setPage(1); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-cb-secondary hover:text-cb-heading"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex flex-col md:flex-row gap-8">
          {/* Desktop Sidebar */}
          <aside className="hidden md:block w-64 shrink-0">
            <div className="rounded-2xl bg-white shadow-soft sticky top-24 overflow-hidden">
              <div className="bg-sidebar-gradient px-5 py-3">
                <h3 className="text-sm font-semibold text-cb-heading">{t('filter.filters')}</h3>
              </div>
              <div className="p-5">
                {filterSidebar}
              </div>
            </div>
          </aside>

          {/* Mobile Filters Drawer */}
          {mobileFiltersOpen && (
            <div className="md:hidden fixed inset-0 z-40">
              <div className="absolute inset-0 bg-black/30" onClick={() => setMobileFiltersOpen(false)} />
              <div className="absolute right-0 top-0 bottom-0 w-80 bg-white p-6 overflow-y-auto">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-semibold text-cb-heading">{t('filter.filters')}</h2>
                  <button
                    type="button"
                    onClick={() => setMobileFiltersOpen(false)}
                    className="p-1 rounded-full hover:bg-cb-surface"
                  >
                    <X className="h-5 w-5 text-cb-heading" />
                  </button>
                </div>
                {filterSidebar}
              </div>
            </div>
          )}

          {/* Product Grid */}
          <div className="flex-1">
            {isLoading && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="rounded-2xl bg-white overflow-hidden">
                    <div className="aspect-[3/4] bg-muted animate-pulse" />
                    <div className="p-4 space-y-2">
                      <div className="h-3 bg-muted rounded animate-pulse w-20" />
                      <div className="h-4 bg-muted rounded animate-pulse w-32" />
                      <div className="h-4 bg-muted rounded animate-pulse w-16" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {isError && (
              <div className="flex items-center justify-center py-20 text-destructive rounded-2xl bg-white">
                {t('error')}
              </div>
            )}

            {!isLoading && !isError && products.length === 0 && (
              <div className="flex items-center justify-center py-20 text-cb-secondary rounded-2xl bg-white">
                {t('empty')}
              </div>
            )}

            {products.length > 0 && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {products.map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>

                {meta && meta.total_pages > 1 && (
                  <div className="flex items-center justify-center gap-2 mt-8">
                    <button
                      onClick={() => setPage(Math.max(1, page - 1))}
                      disabled={page <= 1}
                      className="px-4 py-2 rounded-xl bg-white border border-border text-sm font-medium text-cb-heading disabled:opacity-40 hover:shadow-soft transition-all"
                    >
                      {t('prev')}
                    </button>
                    {Array.from({ length: Math.min(meta.total_pages, 5) }).map((_, i) => {
                      const pageNum = i + 1;
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setPage(pageNum)}
                          className={`w-10 h-10 rounded-xl text-sm font-medium transition-all ${
                            page === pageNum
                              ? 'bg-cb-active text-white'
                              : 'bg-white border border-border text-cb-heading hover:shadow-soft'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => setPage(Math.min(meta.total_pages, page + 1))}
                      disabled={page >= meta.total_pages}
                      className="px-4 py-2 rounded-xl bg-white border border-border text-sm font-medium text-cb-heading disabled:opacity-40 hover:shadow-soft transition-all"
                    >
                      {t('next')}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
