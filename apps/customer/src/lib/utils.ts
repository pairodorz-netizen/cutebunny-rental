import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a YYYY-MM-DD date string for display, without leading zeros.
 * th: D/M/YYYY  (26/5/2026)
 * en: M/D/YYYY  (5/26/2026)
 * zh: YYYY/M/D  (2026/5/26)
 */
export function formatDateShort(dateStr: string, locale: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (locale === 'zh') return `${y}/${m}/${d}`;
  if (locale === 'en') return `${m}/${d}/${y}`;
  return `${d}/${m}/${y}`;
}
