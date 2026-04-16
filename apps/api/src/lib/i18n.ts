type SupportedLocale = 'en' | 'th' | 'zh';

const SUPPORTED_LOCALES: SupportedLocale[] = ['en', 'th', 'zh'];

export function parseLocale(locale?: string | null): SupportedLocale {
  if (locale && SUPPORTED_LOCALES.includes(locale as SupportedLocale)) {
    return locale as SupportedLocale;
  }
  return 'en';
}

export function localizeField(i18nJson: Record<string, string> | null | undefined, fallback: string, locale: SupportedLocale): string {
  if (!i18nJson || typeof i18nJson !== 'object') return fallback;
  return i18nJson[locale] ?? i18nJson['en'] ?? fallback;
}
