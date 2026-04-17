import { useTranslations } from 'next-intl';

export function Footer() {
  const t = useTranslations('common');

  return (
    <footer className="border-t py-8 mt-auto">
      <div className="container text-center text-sm text-muted-foreground">
        &copy; {new Date().getFullYear()} {t('appName')}
      </div>
    </footer>
  );
}
