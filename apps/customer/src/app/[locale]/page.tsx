'use client';

import { useTranslations, useLocale } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@/i18n/routing';
import { api, type Category, type ProductListItem } from '@/lib/api';
import { ProductCard } from '@/components/product-card';
import { ChevronRight, Truck, User, Clock } from 'lucide-react';

export default function HomePage() {
  const t = useTranslations();
  const locale = useLocale();

  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.categories.list(),
    staleTime: 5 * 60 * 1000,
  });

  const popularQuery = useQuery({
    queryKey: ['products', 'popular', locale],
    queryFn: () => api.products.list({ locale, page: '1', per_page: '8', sort: 'popular' }),
    staleTime: 5 * 60 * 1000,
  });

  const newArrivalsQuery = useQuery({
    queryKey: ['products', 'new', locale],
    queryFn: () => api.products.list({ locale, page: '1', per_page: '8', sort: 'newest' }),
    staleTime: 5 * 60 * 1000,
  });

  const allProductsQuery = useQuery({
    queryKey: ['products', 'count', locale],
    queryFn: () => api.products.list({ locale, page: '1', per_page: '1' }),
    staleTime: 5 * 60 * 1000,
  });

  const categories: Category[] = (categoriesQuery.data?.data ?? []).filter((r) => r.visible_frontend);
  const popularProducts: ProductListItem[] = popularQuery.data?.data ?? [];
  const newProducts: ProductListItem[] = newArrivalsQuery.data?.data ?? [];
  const totalCount = allProductsQuery.data?.meta?.total ?? 0;

  function categoryLabel(row: Category): string {
    return locale === 'th' ? row.name_th : row.name_en;
  }

  return (
    <div>
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Decorative blobs */}
        <div className="absolute pointer-events-none" style={{ width: 500, height: 500, top: -100, right: -50, opacity: 0.6, background: 'radial-gradient(circle, #FFD1DC 0%, transparent 70%)' }} />
        <div className="absolute pointer-events-none" style={{ width: 400, height: 400, bottom: -80, left: -30, opacity: 0.5, background: 'radial-gradient(circle, #C3AED6 0%, transparent 70%)' }} />
        <div className="absolute pointer-events-none" style={{ width: 350, height: 350, top: '50%', left: '40%', opacity: 0.4, background: 'radial-gradient(circle, #B5EAD7 0%, transparent 70%)' }} />

        <div className="container relative py-16 md:py-24">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div className="text-center md:text-left">
              <h1
                className="font-serif text-cb-heading mb-4"
                style={{ fontSize: 68, fontWeight: 500, lineHeight: 1.02, letterSpacing: '-0.03em' }}
              >
                Wear the{' '}
                <span className="italic" style={{ color: '#9F848D', fontWeight: 400 }}>dream dress,</span>
                <br />
                keep the budget.
              </h1>
              <p className="font-sans-thai text-lg md:text-xl text-cb-secondary mb-8 max-w-lg">
                เช่าชุดสวย ในราคาที่คุณเอื้อมถึง — ชุดแบรนด์เนมพรีเมียม จัดส่งถึงบ้าน คืนง่าย ไม่ยุ่งยาก
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center md:justify-start">
                <Link
                  href="/products"
                  className="inline-flex items-center justify-center px-8 py-3.5 rounded-full bg-cb-active text-white font-medium text-sm hover:brightness-110 transition-all shadow-soft"
                >
                  {t('home.hero.cta')}
                </Link>
                <Link
                  href="/products?sort=popular"
                  className="inline-flex items-center justify-center px-8 py-3.5 rounded-full bg-white text-cb-heading font-medium text-sm border border-border hover:shadow-soft transition-all"
                >
                  {t('home.hero.ctaFeatured')}
                </Link>
              </div>
            </div>
            <div className="hidden md:flex justify-center">
              <div className="relative w-80 h-96">
                <div className="absolute top-0 right-0 w-64 h-80 rounded-2xl bg-cb-lavender-200/20 transform rotate-3" />
                <div className="absolute top-4 right-8 w-64 h-80 rounded-2xl bg-cb-lavender-300/20 transform -rotate-2" />
                <div className="absolute top-8 right-4 w-64 h-80 rounded-2xl bg-white shadow-card overflow-hidden">
                  {(popularProducts[0]?.thumbnail || newProducts[0]?.thumbnail) ? (
                    <img
                      src={(popularProducts[0]?.thumbnail || newProducts[0]?.thumbnail)!}
                      alt="Featured dress"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-pastel-gradient flex items-center justify-center">
                      <div className="text-center">
                        <div className="text-5xl mb-2">✨</div>
                        <span className="text-sm font-medium text-cb-secondary">CuteBunny</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="bg-white border-y" style={{ borderColor: '#EFEAF6' }}>
        <div className="container py-5">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-6 sm:gap-12">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-cb-lavender-100 flex items-center justify-center">
                <span className="text-cb-lavender-300 text-lg">👗</span>
              </div>
              <div>
                <span className="text-2xl font-bold text-cb-heading">{totalCount}</span>
                <span className="text-sm text-cb-secondary ml-2">{t('home.stats.totalDresses')}</span>
              </div>
            </div>
            <div className="hidden sm:block w-px h-8 bg-border" />
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-cb-blue-100 flex items-center justify-center">
                <Truck className="h-5 w-5 text-cb-blue-300" />
              </div>
              <div>
                <span className="text-sm font-medium text-cb-heading">{t('home.stats.fastDelivery')}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Category Strip */}
      <section className="py-12 bg-white">
        <div className="container">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-display font-semibold text-cb-heading">
              {t('home.categories.title')}
            </h2>
          </div>
          <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-4">
            {categoriesQuery.isLoading &&
              Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="shrink-0 w-28 h-36 rounded-2xl bg-muted animate-pulse"
                />
              ))}
            {categories.map((row) => (
              <Link
                key={row.slug}
                href={`/products?category=${row.slug}`}
                className="shrink-0 w-28 group"
              >
                <div className="w-28 h-28 rounded-2xl bg-gradient-to-br from-cb-lavender-100 to-cb-blue-100 flex items-center justify-center mb-2 group-hover:shadow-card transition-shadow">
                  <span className="text-3xl">👗</span>
                </div>
                <p className="text-xs font-medium text-cb-heading text-center line-clamp-2">
                  {categoryLabel(row)}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Popular This Week Carousel */}
      <section className="py-12 bg-cb-surface">
        <div className="container">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-display font-semibold text-cb-heading">
              {t('home.popular.title')}
            </h2>
            <Link
              href="/products?sort=popular"
              className="flex items-center gap-1 text-sm font-medium text-cb-active hover:underline"
            >
              {t('home.featured.viewAll')}
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
          {popularQuery.isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="aspect-[3/4] rounded-2xl bg-muted animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-4">
              {popularProducts.slice(0, 8).map((product, idx) => (
                <div key={product.id} className="shrink-0 w-64">
                  <ProductCard product={product} badge={idx < 2 ? 'bestseller' : undefined} />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Just Arrived Carousel */}
      <section className="py-12 bg-white">
        <div className="container">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-display font-semibold text-cb-heading">
              {t('home.newArrivals.title')}
            </h2>
            <Link
              href="/products?sort=newest"
              className="flex items-center gap-1 text-sm font-medium text-cb-active hover:underline"
            >
              {t('home.featured.viewAll')}
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
          {newArrivalsQuery.isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="aspect-[3/4] rounded-2xl bg-muted animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-4">
              {newProducts.slice(0, 8).map((product) => (
                <div key={product.id} className="shrink-0 w-64">
                  <ProductCard product={product} badge="new" />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Profile Section */}
      <section className="py-12 bg-pastel-gradient">
        <div className="container">
          <div className="rounded-2xl bg-white shadow-card p-8">
            <div className="flex flex-col md:flex-row gap-8">
              <div className="flex-1 flex items-center gap-6">
                <div className="w-16 h-16 rounded-full bg-cb-lavender-100 flex items-center justify-center shrink-0">
                  <User className="h-8 w-8 text-cb-lavender-300" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-cb-heading">{t('home.profile.title')}</h3>
                  <p className="text-sm text-cb-secondary mt-1">{t('home.profile.subtitle')}</p>
                </div>
              </div>
              <div className="flex-1 flex items-center gap-6">
                <div className="w-16 h-16 rounded-full bg-cb-blue-100 flex items-center justify-center shrink-0">
                  <Clock className="h-8 w-8 text-emerald-500" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-cb-heading">{t('home.profile.historyTitle')}</h3>
                  <p className="text-sm text-cb-secondary mt-1">{t('home.profile.historySubtitle')}</p>
                </div>
              </div>
              <div className="flex items-center">
                <Link
                  href="/profile"
                  className="inline-flex items-center justify-center px-6 py-3 rounded-full bg-cb-active text-white font-medium text-sm hover:brightness-110 transition-all"
                >
                  {t('home.profile.editProfile')}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
