import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

export function ProductsPage() {
  const { t } = useTranslation();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('products.title')}</h1>
        <Button>{t('products.addProduct')}</Button>
      </div>
      <div className="rounded-lg border">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-4 text-sm font-medium">{t('products.name')}</th>
              <th className="text-left p-4 text-sm font-medium">{t('products.category')}</th>
              <th className="text-left p-4 text-sm font-medium">{t('products.price')}</th>
              <th className="text-left p-4 text-sm font-medium">{t('products.stock')}</th>
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
