import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';

export default function ProductsPage() {
  const t = useTranslations('products');

  return (
    <div className="container py-8">
      <h1 className="text-3xl font-bold mb-8">{t('title')}</h1>

      <div className="flex flex-col md:flex-row gap-8">
        <aside className="w-full md:w-64 shrink-0">
          <div className="rounded-lg border p-4 space-y-4">
            <h3 className="font-semibold">{t('filter.category')}</h3>
            <div className="space-y-2 text-sm text-muted-foreground">
              {['wedding', 'evening', 'cocktail', 'casual', 'costume', 'traditional'].map(
                (cat) => (
                  <div key={cat} className="capitalize">
                    {cat}
                  </div>
                ),
              )}
            </div>
            <h3 className="font-semibold">{t('filter.size')}</h3>
            <div className="flex gap-2 text-sm text-muted-foreground">
              {['XS', 'S', 'M', 'L', 'XL'].map((size) => (
                <span key={size} className="border rounded px-2 py-1">
                  {size}
                </span>
              ))}
            </div>
            <h3 className="font-semibold">{t('filter.priceRange')}</h3>
            <div className="text-sm text-muted-foreground">0 - 10,000 THB</div>
          </div>
        </aside>

        <div className="flex-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Link
                key={i}
                href={`/products/${i}`}
                className="group rounded-lg border bg-card overflow-hidden hover:shadow-md transition-shadow"
              >
                <div className="aspect-[3/4] bg-muted flex items-center justify-center text-muted-foreground">
                  {t('title')} #{i}
                </div>
                <div className="p-4">
                  <h3 className="font-medium group-hover:text-primary transition-colors">
                    {t('title')} #{i}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t('card.rentFrom')} 500 THB{t('card.perDay')}
                  </p>
                  <span className="text-xs text-primary font-medium mt-2 inline-block">
                    {t('card.viewDetails')}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
