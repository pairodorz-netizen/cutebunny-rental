import { describe, it, expect } from 'vitest';
import {
  buildSubmitEntryRecord,
  markSerializationStarted,
  markSerializationEnded,
  markFetchStarted,
  finalizeResolvedRecord,
  finalizeRejectedRecord,
  TelemetryRingBuffer,
  type TelemetryRecord,
  type StorageAdapter,
} from '@cutebunny/shared/diagnostics';

/**
 * A02 acceptance criteria exercised here:
 *   (2) every Create attempt emits exactly ONE record, created at submit entry
 *       before serialization / upload / fetch
 *   (4) HTTP 401 response → record has status=401, responseOk=false,
 *       fetchOutcome='resolved_response'
 *   (5) no synthetic timeout/abort is ever introduced — we never set
 *       'timeout' or 'aborted' unless the caller explicitly asks for it
 *   (7) H3-b signature: submitHandlerEnteredAt set, serializationStartedAt
 *       set, fetchStartedAt=null
 *   (8) offline: fetchOutcome='rejected_error', navigatorOnline=false,
 *       responseType=null
 */
function baseEntry(overrides: Partial<Parameters<typeof buildSubmitEntryRecord>[0]> = {}) {
  return buildSubmitEntryRecord({
    now: 1_700_000_000_000,
    frontendDeploymentId: 'deploy-test',
    apiBaseUrl: 'https://api.example.com',
    requestUrl: 'https://api.example.com/v1/admin/products?token=secret',
    contentType: 'application/json',
    hasAuthorizationHeader: true,
    authTokenPresent: true,
    authTokenExpiresAt: null,
    navigatorOnline: true,
    connectionEffectiveType: '4g',
    connectionRtt: 100,
    connectionDownlink: 10,
    ...overrides,
  });
}

describe('buildSubmitEntryRecord', () => {
  it('creates a well-formed record at submit-handler entry (H6 marker)', () => {
    const r = baseEntry();
    expect(r.operation).toBe('createProduct');
    expect(r.submitHandlerEnteredAt).toBe(1_700_000_000_000);
    expect(r.requestUrlOrigin).toBe('https://api.example.com');
    expect(r.requestPath).toBe('/v1/admin/products');
    // phase-2+ fields start null
    expect(r.serializationStartedAt).toBeNull();
    expect(r.fetchStartedAt).toBeNull();
    expect(r.fetchOutcome).toBeNull();
    expect(r.httpStatus).toBeNull();
  });

  it('records authTokenExpiryKnown correctly when expiry is known', () => {
    const r = baseEntry({ authTokenExpiresAt: new Date('2030-01-01T00:00:00Z') });
    expect(r.authTokenExpiryKnown).toBe(true);
    expect(r.authTokenExpiresAt).toBe('2030-01-01T00:00:00.000Z');
  });
});

describe('H3-b signature: serialization started but fetch never fired', () => {
  it('produces submitEntered + serializationStarted with fetchStartedAt=null', () => {
    let r = baseEntry();
    r = markSerializationStarted(r, 1_700_000_000_050);
    // serialization throws before endoing → no markFetchStarted
    expect(r.submitHandlerEnteredAt).toBe(1_700_000_000_000);
    expect(r.serializationStartedAt).toBe(1_700_000_000_050);
    expect(r.fetchStartedAt).toBeNull();
    expect(r.fetchOutcome).toBeNull();
  });
});

describe('finalizeResolvedRecord (H2′ / H3 / H3-b disambiguator)', () => {
  it('records status=401 and responseOk=false without mutating into an error outcome', () => {
    let r = baseEntry();
    r = markFetchStarted(r, 1_700_000_000_100);
    r = finalizeResolvedRecord(r, {
      now: 1_700_000_000_130,
      status: 401,
      ok: false,
      type: 'cors',
      headers: new Headers({ 'content-type': 'application/json', 'cf-ray': 'abc' }),
    });
    expect(r.fetchOutcome).toBe('resolved_response');
    expect(r.httpStatus).toBe(401);
    expect(r.responseOk).toBe(false);
    expect(r.responseType).toBe('cors');
    expect(r.durationMs).toBe(30);
    expect(r.responseHeadersSubset['cf-ray']).toBe('abc');
    expect(r.workerSeen).toBe(true);
  });

  it('marks workerSeen=false when cf-ray is absent on a 2xx response', () => {
    let r = baseEntry();
    r = markFetchStarted(r, 1_700_000_000_100);
    r = finalizeResolvedRecord(r, {
      now: 1_700_000_000_110,
      status: 200,
      ok: true,
      type: 'cors',
      headers: new Headers({ 'content-type': 'application/json' }),
    });
    expect(r.workerSeen).toBe(false);
  });
});

