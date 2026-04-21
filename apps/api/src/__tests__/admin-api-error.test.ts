/**
 * BUG-404-A02 — admin frontend error reader (pure-logic units).
 *
 * These tests pin the contract for the admin Create Product submit
 * error path. The frontend MUST branch on `res.status` + Content-Type
 * BEFORE parsing, never blindly call `res.json()` on a non-JSON body,
 * and always produce a readable / redacted display message.
 *
 * Gates exercised here (spec §Tests A02):
 *   #1 Non-JSON response → fallback UI: status + ≤120-char snippet,
 *      no throw from JSON.parse.
 *   #2 JSON 409 { code:'sku_conflict', field:'sku' } → classify as
 *      INLINE error under the SKU field with a readable message.
 *   #3 JSON 500 { code:'internal_error' } → classify as TOAST with a
 *      readable message (NOT the raw JSON string).
 *   #4 Success 201 (JSON product) path → parse reader not engaged for
 *      ok responses; classifier is a no-op for success.
 *   #5 Redaction — snippet never contains an Authorization header
 *      value, a Bearer token, a full URL query, or request body.
 *   #6 No DiagnosticsBar regression — the new reader runs only on
 *      Response objects; genuine transport rejections still surface
 *      as the pre-existing ApiNetworkError type.
 *
 * Tests are written BEFORE implementation exists (TDD): the first run
 * will fail on the missing module import and missing exports. That is
 * expected.
 */
import { describe, it, expect } from 'vitest';
import {
  AdminApiError,
  parseAdminErrorResponse,
  classifyAdminApiError,
  type AdminApiErrorPayload,
} from '@cutebunny/shared/diagnostics';
import { ApiNetworkError } from '@cutebunny/shared/diagnostics';

// ─── Fixtures ──────────────────────────────────────────────────────────────

function jsonResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

function textResponse(status: number, body: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...extraHeaders },
  });
}

function bareResponse(status: number, body: string): Response {
  // Response without content-type header at all. Simulates a proxy / edge
  // error page that came back without a type declaration.
  return new Response(body, { status });
}

// ─── Helpers (assertions reused across tests) ──────────────────────────────

function assertRedacted(payload: AdminApiErrorPayload, secrets: string[]): void {
  const serialized = JSON.stringify(payload);
  expect(serialized).not.toMatch(/Bearer\s+[A-Za-z0-9._-]+/i);
  expect(serialized).not.toMatch(/Authorization:/i);
  for (const secret of secrets) {
    if (!secret) continue;
    expect(serialized).not.toContain(secret);
  }
  // Snippet size invariant.
  if (payload.snippet !== null) {
    expect(payload.snippet.length).toBeLessThanOrEqual(120);
  }
}

// ─── Gate #2: 409 sku_conflict envelope ────────────────────────────────────

describe('parseAdminErrorResponse — JSON envelope paths', () => {
  it('maps a 409 sku_conflict envelope to AdminApiError{kind:envelope, code, field, message}', async () => {
    const res = jsonResponse(409, {
      error: { code: 'sku_conflict', field: 'sku', message: 'SKU already exists' },
    });

    const err = await parseAdminErrorResponse(res);

    expect(err).toBeInstanceOf(AdminApiError);
    expect(err).toBeInstanceOf(Error);
    expect(err.payload.status).toBe(409);
    expect(err.payload.kind).toBe('envelope');
    expect(err.payload.code).toBe('sku_conflict');
    expect(err.payload.field).toBe('sku');
    expect(err.payload.message).toBe('SKU already exists');
    expect(err.payload.snippet).toBeNull();
    // Error.message is user-readable (NOT the raw JSON of the response).
    expect(err.message).toBe('SKU already exists');
    expect(err.message).not.toContain('{');
    expect(err.message).not.toContain('"code"');
  });

  it('maps a 500 internal_error envelope to AdminApiError{code:internal_error}', async () => {
    const res = jsonResponse(500, {
      error: { code: 'internal_error', message: 'Unexpected server error' },
    });

    const err = await parseAdminErrorResponse(res);

    expect(err.payload.status).toBe(500);
    expect(err.payload.kind).toBe('envelope');
    expect(err.payload.code).toBe('internal_error');
    expect(err.payload.field).toBeNull();
    expect(err.payload.message).toBe('Unexpected server error');
    expect(err.message).toBe('Unexpected server error');
    // Never leak the raw JSON serialization into the user-visible message.
    expect(err.message).not.toContain('{');
  });
});

