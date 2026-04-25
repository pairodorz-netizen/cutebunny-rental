/**
 * BUG-API-WORKER-CRASH-01 — Worker boot + /health smoke gates.
 *
 * Owner reported a Cloudflare 1101 'Worker threw exception' on EVERY
 * route, including /health (Ray ID 9f1bdebcd9cd80cf, 2026-04-25
 * 08:10:13Z). By the time we investigated, the Worker was 200 OK
 * again — likely a transient cold-start exception or a botched deploy
 * isolate. Either way we never had a CI gate that imports the Worker
 * entrypoint, so a future module-load throw or top-level error would
 * still ship green and only surface in production.
 *
 * Gates:
 *   #1 The Hono app default-export imports without throwing. Catches
 *      any top-level throw (`throw new Error(...)`, undefined import,
 *      circular ref, etc.) at the module-load layer.
 *   #2 GET /health returns 200 with `{status, timestamp, database}`.
 *      The route catches DB failures internally, so even with no DB
 *      binding the response shape must be `200` — never a 5xx, never
 *      a thrown exception.
 *   #3 GET / returns 200 with the version manifest.
 *   #4 An unauth admin route returns 401 (NOT 5xx). Distinguishes
 *      "auth refused" (worker alive) from "worker threw" (1101).
 *
 * If any of these fail, the deploy must be blocked — no point shipping
 * a Worker that can't boot.
 */
import { describe, it, expect, beforeAll } from 'vitest';

// Lazy import so a top-level throw fails the FIRST gate explicitly,
// not the whole describe block.
type AppModule = typeof import('../index');
let appModule: AppModule;
let importError: unknown;

beforeAll(async () => {
  try {
    appModule = await import('../index');
  } catch (err) {
    importError = err;
  }
});

const TEST_ENV = {
  DATABASE_URL:
    'postgresql://test:test@localhost:5432/test?sslmode=disable',
  JWT_SECRET: 'test-secret',
  ENVIRONMENT: 'test',
};

describe('BUG-API-WORKER-CRASH-01 · Worker entrypoint boot', () => {
  it('the Hono app default-export imports without throwing', () => {
    expect(importError).toBeUndefined();
    expect(appModule).toBeDefined();
    expect(appModule.default).toBeDefined();
    // Hono apps expose `.fetch` as the Worker handler.
    expect(typeof (appModule.default as { fetch?: unknown }).fetch).toBe(
      'function',
    );
  });
});

describe('BUG-API-WORKER-CRASH-01 · /health route smoke', () => {
  it('GET /health returns 200 with the health envelope', async () => {
    expect(importError).toBeUndefined();
    const app = appModule.default as {
      fetch: (req: Request, env: typeof TEST_ENV) => Promise<Response>;
    };
    const res = await app.fetch(
      new Request('https://test.workers.dev/health'),
      TEST_ENV,
    );
    // /health MUST never 5xx; DB failures surface as
    // `{status:'degraded', database:'error'}` with HTTP 200.
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      timestamp: string;
      database: string;
    };
    expect(typeof body.status).toBe('string');
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.database).toBe('string');
  });

  it('GET / returns 200 with the version manifest', async () => {
    expect(importError).toBeUndefined();
    const app = appModule.default as {
      fetch: (req: Request, env: typeof TEST_ENV) => Promise<Response>;
    };
    const res = await app.fetch(
      new Request('https://test.workers.dev/'),
      TEST_ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      name: string;
      version: string;
      status: string;
    };
    expect(body.status).toBe('ok');
    expect(typeof body.name).toBe('string');
    expect(typeof body.version).toBe('string');
  });

  it('unauthenticated admin route returns 401 (worker alive, not 1101)', async () => {
    expect(importError).toBeUndefined();
    const app = appModule.default as {
      fetch: (req: Request, env: typeof TEST_ENV) => Promise<Response>;
    };
    const res = await app.fetch(
      new Request('https://test.workers.dev/api/v1/admin/orders/counts'),
      TEST_ENV,
    );
    // 401 = auth middleware rejected (worker is alive).
    // 5xx or thrown = the bug we are guarding against.
    expect(res.status).toBe(401);
  });
});