describe('finalizeRejectedRecord (H5-b / H5-d / H5-e / offline)', () => {
  it('defaults to rejected_error and never synthesises timeout/aborted', () => {
    let r = baseEntry();
    r = markFetchStarted(r, 1_700_000_000_100);
    r = finalizeRejectedRecord(r, {
      now: 1_700_000_000_120,
      errorName: 'TypeError',
      errorMessage: 'Failed to fetch',
    });
    expect(r.fetchOutcome).toBe('rejected_error');
    expect(r.httpStatus).toBeNull();
    expect(r.responseType).toBeNull();
    expect(r.errorName).toBe('TypeError');
    expect(r.errorMessage).toBe('Failed to fetch');
    expect(r.durationMs).toBe(20);
  });

  it('redacts a URL embedded in the error message', () => {
    let r = baseEntry();
    r = markFetchStarted(r, 1_700_000_000_100);
    r = finalizeRejectedRecord(r, {
      now: 1_700_000_000_150,
      errorName: 'TypeError',
      errorMessage:
        'NetworkError when attempting to fetch resource https://api.example.com/v1/admin/products?key=leak',
    });
    expect(r.errorMessage).toContain('[url]');
    expect(r.errorMessage).not.toContain('leak');
    expect(r.errorMessage).not.toMatch(/https?:\/\//);
  });

  it('reflects offline state when navigatorOnline was false at submit entry', () => {
    let r = baseEntry({ navigatorOnline: false });
    r = markFetchStarted(r, 1_700_000_000_100);
    r = finalizeRejectedRecord(r, {
      now: 1_700_000_000_102,
      errorName: 'TypeError',
      errorMessage: 'Failed to fetch',
    });
    expect(r.navigatorOnline).toBe(false);
    expect(r.fetchOutcome).toBe('rejected_error');
    expect(r.responseType).toBeNull();
  });
});

describe('no-synthetic-timeout guarantee', () => {
  it('has no API that sets outcome=timeout without the caller asking for it', () => {
    // This test pins the API surface. If a future edit adds a `setTimeout`
    // or AbortController path to shared telemetry, this test must fail.
    const src = `${buildSubmitEntryRecord}${markFetchStarted}${finalizeRejectedRecord}${finalizeResolvedRecord}`;
    expect(src).not.toMatch(/setTimeout\(/);
    expect(src).not.toMatch(/AbortController/);
    // outcome='timeout' only arrives through an explicit caller flag
    const r = baseEntry();
    const afterStart = markFetchStarted(r, 1_700_000_000_100);
    const finalised = finalizeRejectedRecord(afterStart, {
      now: 1_700_000_000_101,
      errorName: 'TypeError',
      errorMessage: 'x',
      // no outcome override
    });
    expect(finalised.fetchOutcome).toBe('rejected_error');
    const explicit = finalizeRejectedRecord(afterStart, {
      now: 1_700_000_000_101,
      errorName: 'AbortError',
      errorMessage: 'aborted',
      outcome: 'aborted',
    });
    expect(explicit.fetchOutcome).toBe('aborted');
  });
});

describe('TelemetryRingBuffer', () => {
  it('caps at max records and drops oldest FIFO', () => {
    const rb = new TelemetryRingBuffer({ max: 3 });
    for (let i = 0; i < 5; i++) {
      rb.push(baseEntry({ now: 1_700_000_000_000 + i }));
    }
    const snap = rb.snapshot();
    expect(snap.length).toBe(3);
    expect(snap.map((r) => r.submitHandlerEnteredAt)).toEqual([
      1_700_000_000_002,
      1_700_000_000_003,
      1_700_000_000_004,
    ]);
  });

  it('replace() swaps a finalised record in place without changing order', () => {
    const rb = new TelemetryRingBuffer({ max: 10 });
    const a = baseEntry({ now: 1 });
    const b = baseEntry({ now: 2 });
    rb.push(a);
    rb.push(b);
    const finalised = finalizeResolvedRecord(markFetchStarted(a, 3), {
      now: 4,
      status: 200,
      ok: true,
      type: 'cors',
      headers: new Headers(),
    });
    rb.replace(a, finalised);
    const snap = rb.snapshot();
    expect(snap[0].httpStatus).toBe(200);
    expect(snap[1].submitHandlerEnteredAt).toBe(2);
  });

  it('clear() empties memory and storage mirror', () => {
    const store: Record<string, string> = {};
    const adapter: StorageAdapter = {
      get: (k) => (k in store ? store[k] : null),
      set: (k, v) => {
        store[k] = v;
      },
      remove: (k) => {
        delete store[k];
      },
    };
    const rb = new TelemetryRingBuffer({ max: 10, storage: adapter, storageKey: 'k' });
    rb.push(baseEntry());
    expect(store['k']).toBeTruthy();
    rb.clear();
    expect(rb.snapshot()).toEqual([]);
    expect(store['k']).toBeUndefined();
  });

  it('hydrates from storage on construction', () => {
    const seed: TelemetryRecord[] = [baseEntry(), baseEntry({ now: 9 })];
    const store: Record<string, string> = { k: JSON.stringify(seed) };
    const adapter: StorageAdapter = {
      get: (k) => store[k] ?? null,
      set: (k, v) => {
        store[k] = v;
      },
      remove: (k) => {
        delete store[k];
      },
    };
    const rb = new TelemetryRingBuffer({ max: 10, storage: adapter, storageKey: 'k' });
    expect(rb.snapshot().length).toBe(2);
  });

  it('ignores corrupt storage and resets it, rather than throwing', () => {
    const store: Record<string, string> = { k: '{not json' };
    const adapter: StorageAdapter = {
      get: (k) => store[k] ?? null,
      set: (k, v) => {
        store[k] = v;
      },
      remove: (k) => {
        delete store[k];
      },
    };
    const rb = new TelemetryRingBuffer({ max: 10, storage: adapter, storageKey: 'k' });
    expect(rb.snapshot()).toEqual([]);
    expect(store['k']).toBeUndefined();
  });
});