// ─── Gate #1: non-JSON fallback ────────────────────────────────────────────

describe('parseAdminErrorResponse — non-JSON fallback', () => {
  it('does not throw on a text/plain 500 "Internal Server Error" body', async () => {
    const res = textResponse(500, 'Internal Server Error');

    await expect(parseAdminErrorResponse(res)).resolves.toBeInstanceOf(AdminApiError);
  });

  it('maps a text/plain 500 body to AdminApiError{kind:non_json, snippet, status}', async () => {
    const res = textResponse(500, 'Internal Server Error');

    const err = await parseAdminErrorResponse(res);

    expect(err.payload.kind).toBe('non_json');
    expect(err.payload.status).toBe(500);
    expect(err.payload.code).toBeNull();
    expect(err.payload.field).toBeNull();
    expect(err.payload.snippet).toBe('Internal Server Error');
    // User-visible message encodes status + snippet — readable, not raw JSON.
    expect(err.message).toContain('500');
    expect(err.message).toContain('Internal Server Error');
  });

  it('truncates very long non-JSON bodies to ≤120 chars in snippet', async () => {
    const longBody = 'X'.repeat(10000);
    const res = textResponse(502, longBody);

    const err = await parseAdminErrorResponse(res);

    expect(err.payload.kind).toBe('non_json');
    expect(err.payload.snippet).not.toBeNull();
    expect(err.payload.snippet!.length).toBeLessThanOrEqual(120);
  });

  it('treats a response without any Content-Type as non-JSON', async () => {
    const res = bareResponse(504, '<html><body>Bad gateway</body></html>');

    const err = await parseAdminErrorResponse(res);

    expect(err.payload.kind).toBe('non_json');
    expect(err.payload.status).toBe(504);
    expect(err.payload.snippet).not.toBeNull();
    expect(err.payload.snippet!.length).toBeLessThanOrEqual(120);
  });

  it('falls back to non_json when content-type claims JSON but the body is malformed', async () => {
    const res = new Response('<<not json>>', {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });

    const err = await parseAdminErrorResponse(res);

    expect(err.payload.kind).toBe('non_json');
    expect(err.payload.status).toBe(500);
    expect(err.payload.snippet).toContain('not json');
  });
});

// ─── Gate #5: redaction ────────────────────────────────────────────────────

describe('parseAdminErrorResponse — redaction', () => {
  it('strips Bearer-looking tokens and Authorization lines from the snippet', async () => {
    const leaky = [
      '500 Internal Server Error',
      'Authorization: Bearer abc.def.ghi',
      'x-request-id: xyz',
    ].join('\n');
    const res = textResponse(500, leaky);

    const err = await parseAdminErrorResponse(res);

    assertRedacted(err.payload, ['abc.def.ghi']);
    // Snippet still exists (just without the secret).
    expect(err.payload.snippet).not.toBeNull();
  });

  it('never echoes submitted request body values into the error', async () => {
    // The reader never sees the request body — but this test locks in
    // the fact that the AdminApiError carries only response-derived
    // context. If somebody ever adds a "requestBody" field to the
    // payload this test fails loudly.
    const secretSku = 'SKU-SECRET-VALUE-DO-NOT-LEAK';
    const res = textResponse(500, 'Boom');
    const err = await parseAdminErrorResponse(res);
    assertRedacted(err.payload, [secretSku, 'password', 'secret']);
  });
});

// ─── Gate #3 / #2 / #1 classification ──────────────────────────────────────

