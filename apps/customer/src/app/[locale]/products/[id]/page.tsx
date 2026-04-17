'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations, useLocale } from 'next-intl';
import { useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { AvailabilityCalendar } from '@/components/availability-calendar';
import { api } from '@/lib/api';
import { useCartStore } from '@/stores/cart-store';

const RENTAL_TIERS = [
  { days: 1, key: '1day' as const },
  { days: 3, key: '3day' as const },
  { days: 5, key: '5day' as const },
];

/**
 * Calculate rental price based on number of days.
 * - 1 day: use 1-day price
 * - 2-3 days: use 3-day price
 * - 4-5 days: use 5-day price
 * - >5 days: price_5day + extra_day_rate * (days - 5)
 */
function calculateRentalPrice(
  days: number,
  prices: { '1day': number; '3day': number; '5day': number },
  extraDayRate: number
): number {
  if (days <= 0) return 0;
  if (days === 1) return prices['1day'];
  if (days === 2 || days === 3) return prices['3day'];
  if (days === 4 || days === 5) return prices['5day'];
  // days > 5: 5-day price + extra rate per additional day
  if (extraDayRate > 0) {
    return prices['5day'] + extraDayRate * (days - 5);
  }
  // Fallback if no extra day rate: linear from 5-day price
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

  const { data, isLoading, isError } = useQuery({
    queryKey: ['product', productId, locale],
    queryFn: () => api.products.detail(productId, locale),
    enabled: !!productId,
  });

  const product = data?.data;

  // The actual rental days — from calendar range or preset buttons
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
    // If start === end (single date / 3rd-click reset), clear end date display
    setSelectedEndDate(startDate === endDate ? null : endDate);
    setCustomDays(days);
    setSelectedRentalDays(days === 1 || days === 3 || days === 5 ? days : selectedRentalDays);
  }

  function handlePresetClick(days: number) {
    setSelectedRentalDays(days);
    setCustomDays(null);
    // Clear range selection since preset overrides
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
      <div className="container py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-4 w-32 bg-muted rounded" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="aspect-[3/4] bg-muted rounded-lg" />
            <div className="space-y-4">
              <div className="h-8 w-64 bg-muted rounded" />
              <div className="h-4 w-48 bg-muted rounded" />
              <div className="h-20 bg-muted rounded" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isError || !product) {
    return (
      <div className="container py-8 text-center text-muted-foreground">
        {t('notFound')}
      </div>
    );
  }

  const hasExtraDayRate = (product.extra_day_rate ?? 0) > 0;

  return (
    <div className="container py-8">
      <Link
        href="/products"
        className="text-sm text-muted-foreground hover:text-primary mb-6 inline-block"
      >
        &larr; {t('backToProducts')}
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Image Gallery */}
        <div className="space-y-4">
          <div className="aspect-[3/4] rounded-lg bg-muted overflow-hidden">
            {product.images.length > 0 ? (
              <img
                src={product.images[selectedImage]?.url}
                alt={product.images[selectedImage]?.alt_text ?? product.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                {product.name}
              </div>
            )}
          </div>
          {product.images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto">
              {product.images.map((img, idx) => (
                <button
                  key={img.id}
                  onClick={() => setSelectedImage(idx)}
                  className={`w-16 h-20 rounded border overflow-hidden shrink-0 ${
                    idx === selectedImage ? 'ring-2 ring-primary' : ''
                  }`}
                >
                  <img src={img.url} alt={img.alt_text ?? ''} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Product Info */}
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold">{product.name}</h1>
            {product.brand && (
              <p className="text-muted-foreground mt-1">{typeof product.brand === 'string' ? product.brand : product.brand}</p>
            )}
          </div>

          {product.description && (
            <div>
              <h3 className="font-semibold mb-2">{t('description')}</h3>
              <p className="text-muted-foreground text-sm">{product.description}</p>
            </div>
          )}

          {/* Combo Items (if combo set) */}
          {product.combo_items && product.combo_items.length > 0 && (
            <div>
              <h3 className="font-semibold mb-2">{t('includedItems')}</h3>
              <div className="space-y-2">
                {product.combo_items.map((item) => (
                  <Link
                    key={item.id}
                    href={`/products/${item.product_id}`}
                    className="flex items-center gap-3 rounded-lg border p-3 hover:shadow-sm transition-shadow"
                  >
                    <div className="w-12 h-16 bg-muted rounded shrink-0 overflow-hidden">
                      {item.product_thumbnail && (
                        <img src={item.product_thumbnail} alt={item.product_name} className="w-full h-full object-cover" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{item.product_name}</p>
                      <p className="text-xs text-muted-foreground">{item.product_sku}{item.label ? ` • ${item.label}` : ''}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Rental Price Tiers */}
          <div>
            <h3 className="font-semibold mb-2">{t('rentalPricing')}</h3>
            <div className="grid grid-cols-3 gap-2">
              {RENTAL_TIERS.map((tier) => (
                <button
                  key={tier.days}
                  onClick={() => handlePresetClick(tier.days)}
                  className={`rounded-lg border p-3 text-center transition-colors ${
                    selectedRentalDays === tier.days && customDays === null
                      ? 'border-primary bg-primary/5'
                      : 'hover:border-primary/50'
                  }`}
                >
                  <div className="text-xs text-muted-foreground">
                    {tier.days} {t('days')}
                  </div>
                  <div className="text-lg font-bold mt-1">
                    {(product.rental_prices?.[tier.key] ?? 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground">{product.currency}</div>
                </button>
              ))}
            </div>
            {hasExtraDayRate && (
              <p className="text-xs text-muted-foreground mt-2">
                {t('extraDayNote', { rate: (product.extra_day_rate ?? 0).toLocaleString() })}
              </p>
            )}
          </div>

          {/* Size & Color filters — clicking refetches calendar */}
          <div className="flex gap-8">
            {(product.size?.length ?? 0) > 0 && (
              <div>
                <h3 className="font-semibold mb-2">{t('selectSize')}</h3>
                <div className="flex gap-2">
                  {product.size.map((s) => (
                    <button
                      key={s}
                      onClick={() => setSelectedSize(selectedSize === s ? null : s)}
                      className={`border rounded-md px-3 py-1 text-sm transition-colors ${
                        selectedSize === s
                          ? 'border-primary bg-primary/10 text-primary font-medium'
                          : 'hover:border-primary/50'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {(product.color?.length ?? 0) > 0 && (
              <div>
                <h3 className="font-semibold mb-2">{t('color')}</h3>
                <div className="flex gap-2">
                  {product.color.map((c) => (
                    <button
                      key={c}
                      onClick={() => setSelectedColor(selectedColor === c ? null : c)}
                      className={`border rounded-md px-3 py-1 text-sm capitalize transition-colors ${
                        selectedColor === c
                          ? 'border-primary bg-primary/10 text-primary font-medium'
                          : 'hover:border-primary/50'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Deposit */}
          {(product.deposit ?? 0) > 0 && (
            <div className="text-sm text-muted-foreground">
              {t('depositNote')}: <span className="font-semibold text-foreground">{(product.deposit ?? 0).toLocaleString()} {product.currency}</span>
            </div>
          )}

          {/* Retail reference price */}
          {product.ref_price > 0 && (
            <div className="text-xs text-muted-foreground">
              {t('retailPrice')}: <span className="line-through">{product.ref_price.toLocaleString()} {product.currency}</span>
            </div>
          )}

          {/* Calendar — date range selection */}
          <AvailabilityCalendar
            productId={productId}
            onSelectRange={handleRangeSelect}
            selectedSize={selectedSize}
            selectedColor={selectedColor}
          />

          {/* Add to Cart — shows calculated total */}
          <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/50">
            <div>
              <span className="text-sm text-muted-foreground">{t('totalRental')}</span>
              <p className="text-2xl font-bold">{rentalPrice.toLocaleString()} THB</p>
              <span className="text-xs text-muted-foreground">
                {actualDays} {t('days')}
                {selectedStartDate ? ` • ${selectedStartDate}` : ''}
                {selectedEndDate ? ` → ${selectedEndDate}` : ''}
              </span>
              {customDays && customDays > 5 && hasExtraDayRate && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  ({(product.rental_prices?.['5day'] ?? 0).toLocaleString()} + {(product.extra_day_rate ?? 0) * (customDays - 5)} extra)
                </p>
              )}
            </div>
            <Button size="lg" onClick={handleAddToCart} disabled={!selectedStartDate}>
              {added ? t('added') : t('addToCart')}
            </Button>
          </div>

          {/* Related SKUs */}
          {product.related_skus.length > 0 && (
            <div>
              <h3 className="font-semibold mb-3">{t('relatedProducts')}</h3>
              <div className="grid grid-cols-2 gap-3">
                {product.related_skus.map((rp) => (
                  <Link
                    key={rp.id}
                    href={`/products/${rp.id}`}
                    className="flex items-center gap-3 rounded-lg border p-3 hover:shadow-sm transition-shadow"
                  >
                    <div className="w-12 h-16 bg-muted rounded shrink-0 overflow-hidden">
                      {rp.thumbnail && (
                        <img src={rp.thumbnail} alt={rp.name} className="w-full h-full object-cover" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-medium line-clamp-1">{rp.name}</p>
                      <p className="text-xs text-muted-foreground">{rp.price_1day.toLocaleString()} THB/day</p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
