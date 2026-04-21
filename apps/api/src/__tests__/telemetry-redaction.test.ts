import { describe, it, expect } from 'vitest';
import {
  redactUrl,
  redactErrorMessage,
  extractResponseHeadersSubset,
  buildDiagnosticReport,
  type TelemetryRecord,
  buildSubmitEntryRecord,
} from '@cutebunny/shared/diagnostics';

/**
 * A02 acceptance criterion 6 (redaction):
 *   - no Authorization header value
 *   - no request body
 *   - no response body
 *   - no image/file bytes
 *   - no uploaded filenames
 *   - no full URLs in errorMessage (origin+path only)
 *   - no PII
 *
 * These tests lock in the pure helpers that enforce those rules.
 */
describe('redactUrl', () => {
  it('splits an absolute URL into origin + path, dropping querystring and fragment', () => {
    const out = redactUrl('https://api.example.com/v1/admin/products?token=secret#x');
    expect(out).toEqual({ origin: 'https://api.example.com', path: '/v1/admin/products' });
  });

  it('drops userinfo segments so leaked credentials never reach telemetry', () => {
    const out = redactUrl('https://user:pass@api.example.com/health');
    expect(out.origin).toBe('https://api.example.com');
    expect(out.path).toBe('/health');
  });

  it('returns empty strings for a malformed URL rather than throwing', () => {
    expect(redactUrl('not-a-url')).toEqual({ origin: '', path: '' });
  });
});

describe('redactErrorMessage', () => {
  it('replaces full URLs with [url] so origins with query strings do not leak', () => {
    const out = redactErrorMessage(
      'fetch https://secret.internal/path?token=abc failed',
    );
    expect(out).toBe('fetch [url] failed');
  });

  it('strips bearer tokens of any length', () => {
    const out = redactErrorMessage('Bad token: Bearer abcdef12345.xyz_-');
    expect(out).toBe('Bad token: Bearer [redacted]');
  });

  it('strips raw JWT-shaped strings that are not labelled as bearer', () => {
    const out = redactErrorMessage('leaked eyJhbGciOiJIUzI1NiJ9.payload.sig1234');
    expect(out).toContain('[jwt]');
    expect(out).not.toContain('eyJ');
  });

  it('clips over-long messages', () => {
    const giant = 'x'.repeat(500);
    const out = redactErrorMessage(giant)!;
    expect(out.length).toBeLessThanOrEqual(201);
    expect(out.endsWith('…')).toBe(true);
  });

  it('returns null for non-string inputs', () => {
    expect(redactErrorMessage(null)).toBeNull();
    expect(redactErrorMessage(undefined)).toBeNull();
  });
});

describe('extractResponseHeadersSubset', () => {
  it('keeps only the four allow-listed headers and drops everything else', () => {
    const headers = new Headers({
      'content-type': 'application/json',
      'cf-ray': 'abc123',
      server: 'cloudflare',
      'x-request-id': 'req-42',
      'set-cookie': 'session=SENSITIVE',
      authorization: 'Bearer SENSITIVE',
      'x-body-sha256': 'deadbeef',
    });
    const out = extractResponseHeadersSubset(headers);
    expect(out).toEqual({
      'content-type': 'application/json',
      'cf-ray': 'abc123',
      server: 'cloudflare',
      'x-request-id': 'req-42',
    });
    expect(Object.keys(out)).not.toContain('set-cookie');
    expect(Object.keys(out)).not.toContain('authorization');
  });

  it('returns an empty object if headers are null/undefined', () => {
    expect(extractResponseHeadersSubset(null)).toEqual({});
    expect(extractResponseHeadersSubset(undefined)).toEqual({});
  });
});

describe('buildDiagnosticReport', () => {
  it('never leaks body, filename, or Authorization fields (schema does not have them)', () => {
    const base = buildSubmitEntryRecord({
      now: 1700000000000,
      frontendDeploymentId: 'deploy-1',
      apiBaseUrl: 'https://api.example.com',
      requestUrl: 'https://api.example.com/v1/admin/products',
      contentType: 'multipart/form-data',
      hasAuthorizationHeader: true,
      authTokenPresent: true,
      authTokenExpiresAt: null,
      navigatorOnline: true,
      connectionEffectiveType: '4g',
      connectionRtt: 100,
      connectionDownlink: 10,
    });
    const record: TelemetryRecord = {
      ...base,
      errorName: 'TypeError',
      errorMessage: 'fetch https://api.example.com/v1/admin/products failed',
    };
    const report = buildDiagnosticReport([record]);
    const parsed = JSON.parse(report);
    expect(parsed.records[0].hasAuthorizationHeader).toBe(true);
    // schema never has a body / filename / header-value field
    expect(report).not.toMatch(/authorization["'][:\s]+["']bearer/i);
    expect(report).not.toMatch(/"body"\s*:/);
    expect(report).not.toMatch(/"filename"\s*:/);
  });
});
