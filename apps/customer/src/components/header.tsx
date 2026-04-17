'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { LocaleSwitcher } from './locale-switcher';
import { ShoppingBag } from 'lucide-react';
import { useCartStore } from '@/stores/cart-store';

export function Header() {
  const t = useTranslations('nav');
  const itemCount = useCartStore((s) => s.items.length);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-xl font-bold text-primary">CuteBunny</span>
        </Link>
        <nav className="hidden md:flex items-center gap-6">
          <Link href="/" className="text-sm font-medium hover:text-primary transition-colors">
            {t('home')}
          </Link>
          <Link
            href="/products"
            className="text-sm font-medium hover:text-primary transition-colors"
          >
            {t('products')}
          </Link>
        </nav>
        <div className="flex items-center gap-4">
          <Link href="/cart" className="relative flex items-center gap-1 text-sm font-medium hover:text-primary transition-colors">
            <ShoppingBag className="h-5 w-5" />
            {itemCount > 0 && (
              <span className="absolute -top-2 -right-2 bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs">
                {itemCount}
              </span>
            )}
          </Link>
          <LocaleSwitcher />
        </div>
      </div>
    </header>
  );
}
