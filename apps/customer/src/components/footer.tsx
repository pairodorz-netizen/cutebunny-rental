import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';

export function Footer() {
  const t = useTranslations();

  return (
    <footer className="border-t py-8 mt-auto">
      <div className="container flex flex-col items-center gap-4 text-sm text-muted-foreground">
        <nav className="flex gap-4">
          <Link href="/privacy-policy" className="hover:text-foreground transition-colors">
            {t('footer.privacyPolicy')}
          </Link>
          <span aria-hidden="true">|</span>
          <Link href="/terms-of-service" className="hover:text-foreground transition-colors">
            {t('footer.termsOfService')}
          </Link>
        </nav>
        <div>
          &copy; {new Date().getFullYear()} {t('common.appName')}
        </div>
      </div>
    </footer>
  );
}
