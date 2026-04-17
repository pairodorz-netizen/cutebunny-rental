import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

const localeLabels: Record<string, string> = {
  en: 'EN',
  th: 'TH',
  zh: 'ZH',
};

export function LocaleSwitcher() {
  const { t, i18n } = useTranslation();
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

  function switchLocale(locale: string) {
    i18n.changeLanguage(locale);
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
        aria-label={t('common.language')}
      >
        <Globe className="h-4 w-4" />
        <span>{localeLabels[i18n.language]}</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-36 rounded-md border bg-popover p-1 shadow-md z-50">
          {(['en', 'th', 'zh'] as const).map((loc) => (
            <button
              key={loc}
              onClick={() => switchLocale(loc)}
              className={`w-full text-left rounded-sm px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors ${
                i18n.language === loc ? 'bg-accent font-medium' : ''
              }`}
            >
              {localeLabels[loc]} —{' '}
              {t(`common.${loc === 'en' ? 'english' : loc === 'th' ? 'thai' : 'chinese'}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
