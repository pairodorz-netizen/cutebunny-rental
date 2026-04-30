'use client';

import { useTranslations, useLocale } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@/i18n/routing';
import { api, type ProductListItem } from '@/lib/api';
import { ProductCard } from '@/components/product-card';
import { ChevronRight, ChevronLeft, Truck, Sparkles } from 'lucide-react';
import { useRef } from 'react';

export default function HomePage() {
  const t = useTranslations();
  const locale = useLocale();

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

  const popularProducts: ProductListItem[] = popularQuery.data?.data ?? [];
  const newProducts: ProductListItem[] = newArrivalsQuery.data?.data ?? [];
  const totalCount = allProductsQuery.data?.meta?.total ?? 0;

  const popularScrollRef = useRef<HTMLDivElement>(null);
  const newScrollRef = useRef<HTMLDivElement>(null);

  function scrollCarousel(ref: React.RefObject<HTMLDivElement | null>, dir: 'left' | 'right') {
    if (!ref.current) return;
    const amount = ref.current.clientWidth * 0.8;
    ref.current.scrollBy({ left: dir === 'left' ? -amount : amount, behavior: 'smooth' });
  }

  return (
    <div>
      {/* Announcement Banner */}
      <div className="flex justify-center py-3">
        <span className="inline-flex items-center gap-2 rounded-full px-5 py-1.5 text-xs font-semibold text-white" style={{ background: 'linear-gradient(135deg, #E8837C, #D4A28A)' }}>
          <Sparkles className="h-3.5 w-3.5" />
          {t('home.banner.newArrival')}
        </span>
      </div>

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
                style={{ fontSize: 68, fontWeight: 500, lineHeight: 1.02, letterSpacing: '-0.03em', whiteSpace: 'pre-line' as const }}
              >
                {t('home.hero.titleLine1')}<br />
                <span className="italic" style={{ color: '#9F848D', fontWeight: 400 }}>{t('home.hero.titleLine2')}</span>
                <br />
                {t('home.hero.titleLine3')}
              </h1>
              <p className="font-sans-thai text-lg md:text-xl text-cb-secondary mb-8 max-w-lg">
                {t('home.hero.subtitle')}
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
              {/* Floating price overlay */}
              {(popularProducts[0] || newProducts[0]) && (
                <div className="absolute -bottom-3 -right-2 bg-white rounded-xl shadow-md px-4 py-2.5 z-10">
                  <p className="text-[10px] font-medium text-cb-secondary uppercase tracking-wider">{t('home.popup.recommended')}</p>
                  <p className="text-sm font-bold text-cb-heading">
                    + ฿{((popularProducts[0] || newProducts[0])?.rental_prices?.['1day'] ?? 0).toLocaleString()}
                    <span className="text-xs font-normal text-cb-secondary"> {t('home.popup.perDay')}</span>
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="py-6">
        <div className="container">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <div className="inline-flex items-center gap-3 rounded-full bg-white shadow-sm border border-border px-6 py-3">
              <span className="text-lg">👗</span>
              <span className="text-xl font-bold text-cb-heading">{allProductsQuery.isLoading ? '—' : totalCount}</span>
              <span className="text-sm text-cb-secondary">{t('home.stats.totalDresses')}</span>
            </div>
            <div className="inline-flex items-center gap-3 rounded-full bg-white shadow-sm border border-border px-6 py-3">
              <Truck className="h-5 w-5 text-cb-blue-300" />
              <span className="text-sm font-medium text-cb-heading">{t('home.stats.fastDelivery')}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Popular This Week Carousel */}
      <section className="py-12">
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
            <div className="relative group/carousel">
              <div ref={popularScrollRef} className="flex gap-4 overflow-x-auto scrollbar-hide pb-4 scroll-smooth">
                {popularProducts.slice(0, 8).map((product, idx) => (
                  <div key={product.id} className="shrink-0 w-[calc(25%-12px)] min-w-[200px]">
                    <ProductCard product={product} badge={idx < 2 ? 'bestseller' : undefined} />
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => scrollCarousel(popularScrollRef, 'left')}
                className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-3 w-10 h-10 rounded-full bg-white shadow-md flex items-center justify-center text-cb-heading hover:scale-110 transition-transform z-10"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => scrollCarousel(popularScrollRef, 'right')}
                className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-3 w-10 h-10 rounded-full bg-white shadow-md flex items-center justify-center text-cb-heading hover:scale-110 transition-transform z-10"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Just Arrived Carousel */}
      <section className="py-12">
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
            <div className="relative group/carousel">
              <div ref={newScrollRef} className="flex gap-4 overflow-x-auto scrollbar-hide pb-4 scroll-smooth">
                {newProducts.slice(0, 8).map((product) => (
                  <div key={product.id} className="shrink-0 w-[calc(25%-12px)] min-w-[200px]">
                    <ProductCard product={product} badge="new" />
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => scrollCarousel(newScrollRef, 'left')}
                className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-3 w-10 h-10 rounded-full bg-white shadow-md flex items-center justify-center text-cb-heading hover:scale-110 transition-transform z-10"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => scrollCarousel(newScrollRef, 'right')}
                className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-3 w-10 h-10 rounded-full bg-white shadow-md flex items-center justify-center text-cb-heading hover:scale-110 transition-transform z-10"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          )}
        </div>
      </section>


    </div>
  );
}
