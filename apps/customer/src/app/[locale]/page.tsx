'use client';

import { useTranslations, useLocale } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { api, type Category } from '@/lib/api';

// BUG-504-A04: the landing-page "Shop by Category" grid is now backed by
// the A02 public endpoint. Previous hardcoded 4-slug array + capitalize
// hack removed. We show the top-N `visible_frontend` rows ordered by
// `sort_order ASC` and render locale-aware labels.
const CATEGORY_GRID_LIMIT = 4;

export default function HomePage() {
  const t = useTranslations();
  const locale = useLocale();

  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.categories.list(),
    staleTime: 5 * 60 * 1000,
  });

  const gridCategories: Category[] = (categoriesQuery.data?.data ?? [])
    .filter((row) => row.visible_frontend)
    .slice(0, CATEGORY_GRID_LIMIT);

  function categoryLabel(row: Category): string {
    return locale === 'th' ? row.name_th : row.name_en;
  }

  return (
    <div>
      <section className="relative py-24 md:py-32 bg-gradient-to-b from-primary/5 to-background">
        <div className="container text-center">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
            {t('home.hero.title')}
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            {t('home.hero.subtitle')}
          </p>
          <Button asChild size="lg">
            <Link href="/products">{t('home.hero.cta')}</Link>
          </Button>
        </div>
      </section>

      <section className="py-16">
        <div className="container">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-3xl font-bold">{t('home.featured.title')}</h2>
            <Link href="/products" className="text-primary hover:underline text-sm font-medium">
              {t('home.featured.viewAll')}
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-lg border bg-card p-4 h-64 flex items-center justify-center text-muted-foreground"
              >
                {t('home.featured.title')} #{i}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 bg-secondary/30">
        <div className="container">
          <h2 className="text-3xl font-bold text-center mb-8">{t('home.categories.title')}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {categoriesQuery.isLoading &&
              Array.from({ length: CATEGORY_GRID_LIMIT }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-lg border bg-card p-6 h-[72px] animate-pulse"
                  aria-busy="true"
                />
              ))}
            {categoriesQuery.isError && (
              <div className="col-span-2 md:col-span-4 text-center space-y-2">
                <p className="text-sm text-destructive">{t('products.error')}</p>
                <button
                  type="button"
                  onClick={() => categoriesQuery.refetch()}
                  className="px-3 py-1 rounded border text-sm hover:bg-muted"
                >
                  {t('products.retry')}
                </button>
              </div>
            )}
            {!categoriesQuery.isLoading && !categoriesQuery.isError &&
              gridCategories.map((row) => (
                <Link
                  key={row.slug}
                  href={`/products?category=${row.slug}`}
                  className="rounded-lg border bg-card p-6 text-center hover:shadow-md transition-shadow"
                >
                  <span className="text-sm font-medium">
                    {categoryLabel(row)}
                  </span>
                </Link>
              ))}
          </div>
        </div>
      </section>
    </div>
  );
}
