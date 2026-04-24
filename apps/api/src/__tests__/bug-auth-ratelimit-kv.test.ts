import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';

/**
 * BUG-AUTH follow-up — rate-limiter must persist state across Worker
 * isolate restarts (i.e. across Map-losing events) when a KV namespace
 * is bound on `c.env.RATE_LIMIT_KV`.
 *
 * The in-memory Map path is still exercised by q02-security.test.ts.
 * This spec focuses on the KV-backed path: a fake KVNamespace whose
 * state survives recreating the Hono app instance simulates an isolate
 * restart. If the middleware ignores KV, counters reset to zero and
 * the last request (which should be 429) will still see 200/401.
 */

interface KvEntry {
  value: string;
  expiresAt: number | null;
}

interface FakeKV {
  get: (key: string) => Promise<string | null>;
  put: (
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ) => Promise<void>;
  delete: (key: string) => Promise<void>;
  __dump: () => Record<string, KvEntry>;
}

function createFakeKV(now: () => number = () => Date.now()): FakeKV {
  const store = new Map<string, KvEntry>();
  return {
    async get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt !== null && entry.expiresAt <= now()) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    async put(key, value, options) {
      const expiresAt =
        options?.expirationTtl !== undefined
          ? now() + options.expirationTtl * 1000
          : null;
      store.set(key, { value, expiresAt });
    },
    async delete(key) {
      store.delete(key);
    },
    __dump() {
      return Object.fromEntries(store);
    },
  };
}

async function buildApp(
  kv: FakeKV | undefined,
  maxAttempts = 3,
  windowMinutes = 15,
) {
  // Re-import the middleware inside each "isolate" so the module-level
  // in-memory Map is fresh. This is the core of the simulation: a real
  // Worker isolate restart wipes all module-scoped state.
  vi.resetModules();
  const mod = await import('../middleware/rate-limit');
  const mw: MiddlewareHandler = mod.rateLimit(maxAttempts, windowMinutes);

  const app = new Hono<{ Bindings: { RATE_LIMIT_KV?: FakeKV } }>();
  app.post('/login', mw, (c) => c.json({ ok: true }));
  return { app, env: kv ? { RATE_LIMIT_KV: kv } : {} };
}

type BuiltApp = Awaited<ReturnType<typeof buildApp>>;

async function hitLogin(built: BuiltApp, ip: string) {
  return built.app.request(
    '/login',
    {
      method: 'POST',
      headers: {
        'x-forwarded-for': ip,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    },
    built.env,
  );
}

describe('BUG-AUTH — rate-limiter KV persistence', () => {
  beforeEach(() => {
    // No shared setup — each test builds its own Hono app + KV.
  });

  it('counter survives recreating the Hono app (simulated isolate restart)', async () => {
    const kv = createFakeKV();
    const IP = '203.0.113.77';

    // First isolate: burn 3 of 3 attempts.
    let built = await buildApp(kv, 3, 15);
    for (let i = 0; i < 3; i++) {
      const res = await hitLogin(built, IP);
      expect(res.status).toBe(200);
    }

    // Simulate isolate restart: re-import middleware (fresh Map),
    // reuse the same KV namespace.
    built = await buildApp(kv, 3, 15);

    // 4th attempt against the restarted app must still be 429 because
    // the KV counter persisted.
    const res = await hitLogin(built, IP);
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });

  it('writes entries with expirationTtl matching the rate-limit window', async () => {
    const kv = createFakeKV();
    const built = await buildApp(kv, 3, 15);
    await hitLogin(built, '203.0.113.78');

    const dump = kv.__dump();
    const entries = Object.entries(dump);
    expect(entries.length).toBe(1);

    const [, entry] = entries[0];
    expect(entry.expiresAt).not.toBeNull();

    // Window is 15 min = 900 s → expiresAt should be ~now + 900s.
    // Allow ±2s jitter.
    const expectedMin = Date.now() + 15 * 60 * 1000 - 2000;
    const expectedMax = Date.now() + 15 * 60 * 1000 + 2000;
    expect(entry.expiresAt!).toBeGreaterThanOrEqual(expectedMin);
    expect(entry.expiresAt!).toBeLessThanOrEqual(expectedMax);
  });

  it('keys are scoped by IP + path so two IPs do not share a counter', async () => {
    const kv = createFakeKV();
    const built = await buildApp(kv, 3, 15);
    for (let i = 0; i < 3; i++) {
      expect((await hitLogin(built, '10.0.0.1')).status).toBe(200);
    }
    // Different IP should still have a fresh budget.
    expect((await hitLogin(built, '10.0.0.2')).status).toBe(200);
  });

  it('falls back to in-memory Map when RATE_LIMIT_KV is not bound', async () => {
    // No KV passed → middleware uses the module-level Map (existing behaviour).
    const built = await buildApp(undefined, 3, 15);
    const IP = '198.51.100.1';
    for (let i = 0; i < 3; i++) {
      expect((await hitLogin(built, IP)).status).toBe(200);
    }
    // 4th attempt still gets rate-limited via Map.
    const res = await hitLogin(built, IP);
    expect(res.status).toBe(429);
  });
});
