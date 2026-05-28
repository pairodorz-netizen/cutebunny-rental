import type { MetadataRoute } from 'next';

const BASE_URL = 'https://www.cutebunnyrental.com';
const LOCALES = ['th', 'en', 'zh'] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages = ['', '/products', '/privacy-policy', '/terms-of-service'];

  return staticPages.flatMap((path) =>
    LOCALES.map((locale) => ({
      url: `${BASE_URL}/${locale}${path}`,
      lastModified: new Date('2026-05-28'),
      changeFrequency: path === '' || path === '/products' ? 'daily' as const : 'monthly' as const,
      priority: path === '' ? 1.0 : path === '/products' ? 0.9 : 0.5,
    })),
  );
}
