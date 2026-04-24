import { createMiddleware } from 'hono/factory';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * Shape of the Cloudflare KV namespace we consume. Defined locally to
 * avoid pulling the full @cloudflare/workers-types surface — only the
 * three methods we actually use.
 */
interface RateLimitKV {
  get: (key: string) => Promise<string | null>;
  put: (
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ) => Promise<void>;
  delete: (key: string) => Promise<void>;
}

/**
 * In-memory fallback store. Survives within a single Worker isolate
 * lifetime only — wiped on every redeploy. Used when no KV namespace
 * is bound (local dev, tests without a fake KV).
 */
const memoryStore = new Map<string, RateLimitEntry>();

function cleanExpiredMemoryEntries(now: number): void {
  for (const [key, entry] of memoryStore) {
    if (entry.resetAt <= now) {
      memoryStore.delete(key);
    }
  }
}

function buildKey(ip: string, path: string): string {
  return `rl:${ip}:${path}`;
}

async function readEntry(
  kv: RateLimitKV | undefined,
  key: string,
): Promise<RateLimitEntry | null> {
  if (kv) {
    const raw = await kv.get(key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as RateLimitEntry;
      if (
        typeof parsed.count === 'number' &&
        typeof parsed.resetAt === 'number'
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }
  return memoryStore.get(key) ?? null;
}

async function writeEntry(
  kv: RateLimitKV | undefined,
  key: string,
  entry: RateLimitEntry,
  windowSeconds: number,
): Promise<void> {
  if (kv) {
    await kv.put(key, JSON.stringify(entry), {
      expirationTtl: windowSeconds,
    });
    return;
  }
  memoryStore.set(key, entry);
}

export function rateLimit(maxAttempts: number, windowMinutes: number) {
  return createMiddleware(async (c, next) => {
    const kv = (c.env as { RATE_LIMIT_KV?: RateLimitKV } | undefined)
      ?.RATE_LIMIT_KV;

    const now = Date.now();
    const windowMs = windowMinutes * 60 * 1000;
    const windowSeconds = windowMinutes * 60;

    if (!kv) {
      // In-memory path — still useful for local dev and tests that
      // don't wire up a fake KV. Lazy-cleanup on every request.
      cleanExpiredMemoryEntries(now);
    }

    const ip =
      c.req.header('x-forwarded-for') ??
      c.req.header('cf-connecting-ip') ??
      'unknown';
    const key = buildKey(ip, c.req.path);

    let entry = await readEntry(kv, key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
    }

    entry.count++;

    if (entry.count > maxAttempts) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      // Persist the incremented counter so subsequent isolates see the
      // breach too — otherwise an isolate restart mid-window would
      // hand the attacker a fresh budget.
      await writeEntry(kv, key, entry, windowSeconds);
      c.header('Retry-After', String(retryAfter));
      return c.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: `Too many attempts. Try again in ${retryAfter} seconds.`,
          },
        },
        429,
      );
    }

    await writeEntry(kv, key, entry, windowSeconds);
    await next();
  });
}

/**
 * Operator escape hatch. Deletes a single rate-limit entry so a locked-
 * out user can retry immediately. Works against whichever store the
 * middleware is currently using (KV when bound, in-memory otherwise).
 *
 * Key format matches what `rateLimit` writes: `rl:<ip>:<path>`.
 */
export async function clearRateLimit(
  ip: string,
  path: string,
  kv?: RateLimitKV,
): Promise<void> {
  const key = buildKey(ip, path);
  if (kv) {
    await kv.delete(key);
    return;
  }
  memoryStore.delete(key);
}
