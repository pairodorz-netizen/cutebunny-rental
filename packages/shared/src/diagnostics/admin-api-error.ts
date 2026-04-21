/**
 * BUG-404-A02 — admin frontend error reader.
 *
 * Pure, framework-free helpers for reading an HTTP error Response from
 * the admin API and classifying it into one of three render kinds:
 *
 *   - `inline`   — field-scoped error (e.g. SKU conflict under the SKU field).
 *   - `toast`    — known JSON error that should appear as a single
 *                  readable notification.
 *   - `fallback` — the response body was not JSON (or was malformed
 *                  JSON): show a concise, redacted dump so the user
 *                  isn't left with "Unexpected token 'I'..." from a
 *                  blind JSON.parse.
 *
 * Redaction rules (spec §A02 tests #5 + BUG-401-A02 baseline):
 *   - Never include an Authorization header value or a Bearer-looking
 *     token fragment.
 *   - Never echo a request body field.
 *   - Snippet is truncated to 120 chars and collapsed to single-line.
 */

const SNIPPET_MAX_LENGTH = 120;
const DISPLAY_MESSAGE_MAX_LENGTH = 200;

export type AdminApiErrorKind = 'envelope' | 'non_json';

export interface AdminApiErrorPayload {
  /** HTTP status from the Response. */
  status: number;
  /** How we interpreted the body: a JSON envelope or a non-JSON blob. */
  kind: AdminApiErrorKind;
  /** Parsed `error.code` when kind='envelope' and the body had one. */
  code: string | null;
  /** Parsed `error.field` when kind='envelope' and the body had one. */
  field: string | null;
  /**
   * User-visible, readable message. NEVER the raw JSON serialization of
   * the response body, and never a bearer/authorization leak.
   */
  message: string;
  /**
   * For kind='non_json': a ≤120-char redacted single-line snippet of the
   * raw body, suitable for surfacing to the user. `null` for envelope
   * kinds.
   */
  snippet: string | null;
  /** Original Content-Type header, for diagnostics only. */
  contentType: string | null;
}

export class AdminApiError extends Error {
  readonly payload: AdminApiErrorPayload;
  constructor(payload: AdminApiErrorPayload) {
    super(payload.message);
    this.name = 'AdminApiError';
    this.payload = payload;
  }
}

// ─── Redaction helpers ─────────────────────────────────────────────────────

function redactSnippet(raw: string): string {
  if (!raw) return '';
  let out = raw;
  // Strip any full Authorization line (case-insensitive).
  out = out.replace(/^.*authorization\s*:.*$/gim, '[redacted-auth]');
  // Strip a bare `Bearer <token>` fragment.
  out = out.replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]');
  // Collapse whitespace/newlines into single spaces so the snippet is
  // one line. This also dilutes any multi-line leaks.
  out = out.replace(/\s+/g, ' ').trim();
  if (out.length > SNIPPET_MAX_LENGTH) {
    out = out.slice(0, SNIPPET_MAX_LENGTH - 1).trimEnd() + '…';
  }
  return out;
}

function isJsonContentType(ct: string | null): boolean {
  if (!ct) return false;
  return /application\/(?:[^;]+\+)?json/i.test(ct);
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

// ─── parseAdminErrorResponse ───────────────────────────────────────────────

/**
 * Read an HTTP Response and return an AdminApiError that the UI can
 * classify and render. Never throws (even on malformed bodies); always
 * resolves to an AdminApiError.
 *
 * Call-site contract: invoked only when `!res.ok` by the admin request
 * helper. The 201-success defensive test pins that a caller mistakenly
 * invoking it on a 2xx still gets a well-formed envelope back instead
 * of an unhandled crash.
 */
export async function parseAdminErrorResponse(res: Response): Promise<AdminApiError> {
  const contentType = res.headers.get('content-type');

  if (isJsonContentType(contentType)) {
    // Read as text first so a malformed JSON body falls through to the
    // non-JSON path cleanly (instead of bubbling a SyntaxError).
    const raw = await safeReadText(res);
    if (raw.length > 0) {
      try {
        const parsed = JSON.parse(raw);
        const env = (parsed && typeof parsed === 'object' ? (parsed as { error?: unknown }).error : null) ?? null;
        const envObj = env && typeof env === 'object' ? (env as Record<string, unknown>) : null;
        const code = envObj && typeof envObj.code === 'string' ? envObj.code : null;
        const field = envObj && typeof envObj.field === 'string' ? envObj.field : null;
        const rawMessage = envObj && typeof envObj.message === 'string' ? envObj.message : '';
        const message = rawMessage.trim().length > 0 ? rawMessage.trim() : `API error: ${res.status}`;
        return new AdminApiError({
          status: res.status,
          kind: 'envelope',
          code,
          field,
          message,
          snippet: null,
          contentType,
        });
      } catch {
        // malformed JSON → non-JSON fallback below
        const snippet = redactSnippet(raw);
        return new AdminApiError({
          status: res.status,
          kind: 'non_json',
          code: null,
          field: null,
          message: buildNonJsonMessage(res.status, snippet),
          snippet: snippet.length > 0 ? snippet : null,
          contentType,
        });
      }
    }
  }

  // Non-JSON: read body, redact, snippet.
  const raw = await safeReadText(res);
  const snippet = redactSnippet(raw);
  return new AdminApiError({
    status: res.status,
    kind: 'non_json',
    code: null,
    field: null,
    message: buildNonJsonMessage(res.status, snippet),
    snippet: snippet.length > 0 ? snippet : null,
    contentType,
  });
}

function buildNonJsonMessage(status: number, snippet: string): string {
  const base = `Server returned ${status}`;
  if (!snippet) return base;
  const combined = `${base}: ${snippet}`;
  if (combined.length <= DISPLAY_MESSAGE_MAX_LENGTH) return combined;
  return combined.slice(0, DISPLAY_MESSAGE_MAX_LENGTH - 1).trimEnd() + '…';
}

// ─── classifyAdminApiError ─────────────────────────────────────────────────

export interface AdminApiErrorDecisionInline {
  kind: 'inline';
  fieldKey: 'sku';
  displayMessage: string;
}

export interface AdminApiErrorDecisionToast {
  kind: 'toast';
  fieldKey?: undefined;
  displayMessage: string;
}

export interface AdminApiErrorDecisionFallback {
  kind: 'fallback';
  fieldKey?: undefined;
  displayMessage: string;
}

export type AdminApiErrorDecision =
  | AdminApiErrorDecisionInline
  | AdminApiErrorDecisionToast
  | AdminApiErrorDecisionFallback;

/**
 * Route an AdminApiError to a render kind. Pure: no React, no DOM, no
 * side effects. The admin submit handler consumes the decision and
 * picks between an inline field-error, a toast, or a fallback banner.
 */
export function classifyAdminApiError(err: AdminApiError): AdminApiErrorDecision {
  const p = err.payload;

  if (p.kind === 'non_json') {
    return {
      kind: 'fallback',
      displayMessage: truncateForDisplay(p.message),
    };
  }

  // Envelope kind from here on.
  if (p.code === 'sku_conflict' && p.field === 'sku') {
    return {
      kind: 'inline',
      fieldKey: 'sku',
      displayMessage: truncateForDisplay(p.message),
    };
  }

  return {
    kind: 'toast',
    displayMessage: truncateForDisplay(p.message),
  };
}

function truncateForDisplay(msg: string): string {
  if (msg.length <= DISPLAY_MESSAGE_MAX_LENGTH) return msg;
  return msg.slice(0, DISPLAY_MESSAGE_MAX_LENGTH - 1).trimEnd() + '…';
}
