'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations, useLocale } from 'next-intl';
import { useState } from 'react';
import { api, type Category } from '@/lib/api';
import { ProductCard } from '@/components/product-card';

const SIZES = ['XS', 'S', 'M', 'L', 'XL'];

// BUG-504-A04: customer category filter is now backed by the A02 public
// endpoint. The previous hardcoded slug array + capitalize hack is gone;
// labels come from name_th / name_en and re-render on locale switch via
// `useLocale()`. Hidden categories (`visible_frontend=false`) are
// filtered out client-side so A02 stays a single source of truth for
// both customer and admin reads.
export default function ProductsPage() {
  const t = useTranslations('products');
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.categories.list(),
    // A02 emits Cache-Control: public, max-age=300 — React Query's
    // client cache mirrors that so repeated navigations stay fast.
    staleTime: 5 * 60 * 1000,
  });

  const visibleCategories: Category[] = (categoriesQuery.data?.data ?? [])
    .filter((row) => row.visible_frontend);

  const params: Record<string, string> = {
    locale,
    page: String(page),
    per_page: '12',
  };
  if (selectedSize) params.size = selectedSize;
  if (selectedColor) params.color = selectedColor;
  if (selectedCategory) params.category = selectedCategory;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['products', params],
    queryFn: () => api.products.list(params),
  });

  const products = data?.data ?? [];
  const meta = data?.meta;

  function categoryLabel(row: Category): string {
    return locale === 'th' ? row.name_th : row.name_en;
  }

  return (
    <div className="container py-8">
      <h1 className="text-3xl font-bold mb-8">{t('title')}</h1>

      <div className="flex flex-col md:flex-row gap-8">
        <aside className="w-full md:w-64 shrink-0">
          <div className="rounded-lg border p-4 space-y-4">
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
                          onClick={() =>
                            setSelectedCategory(active ? null : row.slug)
                          }
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
            <div>
              <h3 className="font-semibold mb-2">{t('filter.size')}</h3>
              <div className="flex flex-wrap gap-2">
                {SIZES.map((size) => (
                  <button
                    key={size}
                    onClick={() => setSelectedSize(selectedSize === size ? null : size)}
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
