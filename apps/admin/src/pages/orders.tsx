import { useTranslation } from 'react-i18next';

export function OrdersPage() {
  const { t } = useTranslation();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t('orders.title')}</h1>
      <div className="rounded-lg border">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-4 text-sm font-medium">{t('orders.orderNumber')}</th>
              <th className="text-left p-4 text-sm font-medium">{t('orders.customer')}</th>
              <th className="text-left p-4 text-sm font-medium">{t('orders.status')}</th>
              <th className="text-left p-4 text-sm font-medium">{t('orders.total')}</th>
              <th className="text-left p-4 text-sm font-medium">{t('orders.date')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={5} className="p-8 text-center text-muted-foreground">
                {t('common.loading')}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
