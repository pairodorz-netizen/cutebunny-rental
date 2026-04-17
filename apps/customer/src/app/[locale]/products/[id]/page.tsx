'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations, useLocale } from 'next-intl';
import { useState } from 'react';
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

export default function ProductDetailPage() {
  const t = useTranslations('products.detail');
  const locale = useLocale();
  const params = useParams();
  const productId = params.id as string;
  const addItem = useCartStore((s) => s.addItem);

  const [selectedRentalDays, setSelectedRentalDays] = useState(3);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState(0);
  const [added, setAdded] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['product', productId, locale],
    queryFn: () => api.products.detail(productId, locale),
    enabled: !!productId,
  });

  const product = data?.data;

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

  const rentalPrice =
    selectedRentalDays === 1
      ? product.rental_prices['1day']
      : selectedRentalDays === 3
        ? product.rental_prices['3day']
        : product.rental_prices['5day'];

  const pricePerDay = Math.round(rentalPrice / selectedRentalDays);

  function handleAddToCart() {
    if (!selectedDate || !product) return;
    addItem({
      product_id: product.id,
      product_name: product.name,
      thumbnail: product.images[0]?.url ?? product.thumbnail ?? null,
      rental_days: selectedRentalDays,
      rental_start: selectedDate,
      price_per_day: pricePerDay,
      subtotal: rentalPrice,
      deposit: product.deposit,
      size: product.size[0] ?? 'ONE',
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  }

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
              <p className="text-muted-foreground mt-1">{product.brand}</p>
            )}
            {product.rental_count > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                {product.rental_count} {t('timesRented')}
              </p>
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
                  onClick={() => setSelectedRentalDays(tier.days)}
                  className={`rounded-lg border p-3 text-center transition-colors ${
                    selectedRentalDays === tier.days
                      ? 'border-primary bg-primary/5'
                      : 'hover:border-primary/50'
                  }`}
                >
                  <div className="text-xs text-muted-foreground">
                    {tier.days} {t('days')}
                  </div>
                  <div className="text-lg font-bold mt-1">
                    {product.rental_prices[tier.key].toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground">{product.currency}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Size & Color */}
          <div className="flex gap-8">
            {product.size.length > 0 && (
              <div>
                <h3 className="font-semibold mb-2">{t('selectSize')}</h3>
                <div className="flex gap-2">
                  {product.size.map((s) => (
                    <span key={s} className="border rounded-md px-3 py-1 text-sm">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {product.color.length > 0 && (
              <div>
                <h3 className="font-semibold mb-2">{t('color')}</h3>
                <div className="flex gap-2">
                  {product.color.map((c) => (
                    <span key={c} className="border rounded-md px-3 py-1 text-sm capitalize">
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Deposit */}
          <div className="text-sm text-muted-foreground">
            {t('depositNote')}: <span className="font-semibold text-foreground">{product.deposit.toLocaleString()} {product.currency}</span>
          </div>

          {/* Retail reference price */}
          {product.ref_price > 0 && (
            <div className="text-xs text-muted-foreground">
              {t('retailPrice')}: <span className="line-through">{product.ref_price.toLocaleString()} {product.currency}</span>
            </div>
          )}

          {/* Calendar */}
          <AvailabilityCalendar
            productId={productId}
            onSelectDate={setSelectedDate}
            selectedDate={selectedDate}
          />

          {/* Add to Cart */}
          <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/50">
            <div>
              <span className="text-sm text-muted-foreground">{t('totalRental')}</span>
              <p className="text-2xl font-bold">{rentalPrice.toLocaleString()} THB</p>
              <span className="text-xs text-muted-foreground">
                {selectedRentalDays} {t('days')} {selectedDate ? `• ${selectedDate}` : ''}
              </span>
            </div>
            <Button size="lg" onClick={handleAddToCart} disabled={!selectedDate}>
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
