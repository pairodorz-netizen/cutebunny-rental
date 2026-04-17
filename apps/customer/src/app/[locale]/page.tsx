import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  const t = useTranslations();

  return (
    <div>
      <section className="relative py-24 md:py-32 bg-gradient-to-b from-primary/5 to-background">
        <div className="container text-center">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
            {t('home.hero.title')}
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            {t('home.hero.subtitle')}
          </p>
          <Button asChild size="lg">
            <Link href="/products">{t('home.hero.cta')}</Link>
          </Button>
        </div>
      </section>

      <section className="py-16">
        <div className="container">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-3xl font-bold">{t('home.featured.title')}</h2>
            <Link href="/products" className="text-primary hover:underline text-sm font-medium">
              {t('home.featured.viewAll')}
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-lg border bg-card p-4 h-64 flex items-center justify-center text-muted-foreground"
              >
                {t('home.featured.title')} #{i}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 bg-secondary/30">
        <div className="container">
          <h2 className="text-3xl font-bold text-center mb-8">{t('home.categories.title')}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {['wedding', 'evening', 'cocktail', 'casual'].map((cat) => (
              <div
                key={cat}
                className="rounded-lg border bg-card p-6 text-center hover:shadow-md transition-shadow cursor-pointer"
              >
                <span className="text-sm font-medium capitalize">{cat}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
