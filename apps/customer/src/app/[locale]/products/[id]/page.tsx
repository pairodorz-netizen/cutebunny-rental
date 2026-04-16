import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';

export default function ProductDetailPage() {
  const t = useTranslations('products.detail');

  return (
    <div className="container py-8">
      <Link
        href="/products"
        className="text-sm text-muted-foreground hover:text-primary mb-6 inline-block"
      >
        &larr; {t('backToProducts')}
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="aspect-[3/4] rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
          {t('title')}
        </div>

        <div className="space-y-6">
          <h1 className="text-3xl font-bold">{t('title')}</h1>

          <div>
            <h3 className="font-semibold mb-2">{t('description')}</h3>
            <p className="text-muted-foreground">
              Lorem ipsum dolor sit amet, consectetur adipiscing elit.
            </p>
          </div>

          <div>
            <h3 className="font-semibold mb-2">{t('selectSize')}</h3>
            <div className="flex gap-2">
              {['XS', 'S', 'M', 'L', 'XL'].map((size) => (
                <button
                  key={size}
                  className="border rounded-md px-4 py-2 text-sm hover:border-primary hover:text-primary transition-colors"
                >
                  {size}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3 className="font-semibold mb-2">{t('selectDates')}</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-muted-foreground">{t('startDate')}</label>
                <input
                  type="date"
                  className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">{t('endDate')}</label>
                <input
                  type="date"
                  className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/50">
            <div>
              <span className="text-sm text-muted-foreground">{t('totalRental')}</span>
              <p className="text-2xl font-bold">1,500 THB</p>
              <span className="text-xs text-muted-foreground">3 {t('days')}</span>
            </div>
            <Button size="lg">{t('addToCart')}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
