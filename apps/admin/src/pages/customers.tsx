import { useTranslation } from 'react-i18next';

export function CustomersPage() {
  const { t } = useTranslation();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t('customers.title')}</h1>
      <div className="rounded-lg border">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-4 text-sm font-medium">{t('customers.name')}</th>
              <th className="text-left p-4 text-sm font-medium">{t('customers.email')}</th>
              <th className="text-left p-4 text-sm font-medium">{t('customers.orders')}</th>
              <th className="text-left p-4 text-sm font-medium">{t('customers.joined')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={4} className="p-8 text-center text-muted-foreground">
                {t('common.loading')}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
