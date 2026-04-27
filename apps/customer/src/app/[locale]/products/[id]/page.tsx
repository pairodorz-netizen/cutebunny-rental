'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations, useLocale } from 'next-intl';
import { useState, useMemo, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { AvailabilityCalendar } from '@/components/availability-calendar';
import { DeliveryMethodSelector, ReturnMethodDisplay } from '@/components/delivery-method-selector';
import type { DeliveryMethodType } from '@/components/delivery-method-selector';
import { api, type ProductListItem } from '@/lib/api';
import { useCartStore } from '@/stores/cart-store';
import { ProductCard } from '@/components/product-card';
import { Star, ChevronLeft, ChevronRight, ShoppingBag } from 'lucide-react';

const RENTAL_TIERS = [
  { days: 1, key: '1day' as const },
  { days: 3, key: '3day' as const },
  { days: 5, key: '5day' as const },
];

function calculateRentalPrice(
  days: number,
  prices: { '1day': number; '3day': number; '5day': number },
  extraDayRate: number
): number {
  if (days <= 0) return 0;
  if (days === 1) return prices['1day'];
  if (days === 2 || days === 3) return prices['3day'];
  if (days === 4 || days === 5) return prices['5day'];
  if (extraDayRate > 0) {
    return prices['5day'] + extraDayRate * (days - 5);
  }
  const perDay = Math.round(prices['5day'] / 5);
  return prices['5day'] + perDay * (days - 5);
}

export default function ProductDetailPage() {
  const t = useTranslations('products.detail');
  const locale = useLocale();
  const params = useParams();
  const productId = params.id as string;
  const addItem = useCartStore((s) => s.addItem);

  const [selectedRentalDays, setSelectedRentalDays] = useState(3);
  const [selectedStartDate, setSelectedStartDate] = useState<string | null>(null);
  const [selectedEndDate, setSelectedEndDate] = useState<string | null>(null);
  const [customDays, setCustomDays] = useState<number | null>(null);
  const [selectedImage, setSelectedImage] = useState(0);
  const [added, setAdded] = useState(false);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethodType>('standard');
  const [messengerEnabled, setMessengerEnabled] = useState(false);
  const setCartDeliveryMethod = useCartStore((s) => s.setDeliveryMethod);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api.settings.messenger();
        if (!cancelled) {
          setMessengerEnabled(result.data.enabled);
        }
      } catch {
        // default to disabled
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['product', productId, locale],
    queryFn: () => api.products.detail(productId, locale),
    enabled: !!productId,
  });

  const product = data?.data;

  // Fetch similar/recommended products
  const similarQuery = useQuery({
    queryKey: ['products', 'similar', product?.category, locale],
    queryFn: () => api.products.list({
      locale,
      page: '1',
      per_page: '4',
      category: product?.category ?? '',
    }),
    enabled: !!product?.category,
    staleTime: 5 * 60 * 1000,
  });
  const similarProducts: ProductListItem[] = (similarQuery.data?.data ?? []).filter(
    (p) => p.id !== productId
  ).slice(0, 4);

  const actualDays = customDays ?? selectedRentalDays;

  const rentalPrice = useMemo(() => {
    if (!product) return 0;
    return calculateRentalPrice(
      actualDays,
      product.rental_prices ?? { '1day': 0, '3day': 0, '5day': 0 },
      product.extra_day_rate ?? 0
    );
  }, [product, actualDays]);

  const pricePerDay = actualDays > 0 ? Math.round(rentalPrice / actualDays) : 0;

  function handleRangeSelect(startDate: string, endDate: string, days: number) {
    setSelectedStartDate(startDate);
    setSelectedEndDate(startDate === endDate ? null : endDate);
    setCustomDays(days);
    setSelectedRentalDays(days === 1 || days === 3 || days === 5 ? days : selectedRentalDays);
  }

  function handlePresetClick(days: number) {
    setSelectedRentalDays(days);
    setCustomDays(null);
    setSelectedEndDate(null);
  }

  function handleAddToCart() {
    if (!selectedStartDate || !product) return;
    addItem({
      product_id: product.id,
      product_name: product.name,
      thumbnail: product.images?.[0]?.url ?? product.thumbnail ?? null,
      rental_days: actualDays,
      rental_start: selectedStartDate,
      price_per_day: pricePerDay,
      subtotal: rentalPrice,
      deposit: product.deposit ?? 0,
      size: selectedSize ?? product.size?.[0] ?? 'ONE',
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  }

  if (isLoading) {
    return (
      <div className="bg-cb-surface min-h-screen">
        <div className="container py-8">
          <div className="animate-pulse space-y-4">
            <div className="h-4 w-32 bg-muted rounded" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-3">
                <div className="aspect-[3/4] bg-muted rounded-2xl" style={{ height: 680 }} />
              </div>
              <div className="space-y-4">
                <div className="h-8 w-64 bg-muted rounded" />
                <div className="h-4 w-48 bg-muted rounded" />
                <div className="h-20 bg-muted rounded-2xl" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isError || !product) {
    return (
      <div className="bg-cb-surface min-h-screen flex items-center justify-center">
        <div className="text-center text-cb-secondary">{t('notFound')}</div>
      </div>
    );
  }

  const hasExtraDayRate = (product.extra_day_rate ?? 0) > 0;

  return (
    <div className="bg-cb-surface min-h-screen">
      <div className="container py-8">
        {/* Back link */}
        <Link
          href="/products"
          className="inline-flex items-center gap-1.5 text-sm text-cb-secondary hover:text-cb-active mb-6 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          {t('backToProducts')}
        </Link>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12">
          {/* Image Gallery — Left: thumbnail rail + main photo */}
          <div className="flex gap-4">
            {/* Thumbnail rail */}
            {product.images.length > 1 && (
              <div className="hidden md:flex flex-col gap-2 w-20 shrink-0">
                {product.images.map((img, idx) => (
                  <button
                    key={img.id}
                    onClick={() => setSelectedImage(idx)}
                    className={`w-20 h-24 rounded-xl overflow-hidden border-2 transition-all ${
                      idx === selectedImage
                        ? 'border-cb-active ring-2 ring-cb-active/20'
                        : 'border-transparent hover:border-border'
                    }`}
                  >
                    <img src={img.url} alt={img.alt_text ?? ''} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
            {/* Main photo */}
            <div className="flex-1 rounded-2xl bg-white overflow-hidden shadow-soft" style={{ height: 680 }}>
              {product.images.length > 0 ? (
                <img
                  src={product.images[selectedImage]?.url}
                  alt={product.images[selectedImage]?.alt_text ?? product.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-cb-secondary">
                  {product.name}
                </div>
              )}
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-6">
            {/* Product name + rating */}
            <div>
              {product.brand && (
                <p className="text-xs font-medium text-cb-secondary uppercase tracking-wider mb-1">
                  {typeof product.brand === 'string' ? product.brand : product.brand}
                </p>
              )}
              <h1 className="text-2xl md:text-3xl font-display font-semibold text-cb-heading">
                {product.name}
              </h1>
              <div className="flex items-center gap-1 mt-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star key={star} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                ))}
                <span className="text-xs text-cb-secondary ml-1">5.0</span>
              </div>
            </div>

            {/* Rental Price Table */}
            <div>
              <h3 className="text-sm font-semibold text-cb-heading mb-3">{t('rentalPricing')}</h3>
              <div className="grid grid-cols-3 gap-3">
                {RENTAL_TIERS.map((tier) => {
                  const isActive = selectedRentalDays === tier.days && customDays === null;
                  return (
                    <button
                      key={tier.days}
                      onClick={() => handlePresetClick(tier.days)}
                      className={`rounded-2xl border-2 p-4 text-center transition-all ${
                        isActive
                          ? 'border-cb-active bg-cb-active/5'
                          : 'border-border bg-white hover:border-cb-active/40'
                      }`}
                    >
                      <div className="text-xs text-cb-secondary">
                        {tier.days} {t('days')}
                      </div>
                      <div className="text-xl font-bold text-cb-heading mt-1">
                        ฿{(product.rental_prices?.[tier.key] ?? 0).toLocaleString()}
                      </div>
                    </button>
                  );
                })}
              </div>
              {hasExtraDayRate && (
                <p className="text-xs text-cb-secondary mt-2">
                  {t('extraDayNote', { rate: (product.extra_day_rate ?? 0).toLocaleString() })}
                </p>
              )}
            </div>

            {/* Size Selector */}
            {(product.size?.length ?? 0) > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-cb-heading mb-3">{t('selectSize')}</h3>
                <div className="flex gap-2">
                  {product.size.map((s) => (
                    <button
                      key={s}
                      onClick={() => setSelectedSize(selectedSize === s ? null : s)}
                      className={`rounded-full px-5 py-2 text-sm font-medium transition-all ${
                        selectedSize === s
                          ? 'bg-cb-active text-white'
                          : 'bg-white border border-border text-cb-heading hover:border-cb-active/40'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Color */}
            {(product.color?.length ?? 0) > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-cb-heading mb-3">{t('color')}</h3>
                <div className="flex gap-2">
                  {product.color.map((c) => (
                    <button
                      key={c}
                      onClick={() => setSelectedColor(selectedColor === c ? null : c)}
                      className={`rounded-full px-4 py-1.5 text-sm capitalize transition-all ${
                        selectedColor === c
                          ? 'bg-cb-active text-white'
                          : 'bg-white border border-border text-cb-heading hover:border-cb-active/40'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Delivery Options */}
            <DeliveryMethodSelector
              value={deliveryMethod}
              onChange={(m) => {
                setDeliveryMethod(m);
                setCartDeliveryMethod(m);
              }}
              messengerEnabled={messengerEnabled}
            />

            {deliveryMethod === 'messenger' && (
              <ReturnMethodDisplay rentalDays={actualDays} />
            )}

            {/* Calendar */}
            <AvailabilityCalendar
              productId={productId}
              onSelectRange={handleRangeSelect}
              selectedSize={selectedSize}
              selectedColor={selectedColor}
            />

            {/* Summary Bar */}
            <div className="rounded-2xl bg-white p-5 shadow-soft space-y-3">
              {/* Deposit */}
              {(product.deposit ?? 0) > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-cb-secondary">{t('depositNote')}</span>
                  <span className="font-semibold text-cb-heading">
                    ฿{(product.deposit ?? 0).toLocaleString()}
                  </span>
                </div>
              )}
              {/* Rental total */}
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm text-cb-secondary">{t('totalRental')}</span>
                  <p className="text-2xl font-bold text-cb-heading">
                    ฿{rentalPrice.toLocaleString()}
                  </p>
                  <span className="text-xs text-cb-secondary">
                    {actualDays} {t('days')}
                    {selectedStartDate ? ` • ${selectedStartDate}` : ''}
                    {selectedEndDate ? ` → ${selectedEndDate}` : ''}
                  </span>
                </div>
                <button
                  onClick={handleAddToCart}
                  disabled={!selectedStartDate}
                  className={`flex items-center gap-2 px-6 py-3.5 rounded-full font-medium text-sm transition-all ${
                    !selectedStartDate
                      ? 'bg-muted text-cb-secondary cursor-not-allowed'
                      : added
                        ? 'bg-emerald-500 text-white'
                        : 'bg-cb-active text-white hover:brightness-110 shadow-soft'
                  }`}
                >
                  <ShoppingBag className="h-4 w-4" />
                  {added ? t('added') : t('rentNow')}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Similar Dresses */}
        {similarProducts.length > 0 && (
          <section className="mt-16">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-display font-semibold text-cb-heading">
                {t('similarDresses')}
              </h2>
              <Link
                href="/products"
                className="flex items-center gap-1 text-sm font-medium text-cb-active hover:underline"
              >
                {t('viewAll')}
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {similarProducts.map((sp) => (
                <ProductCard key={sp.id} product={sp} />
              ))}
            </div>
          </section>
        )}

        {/* Related SKUs from API */}
        {product.related_skus.length > 0 && similarProducts.length === 0 && (
          <section className="mt-16">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-display font-semibold text-cb-heading">
                {t('relatedProducts')}
              </h2>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {product.related_skus.slice(0, 4).map((rp) => (
                <Link
                  key={rp.id}
                  href={`/products/${rp.id}`}
                  className="group rounded-2xl bg-white overflow-hidden hover:shadow-lift transition-all"
                >
                  <div className="aspect-[3/4] bg-muted overflow-hidden">
                    {rp.thumbnail && (
                      <img src={rp.thumbnail} alt={rp.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    )}
                  </div>
                  <div className="p-4">
                    <p className="text-sm font-medium text-cb-heading line-clamp-1">{rp.name}</p>
                    <p className="text-sm font-semibold text-cb-heading mt-1">
                      ฿{rp.price_1day.toLocaleString()}
                      <span className="text-xs font-normal text-cb-secondary ml-1">/วัน</span>
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
