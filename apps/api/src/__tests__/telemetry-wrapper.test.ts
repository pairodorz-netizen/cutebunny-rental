/**
 * BUG401-A02 — wrapper invariants.
 *
 * The admin `fetchWithDiagnostics` is an observe-and-rethrow wrapper
 * around the browser's fetch. This file pins the contract that the
 * wrapper MUST hold, independently of any browser-specific wiring, by
 * re-implementing its body against an injected fetch + an injected
 * telemetry handle and asserting behaviour on both the resolve and
 * reject paths.
 *
 * Gates covered:
 *   #3 Rejection preserved — a TypeError from fetch stays rejected.
 *   #4 HTTP 401 preserved — the Response is returned, not thrown.
 *   #5 No synthetic timeout/abort — the wrapper never introduces one.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createTelemetryStore,
  type EnvironmentProbe,
} from '@cutebunny/shared/diagnostics';

interface Handle {
  markFetchStart(now?: number): void;
  finalizeResolved(input: {
    status: number;
    ok: boolean;
    type: 'basic' | 'cors' | 'opaque' | 'error';
    headers: { get(name: string): string | null } | null;
    now?: number;
  }): void;
  finalizeRejected(input: { errorName: string; errorMessage: string | null; now?: number }): void;
}

/**
 * Faithful clone of apps/admin/src/lib/api.ts::fetchWithDiagnostics.
 * If this helper and the admin call-site diverge, this test drifts — do
 * not "fix" one in isolation.
 */
async function fetchWithDiagnostics(
  fetchFn: (url: string, init: RequestInit) => Promise<Response>,
  url: string,
  init: RequestInit,
  diagHandle?: Handle,
): Promise<Response> {
  const startedAt = Date.now();
  diagHandle?.markFetchStart(startedAt);
  try {
    const res = await fetchFn(url, init);
    diagHandle?.finalizeResolved({
      status: res.status,
      ok: res.ok,
      type: res.type as 'basic' | 'cors' | 'opaque' | 'error',
      headers: res.headers,
    });
    return res;
  } catch (err) {
    const errName = err instanceof Error ? err.name : 'Error';
    const errMsg = err instanceof Error ? err.message : typeof err === 'string' ? err : null;
    diagHandle?.finalizeRejected({
      errorName: errName,
      errorMessage: errMsg,
    });
    throw err;
  }
}

function env(): EnvironmentProbe {
  let t = 1_700_000_000_000;
  return {
    now: () => t++,
    navigatorOnline: () => true,
    connectionEffectiveType: () => '4g',
    connectionRtt: () => 50,
    connectionDownlink: () => 10,
  };
}

function newHandle() {
  const store = createTelemetryStore({ getFlag: () => true, env: env() });
  const h = store.startCreateProductSubmit({
    frontendDeploymentId: 'dep_abc',
    apiBaseUrl: 'https://api.example.com',
    requestUrl: 'https://api.example.com/v1/admin/products',
    contentType: 'application/json',
    hasAuthorizationHeader: true,
    authTokenPresent: true,
    authTokenExpiresAt: null,
  });
  return { store, h };
}

describe('fetchWithDiagnostics — rejection preserved (spec §3)', () => {
  it('a TypeError from fetch is re-thrown unchanged', async () => {
    const err = new TypeError('Failed to fetch');
    const fetchFn = vi.fn(async () => {
      throw err;
    });
    const { store, h } = newHandle();
    await expect(
      fetchWithDiagnostics(fetchFn, 'https://api.example.com/v1/admin/products', { method: 'POST' }, h),
    ).rejects.toBe(err);

    const [rec] = store.__snapshotForTest();
    expect(rec.fetchOutcome).toBe('rejected_error');
    expect(rec.errorName).toBe('TypeError');
    // redactErrorMessage is a no-op for a plain "Failed to fetch" string
    expect(rec.errorMessage).toBe('Failed to fetch');
    expect(rec.httpStatus).toBeNull();
    expect(rec.responseOk).toBeNull();
    expect(rec.responseType).toBeNull();
  });

  it('a non-Error rejection (string) is still re-thrown as-is', async () => {
    const fetchFn = vi.fn(async () => {
      throw 'boom';
    });
    const { h } = newHandle();
    await expect(
      fetchWithDiagnostics(fetchFn, 'https://api.example.com/v1/admin/products', { method: 'POST' }, h),
    ).rejects.toBe('boom');
  });
});

describe('fetchWithDiagnostics — 401 preserved (spec §4)', () => {
  it('HTTP 401 is returned as a resolved Response with status=401', async () => {
    const res = new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
    const fetchFn = vi.fn(async () => res);
    const { store, h } = newHandle();
    const out = await fetchWithDiagnostics(
      fetchFn,
      'https://api.example.com/v1/admin/products',
      { method: 'POST' },
      h,
    );
    expect(out).toBe(res);
    expect(out.status).toBe(401);
    expect(out.ok).toBe(false);

    const [rec] = store.__snapshotForTest();
    expect(rec.fetchOutcome).toBe('resolved_response');
    expect(rec.httpStatus).toBe(401);
    expect(rec.responseOk).toBe(false);
    expect(rec.errorName).toBeNull();
    expect(rec.errorMessage).toBeNull();
  });

  it('HTTP 500 is still returned as a resolved Response (wrapper does not transform non-2xx)', async () => {
    const res = new Response('upstream failure', { status: 500 });
    const fetchFn = vi.fn(async () => res);
    const { store, h } = newHandle();
    const out = await fetchWithDiagnostics(
      fetchFn,
      'https://api.example.com/v1/admin/products',
      { method: 'POST' },
      h,
    );
    expect(out.status).toBe(500);
    const [rec] = store.__snapshotForTest();
    expect(rec.fetchOutcome).toBe('resolved_response');
    expect(rec.httpStatus).toBe(500);
  });
});

describe('fetchWithDiagnostics — no synthetic timeout/abort (spec §5)', () => {
  it('admin api.ts source contains no AbortController / setTimeout against fetch', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const src = await fs.readFile(
      path.resolve(__dirname, '../../../../apps/admin/src/lib/api.ts'),
      'utf8',
    );
    // The wrapper must not attach any signal or time-based cancellation.
    expect(src).not.toMatch(/\bAbortController\b/);
    expect(src).not.toMatch(/\bAbortSignal\b/);
    expect(src).not.toMatch(/\.signal\s*=\s*/);
    // Allow setTimeout elsewhere in admin code but not inside the wrapper
    // function body.
    const wrapperMatch = src.match(/async function fetchWithDiagnostics[\s\S]*?^}/m);
    expect(wrapperMatch).not.toBeNull();
    expect(wrapperMatch?.[0] ?? '').not.toMatch(/\bsetTimeout\b/);
    expect(wrapperMatch?.[0] ?? '').not.toMatch(/\bclearTimeout\b/);
  });

  it('omitting diagHandle does not change wrapper behaviour (handle is optional)', async () => {
    const res = new Response('ok', { status: 200 });
    const fetchFn = vi.fn(async () => res);
    const out = await fetchWithDiagnostics(
      fetchFn,
      'https://api.example.com/v1/admin/products',
      { method: 'POST' },
    );
    expect(out).toBe(res);
    expect(fetchFn).toHaveBeenCalledOnce();
  });
});
