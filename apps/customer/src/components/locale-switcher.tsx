'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter, usePathname } from '@/i18n/routing';
import { Globe } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

const localeLabels: Record<string, string> = {
  en: 'EN',
  th: 'TH',
  zh: 'ZH',
};

const localeNameKeys: Record<string, 'english' | 'thai' | 'chinese'> = {
  en: 'english',
  th: 'thai',
  zh: 'chinese',
};

export function LocaleSwitcher() {
  const t = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function switchLocale(newLocale: string) {
    router.replace(pathname, { locale: newLocale as 'en' | 'th' | 'zh' });
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 p-2 rounded-full hover:bg-cb-surface transition-colors text-cb-heading"
        aria-label={t('language')}
      >
        <Globe className="h-5 w-5" />
        <span className="text-xs font-medium">{localeLabels[locale]}</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-36 rounded-xl border bg-white p-1 shadow-md z-50" style={{ borderColor: '#EFEAF6' }}>
          {(['th', 'en', 'zh'] as const).map((loc) => (
            <button
              key={loc}
              onClick={() => switchLocale(loc)}
              className={`w-full text-left rounded-lg px-3 py-2 text-sm transition-colors ${
                locale === loc
                  ? 'bg-cb-active text-cb-active-fg font-medium'
                  : 'text-cb-heading hover:bg-cb-surface'
              }`}
            >
              {localeLabels[loc]} — {t(localeNameKeys[loc])}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