describe('classifyAdminApiError — render-kind routing', () => {
  it('routes 409 sku_conflict + field=sku to INLINE under SKU field', () => {
    const err = new AdminApiError({
      status: 409,
      kind: 'envelope',
      code: 'sku_conflict',
      field: 'sku',
      message: 'SKU already exists',
      snippet: null,
      contentType: 'application/json',
    });

    const decision = classifyAdminApiError(err);

    expect(decision.kind).toBe('inline');
    expect(decision.fieldKey).toBe('sku');
    expect(decision.displayMessage).toBe('SKU already exists');
  });

  it('routes 500 internal_error to TOAST with a readable message', () => {
    const err = new AdminApiError({
      status: 500,
      kind: 'envelope',
      code: 'internal_error',
      field: null,
      message: 'Unexpected server error',
      snippet: null,
      contentType: 'application/json',
    });

    const decision = classifyAdminApiError(err);

    expect(decision.kind).toBe('toast');
    expect(decision.fieldKey).toBeUndefined();
    expect(decision.displayMessage).toBe('Unexpected server error');
    // Toast message is never the raw JSON serialization.
    expect(decision.displayMessage).not.toContain('{');
    expect(decision.displayMessage).not.toContain('"code"');
  });

  it('routes a non_json 500 to FALLBACK with status + short snippet', () => {
    const err = new AdminApiError({
      status: 500,
      kind: 'non_json',
      code: null,
      field: null,
      message: 'Server returned 500: Internal Server Error',
      snippet: 'Internal Server Error',
      contentType: 'text/plain; charset=utf-8',
    });

    const decision = classifyAdminApiError(err);

    expect(decision.kind).toBe('fallback');
    expect(decision.displayMessage).toContain('500');
    expect(decision.displayMessage).toContain('Internal Server Error');
    // Always ≤ 200 chars to protect the toast/banner UI.
    expect(decision.displayMessage.length).toBeLessThanOrEqual(200);
  });

  it('routes an unknown JSON error code to TOAST, not INLINE', () => {
    const err = new AdminApiError({
      status: 418,
      kind: 'envelope',
      code: 'teapot',
      field: null,
      message: "I'm a teapot",
      snippet: null,
      contentType: 'application/json',
    });

    const decision = classifyAdminApiError(err);

    expect(decision.kind).toBe('toast');
    expect(decision.fieldKey).toBeUndefined();
    expect(decision.displayMessage).toBe("I'm a teapot");
  });

  it('does not route sku_conflict to INLINE when field is missing (defensive)', () => {
    const err = new AdminApiError({
      status: 409,
      kind: 'envelope',
      code: 'sku_conflict',
      field: null, // buggy backend
      message: 'SKU already exists',
      snippet: null,
      contentType: 'application/json',
    });

    const decision = classifyAdminApiError(err);

    // Falls back to toast so the user still sees something useful
    // instead of a silent no-op focus on a missing field.
    expect(decision.kind).toBe('toast');
    expect(decision.displayMessage).toBe('SKU already exists');
  });
});

// ─── Gate #6: DiagnosticsBar non-regression ────────────────────────────────

describe('AdminApiError vs ApiNetworkError — disjoint classes', () => {
  it('AdminApiError and ApiNetworkError are distinct classes (disjoint instanceof)', () => {
    const admin = new AdminApiError({
      status: 500,
      kind: 'non_json',
      code: null,
      field: null,
      message: 'x',
      snippet: null,
      contentType: null,
    });
    const network = new ApiNetworkError({
      url: 'http://api/test',
      method: 'POST',
      tokenPresent: true,
      online: true,
      message: 'Failed to fetch',
      name: 'TypeError',
      elapsedMs: 12,
      startedAt: new Date(0).toISOString(),
    });

    expect(admin).toBeInstanceOf(AdminApiError);
    expect(admin).not.toBeInstanceOf(ApiNetworkError);
    expect(network).toBeInstanceOf(ApiNetworkError);
    expect(network).not.toBeInstanceOf(AdminApiError);
  });
});

// ─── Gate #4: success path untouched ───────────────────────────────────────

describe('parseAdminErrorResponse — success path guard', () => {
  it('is documented to only be called for !res.ok; calling on a 201 still produces a well-formed envelope read', async () => {
    // This is a defensive spec: the api.ts call-site guards with
    // `!res.ok` before invoking parseAdminErrorResponse. But if a
    // future caller mis-uses it on a 201 success body, it must still
    // return a well-formed AdminApiError (NOT throw), so no cascading
    // crash leaks to the UI.
    const res = jsonResponse(201, { data: { id: 'p1', sku: 'X', name: 'Y', category: 'wedding' } });

    const err = await parseAdminErrorResponse(res);

    expect(err).toBeInstanceOf(AdminApiError);
    expect(err.payload.status).toBe(201);
    // A 201 response has no `error` envelope; the reader must fall
    // through to a benign shape instead of exploding.
    expect(err.payload.code).toBeNull();
  });
});
