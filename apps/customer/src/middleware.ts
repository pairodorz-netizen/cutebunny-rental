import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { routing } from './i18n/routing';

const intlMiddleware = createMiddleware(routing);

const BILINGUAL_PATHS = ['/privacy-policy', '/terms-of-service'];

function isBilingualPath(pathname: string): boolean {
  return BILINGUAL_PATHS.some((p) => pathname.endsWith(p));
}

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Legal pages must remain bilingual for LINE Developers Console —
  // bypass Thai-only redirect, let next-intl handle locale routing normally
  if (isBilingualPath(pathname)) {
    return intlMiddleware(request);
  }

  // Redirect /en/* and /zh/* to /th/* with 301 (Thai-only mode, BUG-544)
  const nonThaiMatch = pathname.match(/^\/(en|zh)(\/.*)?$/);
  if (nonThaiMatch) {
    const rest = nonThaiMatch[2] || '';
    const url = request.nextUrl.clone();
    url.pathname = `/th${rest}`;
    return NextResponse.redirect(url, 301);
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: ['/', '/(en|th|zh)/:path*'],
};
