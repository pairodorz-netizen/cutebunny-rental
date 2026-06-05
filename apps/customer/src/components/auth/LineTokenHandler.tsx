'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { setStoredToken } from '@/lib/auth/token';

/**
 * Global handler for the `line_token` query parameter.
 *
 * After LINE OAuth the API redirects to the returnPath (e.g. a product page)
 * with `?line_token=<jwt>`. This component runs in the root layout so the
 * token is persisted to localStorage regardless of which page receives the
 * redirect.
 */
export function LineTokenHandler() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const lineToken = searchParams.get('line_token');
    if (lineToken) {
      setStoredToken(lineToken);
      const url = new URL(window.location.href);
      url.searchParams.delete('line_token');
      window.history.replaceState({}, '', url.toString());
    }
  }, [searchParams]);

  return null;
}
