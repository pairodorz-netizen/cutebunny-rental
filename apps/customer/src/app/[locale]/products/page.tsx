'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations, useLocale } from 'next-intl';
import { useState, useEffect, useRef, useCallback } from 'react';
import { api, type Category } from '@/lib/api';
import { ProductCard } from '@/components/product-card';

const SIZES = ['XS', 'S', 'M', 'L', 'XL'];

const COLOR_OPTIONS = [
  { key: 'white', hex: '#FFFFFF' },
  { key: 'black', hex: '#000000' },
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
    selectedPriceRange !== null;

  function clearAllFilters() {
    setSelectedSize(null);
    setSelectedColor(null);
    setSelectedCategory(null);
    setSearchInput('');
    setSearchQuery('');
    setSelectedPriceRange(null);
    setPage(1);
  }

  return (
    <div className="container py-8">
      <h1 className="text-3xl font-bold mb-8">{t('title')}</h1>

      {/* Search bar */}
      <div className="relative mb-6">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
          />
        </svg>
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
          className="w-full rounded-lg border bg-background px-10 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div className="flex flex-col md:flex-row gap-8">
        <aside className="w-full md:w-64 shrink-0">
          <div className="rounded-lg border p-4 space-y-4">
            {/* Category filter */}
            <div>
              <h3 className="font-semibold mb-2">{t('filter.category')}</h3>
              <div className="space-y-1">
                {categoriesQuery.isLoading && (
                  <div className="space-y-1" aria-busy="true">
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="h-7 w-full rounded bg-muted animate-pulse"
                      />
                    ))}
                  </div>
                )}
                {categoriesQuery.isError && (
                  <div className="space-y-2">
                    <p className="text-xs text-destructive">{t('error')}</p>
                    <button
                      type="button"
                      onClick={() => categoriesQuery.refetch()}
                      className="block w-full text-left text-sm px-2 py-1 rounded border hover:bg-muted"
                    >
                      {t('retry')}
                    </button>
                  </div>
                )}
                {!categoriesQuery.isLoading && !categoriesQuery.isError && (
                  <div data-testid="category-filter-list">
                    {visibleCategories.map((row) => {
                      const label = categoryLabel(row);
                      const active = selectedCategory === row.slug;
                      return (
                        <button
                          key={row.slug}
                          type="button"
                          data-testid="category-filter-option"
                          data-slug={row.slug}
                          aria-pressed={active}
                          onClick={() => {
                            setSelectedCategory(active ? null : row.slug);
                            setPage(1);
                          }}
                          className={`block w-full text-left text-sm px-2 py-1 rounded transition-colors ${
                            active
                              ? 'bg-primary text-primary-foreground'
                              : 'hover:bg-muted'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Size filter */}
            <div>
              <h3 className="font-semibold mb-2">{t('filter.size')}</h3>
              <div className="flex flex-wrap gap-2">
                {SIZES.map((size) => (
                  <button
                    key={size}
                    onClick={() => {
                      setSelectedSize(selectedSize === size ? null : size);
                      setPage(1);
                    }}
                    className={`border rounded px-3 py-1 text-sm transition-colors ${
                      selectedSize === size
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'hover:border-primary'
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>

            {/* Color filter */}
            <div>
              <h3 className="font-semibold mb-2">{t('filter.color')}</h3>
              <div className="grid grid-cols-4 gap-2">
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
                      className={`flex flex-col items-center gap-1 rounded p-1.5 transition-colors ${
                        active ? 'bg-primary/10 ring-2 ring-primary' : 'hover:bg-muted'
                      }`}
                      title={t(`filter.colors.${key}`)}
                    >
                      <span
                        className="block h-6 w-6 rounded-full border border-gray-300"
                        style={{ backgroundColor: hex }}
                      />
                      <span className="text-[10px] leading-tight text-center">
                        {t(`filter.colors.${key}`)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Price range filter */}
            <div>
              <h3 className="font-semibold mb-2">{t('filter.priceRange')}</h3>
              <div className="space-y-2">
                {PRICE_RANGES.map((range) => {
                  const checked = selectedPriceRange === range.key;
                  return (
                    <label
                      key={range.key}
                      className="flex items-center gap-2 text-sm cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setSelectedPriceRange(checked ? null : range.key);
                          setPage(1);
                        }}
                        className="rounded border-gray-300"
                      />
                      {t(`filter.priceRanges.${range.key}`)}
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Clear all button */}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="w-full text-sm text-center py-2 rounded border border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors"
              >
                {t('filter.clearAll')}
              </button>
            )}
          </div>
        </aside>

        <div className="flex-1">
          {isLoading && (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              {t('loading')}
            </div>
          )}

          {isError && (
            <div className="flex items-center justify-center py-20 text-destructive">
              {t('error')}
            </div>
          )}

          {!isLoading && !isError && products.length === 0 && (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              {t('empty')}
            </div>
          )}

          {products.length > 0 && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {products.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>

              {meta && meta.total_pages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-8">
                  <button
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page <= 1}
                    className="px-3 py-1 rounded border text-sm disabled:opacity-50 hover:bg-muted"
                  >
                    {t('prev')}
                  </button>
                  <span className="text-sm text-muted-foreground">
                    {page} / {meta.total_pages}
                  </span>
                  <button
                    onClick={() => setPage(Math.min(meta.total_pages, page + 1))}
                    disabled={page >= meta.total_pages}
                    className="px-3 py-1 rounded border text-sm disabled:opacity-50 hover:bg-muted"
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
  );
}
