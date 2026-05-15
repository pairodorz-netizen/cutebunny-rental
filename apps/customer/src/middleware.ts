import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { routing } from './i18n/routing';

const intlMiddleware = createMiddleware(routing);

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
