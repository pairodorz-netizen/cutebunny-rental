/**
 * BUG401-A02 — acceptance tests for the framework-free telemetry store
 * that sits behind the runtime DIAG_BAR flag.
 *
 * Covers spec gates:
 *   - #10 DIAG_BAR=off fully absent (no buffer ever constructed, no
 *     storage writes, getReport() returns an empty-buffer report)
 *   - #2 exactly ONE record per Create Product attempt, created at
 *     submit-handler entry before serialization/upload/fetch
 *   - #5 no synthetic timeout/abort introduced by the wrapper
 *   - #6 redaction (Authorization/body/filename/full-URL) preserved
 *     through the store pipeline
 *   - #9 getReport() serialises the last 10 redacted records as JSON
 *   - wrapper invariants (observe-and-rethrow): via finalize{Resolved,
 *     Rejected}, mirrored by the admin fetchWithDiagnostics call-site.
 */
import { describe, it, expect } from 'vitest';
import {
  createTelemetryStore,
  type EnvironmentProbe,
  type StartSubmitInput,
  type StorageAdapter,
} from '@cutebunny/shared/diagnostics';

function fixedEnv(overrides: Partial<EnvironmentProbe> = {}): EnvironmentProbe {
  let t = 1_700_000_000_000;
  return {
    now: () => t++,
    navigatorOnline: () => true,
    connectionEffectiveType: () => '4g',
    connectionRtt: () => 50,
    connectionDownlink: () => 10,
    ...overrides,
  };
}

