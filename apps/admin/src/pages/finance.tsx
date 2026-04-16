import { useTranslation } from 'react-i18next';

export function FinancePage() {
  const { t } = useTranslation();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t('finance.title')}</h1>
      <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
        {t('finance.title')}
      </div>
    </div>
  );
}
