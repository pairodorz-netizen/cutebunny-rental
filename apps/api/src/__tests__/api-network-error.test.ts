import { describe, it, expect } from 'vitest';
import {
  buildApiNetworkError,
  formatApiNetworkError,
  ApiNetworkError,
} from '@cutebunny/shared/diagnostics';

// BUG401-A02 Track A: pure helpers that turn an opaque `fetch` TypeError
// into structured diagnostics. Keeps the admin client's banner + "Copy
// debug info" button deterministic regardless of browser / platform.

describe('buildApiNetworkError', () => {
  const baseInput = {
    url: 'https://cutebunny-api.cutebunny-rental.workers.dev/api/v1/admin/products',
    method: 'post',
    tokenPresent: true,
    online: true,
    startedAt: 1_700_000_000_000,
    now: 1_700_000_000_123,
    userAgent: 'Mozilla/5.0 test',
  };

  it('returns an ApiNetworkError whose payload captures transport context', () => {
    const err = buildApiNetworkError({ ...baseInput, err: new TypeError('Failed to fetch') });
    expect(err).toBeInstanceOf(ApiNetworkError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ApiNetworkError');
    expect(err.message).toBe('Failed to fetch');
    expect(err.payload.method).toBe('POST');
    expect(err.payload.url).toBe(baseInput.url);
    expect(err.payload.tokenPresent).toBe(true);
    expect(err.payload.online).toBe(true);
    expect(err.payload.elapsedMs).toBe(123);
    expect(err.payload.errorName === undefined || err.payload.name === 'TypeError').toBe(true);
    expect(err.payload.name).toBe('TypeError');
    expect(err.payload.startedAt).toBe('2023-11-14T22:13:20.000Z');
    expect(err.payload.userAgent).toBe('Mozilla/5.0 test');
  });

  it('falls back gracefully when err is a plain string', () => {
    const err = buildApiNetworkError({ ...baseInput, err: 'NetworkError when attempting to fetch resource.' });
    expect(err.message).toBe('NetworkError when attempting to fetch resource.');
    expect(err.payload.name).toBe('Error');
  });

  it('falls back to a sentinel message when err is an unknown non-Error value', () => {
    const err = buildApiNetworkError({ ...baseInput, err: { weird: true } });
    expect(err.message).toBe('Unknown network error');
    expect(err.payload.name).toBe('Error');
  });

  it('clamps negative elapsedMs to 0 when now precedes startedAt', () => {
    const err = buildApiNetworkError({ ...baseInput, now: baseInput.startedAt - 5_000, err: new Error('boom') });
    expect(err.payload.elapsedMs).toBe(0);
  });

  it('records online=false so the UI can show an offline badge', () => {
    const err = buildApiNetworkError({ ...baseInput, online: false, err: new TypeError('Failed to fetch') });
    expect(err.payload.online).toBe(false);
  });

  it('records tokenPresent=false so we can distinguish pre-login failures', () => {
    const err = buildApiNetworkError({ ...baseInput, tokenPresent: false, err: new TypeError('Failed to fetch') });
    expect(err.payload.tokenPresent).toBe(false);
  });
});

describe('formatApiNetworkError', () => {
  it('renders a stable, copyable multi-line debug dump', () => {
    const err = buildApiNetworkError({
      url: 'https://cutebunny-api.cutebunny-rental.workers.dev/health',
      method: 'get',
      tokenPresent: false,
      online: true,
      startedAt: 1_700_000_000_000,
      now: 1_700_000_000_042,
      err: new TypeError('Failed to fetch'),
      userAgent: 'UA/1.0',
    });
    const dump = formatApiNetworkError(err);
    expect(dump).toContain('BUG401 debug info');
    expect(dump).toContain('method:       GET');
    expect(dump).toContain('tokenPresent: false');
    expect(dump).toContain('online:       true');
    expect(dump).toContain('errorName:    TypeError');
    expect(dump).toContain('errorMessage: Failed to fetch');
    expect(dump).toContain('elapsedMs:    42');
    expect(dump).toContain('userAgent:    UA/1.0');
  });

  it('omits the userAgent line when none was captured', () => {
    const err = buildApiNetworkError({
      url: 'https://example.invalid',
      method: 'get',
      tokenPresent: false,
      online: true,
      startedAt: 0,
      now: 0,
      err: new Error('nope'),
    });
    expect(formatApiNetworkError(err)).not.toContain('userAgent:');
  });
});
