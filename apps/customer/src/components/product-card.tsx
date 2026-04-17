'use client';

import { Link } from '@/i18n/routing';
import { useTranslations } from 'next-intl';
import type { ProductListItem } from '@/lib/api';

export function ProductCard({ product }: { product: ProductListItem }) {
  const t = useTranslations('products');

  return (
    <Link
      href={`/products/${product.id}`}
      className="group rounded-lg border bg-card overflow-hidden hover:shadow-md transition-shadow"
    >
      <div className="aspect-[3/4] bg-muted relative overflow-hidden">
        {product.thumbnail ? (
          <img
            src={product.thumbnail}
            alt={product.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
            {product.name}
          </div>
        )}
        {product.rental_count > 10 && (
          <span className="absolute top-2 left-2 bg-primary text-primary-foreground text-xs px-2 py-1 rounded-full">
            {t('card.popular')}
          </span>
        )}
      </div>
      <div className="p-4">
        <h3 className="font-medium group-hover:text-primary transition-colors line-clamp-1">
          {product.name}
        </h3>
        {product.brand && (
          <p className="text-xs text-muted-foreground mt-0.5">{product.brand}</p>
        )}
        <p className="text-sm text-muted-foreground mt-1">
          {t('card.rentFrom')} {product.rental_prices['1day'].toLocaleString()} {product.currency}
          {t('card.perDay')}
        </p>
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-primary font-medium">
            {t('card.viewDetails')}
          </span>
          {product.rental_count > 0 && (
            <span className="text-xs text-muted-foreground">
              {product.rental_count} {t('card.rented')}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
