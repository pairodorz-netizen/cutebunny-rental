import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { LocaleSwitcher } from './locale-switcher';

export function Header() {
  const t = useTranslations('nav');

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
          <LocaleSwitcher />
        </div>
      </div>
    </header>
  );
}
