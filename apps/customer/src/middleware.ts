import createMiddleware from 'next-intl/middleware';
import { NextRequest } from 'next/server';
import { routing } from './i18n/routing';

const intlMiddleware = createMiddleware(routing);

export default function middleware(request: NextRequest) {
  return intlMiddleware(request);
}

export const config = {
  // Match all paths except Next.js internals and static files
  matcher: ['/', '/(en|th|zh)/:path*', '/((?!_next|api|.*\\..*).*)'],
};
