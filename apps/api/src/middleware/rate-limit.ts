import { createMiddleware } from 'hono/factory';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean expired entries lazily (setInterval is disallowed in Workers global scope)
function cleanExpiredEntries() {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
}

export function rateLimit(maxAttempts: number, windowMinutes: number) {
  return createMiddleware(async (c, next) => {
    // Lazy cleanup on each request
    cleanExpiredEntries();
    const ip = c.req.header('x-forwarded-for') ?? c.req.header('cf-connecting-ip') ?? 'unknown';
    const key = `${ip}:${c.req.path}`;
    const now = Date.now();
    const windowMs = windowMinutes * 60 * 1000;

    let entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    if (entry.count > maxAttempts) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      return c.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: `Too many attempts. Try again in ${retryAfter} seconds.`,
          },
        },
        429
      );
    }

    await next();
  });
}
