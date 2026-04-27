'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/routing';
import { Search, Heart, ShoppingBag, User, Menu, X } from 'lucide-react';
import { useCartStore } from '@/stores/cart-store';
import { useState } from 'react';

export function Header() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const itemCount = useCartStore((s) => s.items.length);
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems = [
    { href: '/' as const, label: t('home') },
    { href: '/products' as const, label: t('products') },
    { href: '/profile' as const, label: t('profile') },
  ];

  function isActive(href: string) {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  }

  return (
    <header className="sticky top-0 z-50 w-full bg-white/90 backdrop-blur-md border-b border-border/40">
      <div className="container flex h-16 items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <div className="w-8 h-8 rounded-full bg-cb-pink flex items-center justify-center">
            <span className="text-white text-sm font-bold">🐰</span>
          </div>
          <span className="text-lg font-display font-semibold text-cb-heading">CuteBunny</span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                isActive(item.href)
                  ? 'bg-cb-active text-cb-active-fg'
                  : 'text-cb-heading hover:bg-cb-surface'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Right icons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="p-2 rounded-full hover:bg-cb-surface transition-colors text-cb-heading"
            aria-label="Search"
          >
            <Search className="h-5 w-5" />
          </button>
          <button
            type="button"
            className="p-2 rounded-full hover:bg-cb-surface transition-colors text-cb-heading"
            aria-label="Wishlist"
          >
            <Heart className="h-5 w-5" />
          </button>
          <Link
            href="/cart"
            className="relative p-2 rounded-full hover:bg-cb-surface transition-colors text-cb-heading"
          >
            <ShoppingBag className="h-5 w-5" />
            {itemCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-cb-active text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold">
                {itemCount}
              </span>
            )}
          </Link>
          <Link
            href="/profile"
            className="p-2 rounded-full hover:bg-cb-surface transition-colors text-cb-heading hidden md:flex"
          >
            <User className="h-5 w-5" />
          </Link>

          {/* Mobile menu toggle */}
          <button
            type="button"
            className="md:hidden p-2 rounded-full hover:bg-cb-surface transition-colors text-cb-heading"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Menu"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Nav */}
      {mobileOpen && (
        <div className="md:hidden border-t border-border/40 bg-white/95 backdrop-blur-md">
          <nav className="container py-4 flex flex-col gap-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                  isActive(item.href)
                    ? 'bg-cb-active text-cb-active-fg'
                    : 'text-cb-heading hover:bg-cb-surface'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
