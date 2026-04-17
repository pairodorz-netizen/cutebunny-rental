'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/lib/api';
import { ProductCard } from '@/components/product-card';
import { useLocale } from 'next-intl';

const SIZES = ['XS', 'S', 'M', 'L', 'XL'];
const CATEGORIES = ['wedding', 'evening', 'cocktail', 'casual', 'costume', 'traditional'];

export default function ProductsPage() {
  const t = useTranslations('products');
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const params: Record<string, string> = {
    locale,
    page: String(page),
    per_page: '12',
  };
  if (selectedSize) params.size = selectedSize;
  if (selectedColor) params.color = selectedColor;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['products', params],
    queryFn: () => api.products.list(params),
  });

  const products = data?.data ?? [];
  const meta = data?.meta;

  return (
    <div className="container py-8">
      <h1 className="text-3xl font-bold mb-8">{t('title')}</h1>

      <div className="flex flex-col md:flex-row gap-8">
        <aside className="w-full md:w-64 shrink-0">
          <div className="rounded-lg border p-4 space-y-4">
            <div>
              <h3 className="font-semibold mb-2">{t('filter.category')}</h3>
              <div className="space-y-1">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
                    className={`block w-full text-left text-sm px-2 py-1 rounded capitalize transition-colors ${
                      selectedCategory === cat ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
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
