import en from './locales/en.json';
import th from './locales/th.json';
import zh from './locales/zh.json';

export const locales = ['en', 'th', 'zh'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

export const messages = { en, th, zh } as const;

export { en, th, zh };
