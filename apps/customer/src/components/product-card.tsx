'use client';

import { useState } from 'react';
import { Link } from '@/i18n/routing';
import { useTranslations } from 'next-intl';
import { Heart } from 'lucide-react';
import type { ProductListItem } from '@/lib/api';

interface ProductCardProps {
  product: ProductListItem;
  badge?: 'bestseller' | 'new';
}

export function ProductCard({ product, badge }: ProductCardProps) {
  const t = useTranslations('products');
  const [wishlisted, setWishlisted] = useState(false);

  return (
    <Link
      href={`/products/${product.id}`}
      className="group block rounded-2xl bg-white overflow-hidden hover:shadow-lift transition-all duration-300"
    >
      <div className="aspect-[3/4] bg-muted relative overflow-hidden">
        {product.thumbnail ? (
          <img
            src={product.thumbnail}
            alt={product.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-cb-secondary text-sm">
            {product.name}
          </div>
        )}
        {/* Badge */}
        {badge === 'bestseller' && (
          <span className="absolute top-3 left-3 bg-cb-active text-white text-[10px] font-bold uppercase px-2.5 py-1 rounded-full tracking-wide">
            Best Seller
          </span>
        )}
        {badge === 'new' && (
          <span className="absolute top-3 left-3 bg-cb-blue-100 text-cb-heading text-[10px] font-bold uppercase px-2.5 py-1 rounded-full tracking-wide">
            New
          </span>
        )}
        {!badge && product.is_popular && (
          <span className="absolute top-3 left-3 bg-cb-active text-white text-[10px] font-bold uppercase px-2.5 py-1 rounded-full tracking-wide">
            {t('card.popular')}
          </span>
        )}
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setWishlisted((v) => !v); }}
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/80 backdrop-blur-sm flex items-center justify-center hover:bg-white hover:scale-110 transition-all z-10"
          aria-label="Toggle wishlist"
        >
          <Heart
            className={`h-4 w-4 transition-colors ${wishlisted ? 'fill-red-400 text-red-400' : 'text-cb-heading/60'}`}
          />
        </button>
      </div>
      <div className="p-4">
        {product.brand && (
          <p className="text-[11px] font-medium text-cb-secondary uppercase tracking-wider mb-0.5">
            {product.brand}
          </p>
        )}
        <h3 className="font-medium text-sm text-cb-heading group-hover:text-cb-active transition-colors line-clamp-1">
          {product.name}
        </h3>
        <p className="text-sm font-semibold text-cb-heading mt-1.5">
          ฿{(product.rental_prices?.['1day'] ?? 0).toLocaleString()}
          <span className="text-xs font-normal text-cb-secondary ml-1">{t('card.perDay')}</span>
        </p>
        {/* Size dots */}
        {product.size && product.size.length > 0 && (
          <div className="flex gap-1 mt-2">
            {product.size.map((s) => (
              <span
                key={s}
                className="text-[9px] text-cb-secondary border border-border rounded px-1.5 py-0.5"
              >
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