function memStorage(): StorageAdapter & { dump(): Record<string, string> } {
  const m = new Map<string, string>();
  return {
    get: (k: string) => m.get(k) ?? null,
    set: (k: string, v: string) => void m.set(k, v),
    remove: (k: string) => void m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

function baseInput(): StartSubmitInput {
  return {
    frontendDeploymentId: 'dep_abc',
    apiBaseUrl: 'https://api.example.com',
    requestUrl: 'https://api.example.com/v1/admin/products',
    contentType: 'application/json',
    hasAuthorizationHeader: true,
    authTokenPresent: true,
    authTokenExpiresAt: null,
  };
}

describe('createTelemetryStore — flag-off fully absent (spec §10)', () => {
  it('when getFlag() is false, startCreateProductSubmit returns an inactive handle', () => {
    const store = createTelemetryStore({
      getFlag: () => false,
      env: fixedEnv(),
    });
    const h = store.startCreateProductSubmit(baseInput());
    expect(h.active).toBe(false);
  });

  it('when flag is off, no record is ever pushed to the buffer', () => {
    const store = createTelemetryStore({
      getFlag: () => false,
      env: fixedEnv(),
    });
    const h = store.startCreateProductSubmit(baseInput());
    h.markSerializationStart();
    h.markFetchStart();
    h.finalizeResolved({ status: 200, ok: true, type: 'cors', headers: null });
    expect(store.__snapshotForTest()).toEqual([]);
  });

  it('when flag is off, no storage writes occur — even on repeated submits', () => {
    const storage = memStorage();
    const store = createTelemetryStore({
      getFlag: () => false,
      env: fixedEnv(),
      storage,
      storageKey: 'bug401-diag',
    });
    for (let i = 0; i < 3; i++) {
      const h = store.startCreateProductSubmit(baseInput());
      h.finalizeRejected({ errorName: 'TypeError', errorMessage: 'Failed to fetch' });
    }
    expect(storage.dump()).toEqual({});
  });

  it('when flag is off, getReport() returns the empty-buffer report (no leak)', () => {
    const store = createTelemetryStore({
      getFlag: () => false,
      env: fixedEnv(),
    });
    const h = store.startCreateProductSubmit(baseInput());
    h.finalizeResolved({ status: 500, ok: false, type: 'cors', headers: null });
    const report = store.getReport();
    const parsed = JSON.parse(report);
    expect(parsed).toEqual({ records: [] });
  });
});

describe('createTelemetryStore — flag-on lifecycle (spec §2, §9)', () => {
  it('exactly ONE record is created at startCreateProductSubmit entry', () => {
    const store = createTelemetryStore({
      getFlag: () => true,
      env: fixedEnv(),
    });
    store.startCreateProductSubmit(baseInput());
    expect(store.__snapshotForTest()).toHaveLength(1);
    const [rec] = store.__snapshotForTest();
    // Phase 2+ fields are still null at entry — this proves "created
    // before any serialization/upload/fetch begins".
    expect(rec.serializationStartedAt).toBeNull();
    expect(rec.serializationEndedAt).toBeNull();
    expect(rec.fetchStartedAt).toBeNull();
    expect(rec.fetchEndedAt).toBeNull();
    expect(rec.fetchOutcome).toBeNull();
  });

  it('handle mutations replace the record in place (no duplicates)', () => {
    const store = createTelemetryStore({
      getFlag: () => true,
      env: fixedEnv(),
    });
    const h = store.startCreateProductSubmit(baseInput());
    h.markSerializationStart();
    h.markSerializationEnd();
    h.markFetchStart();
    h.finalizeResolved({
      status: 201,
      ok: true,
      type: 'cors',
      headers: {
        get(name) {
          if (name === 'cf-ray') return 'abc-HKG';
          return null;
        },
      },
    });
    const snap = store.__snapshotForTest();
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({
      fetchOutcome: 'resolved_response',
      httpStatus: 201,
      responseOk: true,
      workerSeen: true,
    });
  });

  it('ring buffer caps at max=10 across many submits', () => {
    const store = createTelemetryStore({
      getFlag: () => true,
      env: fixedEnv(),
      max: 10,
    });
    for (let i = 0; i < 25; i++) {
      store.startCreateProductSubmit(baseInput());
    }
    expect(store.__snapshotForTest()).toHaveLength(10);
  });

  it('getReport() serialises the last N redacted records as JSON', () => {
    const store = createTelemetryStore({
      getFlag: () => true,
      env: fixedEnv(),
    });
    const h = store.startCreateProductSubmit(baseInput());
    h.finalizeRejected({
      errorName: 'TypeError',
      errorMessage: 'NetworkError when attempting to fetch https://api.example.com/v1/admin/products with Bearer eyJabcdefghijk',
    });
    const report = store.getReport();
    const parsed = JSON.parse(report);
    expect(parsed.records).toHaveLength(1);
    // Redaction pipeline must have run BEFORE the record was stored.
    expect(parsed.records[0].errorMessage).not.toContain('https://');
    expect(parsed.records[0].errorMessage).not.toContain('Bearer eyJ');
    expect(parsed.records[0].errorMessage).not.toContain('eyJabcdefghijk');
  });
});

describe('createTelemetryStore — 401-preserved (spec §4)', () => {
  it('HTTP 401 → fetchOutcome=resolved_response, status=401, responseOk=false', () => {
    const store = createTelemetryStore({
      getFlag: () => true,
      env: fixedEnv(),
    });
    const h = store.startCreateProductSubmit(baseInput());
    h.markFetchStart();
    h.finalizeResolved({
      status: 401,
      ok: false,
      type: 'cors',
      headers: null,
    });
    const [rec] = store.__snapshotForTest();
    expect(rec.fetchOutcome).toBe('resolved_response');
    expect(rec.httpStatus).toBe(401);
    expect(rec.responseOk).toBe(false);
  });
});

describe('createTelemetryStore — H3-b signature (spec §7)', () => {
  it('submit entered + serialization started BUT fetch never fires → fetchStartedAt=null', () => {
    const store = createTelemetryStore({
      getFlag: () => true,
      env: fixedEnv(),
    });
    const h = store.startCreateProductSubmit(baseInput());
    h.markSerializationStart();
    // Simulate serialization throwing: no markFetchStart, no finalize.
    const [rec] = store.__snapshotForTest();
    expect(rec.submitHandlerEnteredAt).toBeGreaterThan(0);
    expect(rec.serializationStartedAt).toBeGreaterThan(0);
    expect(rec.fetchStartedAt).toBeNull();
    expect(rec.fetchEndedAt).toBeNull();
    expect(rec.fetchOutcome).toBeNull();
  });
});

describe('createTelemetryStore — offline (spec §8)', () => {
  it('navigator.onLine=false → record has navigatorOnline=false, outcome rejected_error, responseType=null', () => {
    const store = createTelemetryStore({
      getFlag: () => true,
      env: fixedEnv({ navigatorOnline: () => false }),
    });
    const h = store.startCreateProductSubmit(baseInput());
    h.markFetchStart();
    h.finalizeRejected({ errorName: 'TypeError', errorMessage: 'Failed to fetch' });
    const [rec] = store.__snapshotForTest();
    expect(rec.navigatorOnline).toBe(false);
    expect(rec.fetchOutcome).toBe('rejected_error');
    expect(rec.responseType).toBeNull();
  });
});

describe('createTelemetryStore — no synthetic timeout/abort (spec §5)', () => {
  it('default outcome on finalizeRejected is rejected_error (never timeout/aborted)', () => {
    const store = createTelemetryStore({
      getFlag: () => true,
      env: fixedEnv(),
    });
    const h = store.startCreateProductSubmit(baseInput());
    h.markFetchStart();
    h.finalizeRejected({ errorName: 'TypeError', errorMessage: 'Failed to fetch' });
    const [rec] = store.__snapshotForTest();
    expect(rec.fetchOutcome).toBe('rejected_error');
    expect(rec.fetchOutcome).not.toBe('timeout');
    expect(rec.fetchOutcome).not.toBe('aborted');
  });

  it('store source contains no setTimeout / clearTimeout / AbortController references', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const src = await fs.readFile(
      path.resolve(__dirname, '../../../../packages/shared/src/diagnostics/telemetry-store.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/\bsetTimeout\b/);
    expect(src).not.toMatch(/\bclearTimeout\b/);
    expect(src).not.toMatch(/\bAbortController\b/);
    expect(src).not.toMatch(/\bAbortSignal\b/);
  });
});

describe('createTelemetryStore — storage mirror + clear()', () => {
  it('flag-on writes a redacted mirror to storage on every mutation', () => {
    const storage = memStorage();
    const store = createTelemetryStore({
      getFlag: () => true,
      env: fixedEnv(),
      storage,
      storageKey: 'bug401-diag',
    });
    const h = store.startCreateProductSubmit(baseInput());
    h.finalizeRejected({ errorName: 'TypeError', errorMessage: 'Failed to fetch' });
    expect(storage.dump()['bug401-diag']).toBeDefined();
    const mirrored = JSON.parse(storage.dump()['bug401-diag']);
    expect(Array.isArray(mirrored)).toBe(true);
    expect(mirrored).toHaveLength(1);
    // Redaction still holds in the mirror: the boolean presence flag
    // `hasAuthorizationHeader` is fine to record, but the actual token
    // value, raw bearer strings, and request/response bodies must never
    // appear in the serialised record.
    const rec = mirrored[0];
    const serialised = JSON.stringify(rec);
    expect(serialised).not.toMatch(/Bearer\s+[A-Za-z0-9]/);
    expect(serialised).not.toMatch(/eyJ[A-Za-z0-9_-]+/);
    expect(Object.keys(rec)).not.toContain('requestBody');
    expect(Object.keys(rec)).not.toContain('responseBody');
  });

  it('clear() wipes both in-memory records and the storage mirror', () => {
    const storage = memStorage();
    const store = createTelemetryStore({
      getFlag: () => true,
      env: fixedEnv(),
      storage,
      storageKey: 'bug401-diag',
    });
    store.startCreateProductSubmit(baseInput());
    expect(store.__snapshotForTest()).toHaveLength(1);
    store.clear();
    expect(store.__snapshotForTest()).toEqual([]);
    expect(storage.dump()['bug401-diag']).toBeUndefined();
  });
});
