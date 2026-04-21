/**
 * BUG401-A02: diagnostic telemetry for the admin Create Product flow.
 *
 * This module is intentionally framework-free and browser-free. All browser
 * side-effects (sessionStorage, window, navigator) are injected by callers
 * so the full pipeline is testable under node/vitest.
 *
 * Invariants enforced here (see acceptance criteria in the A02 spec):
 *   - redaction happens BEFORE any optional storage mirror write.
 *   - no synthetic timeout/abort is ever introduced by this module.
 *   - the ring buffer caps at `max` records (default 10) dropping oldest.
 *   - record factories default every nullable field to `null`, not `undefined`,
 *     so consumers can safely JSON-serialise.
 */

export type FetchOutcome =
  | 'resolved_response'
  | 'rejected_error'
  | 'timeout'
  | 'aborted';

export type ResponseTypeValue = 'basic' | 'cors' | 'opaque' | 'error' | null;

export type Unsupported = 'unsupported';

export interface ResponseHeadersSubset {
  'content-type'?: string;
  'cf-ray'?: string;
  server?: string;
  'x-request-id'?: string;
}

export interface TelemetryRecord {
  operation: 'createProduct';
  timestamp: string;
  frontendDeploymentId: string;
  apiBaseOrigin: string;
  requestUrlOrigin: string;
  requestPath: string;
  method: 'POST';
  contentType: string;
  hasAuthorizationHeader: boolean;
  authTokenPresent: boolean;
  authTokenExpiryKnown: boolean;
  authTokenExpiresAt: string | null;
  submitHandlerEnteredAt: number;
  serializationStartedAt: number | null;
  serializationEndedAt: number | null;
  fetchStartedAt: number | null;
  fetchEndedAt: number | null;
  durationMs: number | null;
  fetchOutcome: FetchOutcome | null;
  httpStatus: number | null;
  responseOk: boolean | null;
  responseType: ResponseTypeValue;
  responseHeadersSubset: ResponseHeadersSubset;
  errorName: string | null;
  errorMessage: string | null;
  navigatorOnline: boolean;
  connectionEffectiveType: string | Unsupported;
  connectionRtt: number | Unsupported;
  connectionDownlink: number | Unsupported;
  workerSeen: true | false | 'unknown';
}

/* ------------------------------------------------------------------ */
/* Redaction                                                          */
/* ------------------------------------------------------------------ */

export interface RedactedUrl {
  origin: string;
  path: string;
}

/**
 * Split a URL into origin+path, dropping querystring, fragment, and
 * userinfo. Returns best-effort empty strings if the input is not a valid
 * absolute URL.
 */
export function redactUrl(url: string): RedactedUrl {
  try {
    const u = new URL(url);
    return { origin: u.origin, path: u.pathname };
  } catch {
    return { origin: '', path: '' };
  }
}

/**
 * Scrub anything that looks like a full URL, bearer token, or base64 blob
 * from a free-form error message. The remaining text is clipped to 200
 * chars so a malicious or huge message can't blow up the record.
 */
export function redactErrorMessage(message: string | null | undefined): string | null {
  if (typeof message !== 'string') return null;
  let out = message;
  out = out.replace(/https?:\/\/\S+/gi, '[url]');
  out = out.replace(/bearer\s+[\w.\-~+/=]+/gi, 'Bearer [redacted]');
  out = out.replace(/eyJ[\w.\-~+/=]{10,}/g, '[jwt]');
  if (out.length > 200) out = out.slice(0, 200) + '…';
  return out;
}

const ALLOWED_RESPONSE_HEADERS: ReadonlyArray<keyof ResponseHeadersSubset> = [
  'content-type',
  'cf-ray',
  'server',
  'x-request-id',
];

/**
 * Whitelist-pick exactly four response headers. Any other header (including
 * Set-Cookie, Authorization-esque, body checksums) is dropped on the floor.
 */
export function extractResponseHeadersSubset(
  headers: { get(name: string): string | null } | null | undefined,
): ResponseHeadersSubset {
  const out: ResponseHeadersSubset = {};
  if (!headers) return out;
  for (const name of ALLOWED_RESPONSE_HEADERS) {
    const v = headers.get(name);
    if (typeof v === 'string' && v.length > 0) {
      out[name] = v.length > 256 ? v.slice(0, 256) + '…' : v;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Record factories                                                   */
/* ------------------------------------------------------------------ */

export interface SubmitEntryInput {
  now: number;
  frontendDeploymentId: string;
  apiBaseUrl: string;
  requestUrl: string;
  contentType: string;
  hasAuthorizationHeader: boolean;
  authTokenPresent: boolean;
  authTokenExpiresAt: Date | null;
  navigatorOnline: boolean;
  connectionEffectiveType: string | Unsupported;
  connectionRtt: number | Unsupported;
  connectionDownlink: number | Unsupported;
}

/**
 * Build a fresh record at submit-handler entry. Fields that depend on
 * later phases (fetchStartedAt, httpStatus, …) are initialised to null.
 * This is the signature used by H6 (no record = handler never fired) and
 * H3-b (record exists, fetchStartedAt=null).
 */
export function buildSubmitEntryRecord(input: SubmitEntryInput): TelemetryRecord {
  const redacted = redactUrl(input.requestUrl);
  const apiBase = redactUrl(input.apiBaseUrl);
  return {
    operation: 'createProduct',
    timestamp: new Date(input.now).toISOString(),
    frontendDeploymentId: input.frontendDeploymentId,
    apiBaseOrigin: apiBase.origin,
    requestUrlOrigin: redacted.origin,
    requestPath: redacted.path,
    method: 'POST',
    contentType: input.contentType,
    hasAuthorizationHeader: input.hasAuthorizationHeader,
    authTokenPresent: input.authTokenPresent,
    authTokenExpiryKnown: input.authTokenExpiresAt !== null,
    authTokenExpiresAt:
      input.authTokenExpiresAt !== null ? input.authTokenExpiresAt.toISOString() : null,
    submitHandlerEnteredAt: input.now,
    serializationStartedAt: null,
    serializationEndedAt: null,
    fetchStartedAt: null,
    fetchEndedAt: null,
    durationMs: null,
    fetchOutcome: null,
    httpStatus: null,
    responseOk: null,
    responseType: null,
    responseHeadersSubset: {},
    errorName: null,
    errorMessage: null,
    navigatorOnline: input.navigatorOnline,
    connectionEffectiveType: input.connectionEffectiveType,
    connectionRtt: input.connectionRtt,
    connectionDownlink: input.connectionDownlink,
    workerSeen: 'unknown',
  };
}

export function markSerializationStarted(
  record: TelemetryRecord,
  now: number,
): TelemetryRecord {
  return { ...record, serializationStartedAt: now };
}

export function markSerializationEnded(
  record: TelemetryRecord,
  now: number,
): TelemetryRecord {
  return { ...record, serializationEndedAt: now };
}

export function markFetchStarted(
  record: TelemetryRecord,
  now: number,
): TelemetryRecord {
  return { ...record, fetchStartedAt: now };
}

export interface ResolvedFetchInput {
  now: number;
  status: number;
  ok: boolean;
  type: ResponseTypeValue;
  headers: { get(name: string): string | null } | null | undefined;
}

/**
 * Finalise a record for a fetch that resolved with a Response (including
 * non-2xx). We do NOT read the body; we only sample the four allow-listed
 * headers via the pure helper above.
 */
export function finalizeResolvedRecord(
  record: TelemetryRecord,
  input: ResolvedFetchInput,
): TelemetryRecord {
  const started = record.fetchStartedAt ?? input.now;
  const headers = extractResponseHeadersSubset(input.headers);
  const workerSeen = typeof headers['cf-ray'] === 'string' && headers['cf-ray'].length > 0;
  return {
    ...record,
    fetchEndedAt: input.now,
    durationMs: Math.max(0, input.now - started),
    fetchOutcome: 'resolved_response',
    httpStatus: input.status,
    responseOk: input.ok,
    responseType: input.type,
    responseHeadersSubset: headers,
    workerSeen,
  };
}

export interface RejectedFetchInput {
  now: number;
  errorName: string | null;
  errorMessage: string | null;
  outcome?: 'rejected_error' | 'timeout' | 'aborted';
}

/**
 * Finalise a record for a fetch that threw / rejected. We never fabricate
 * an 'aborted' or 'timeout' outcome — callers only pass those when they
 * can prove the browser really aborted or timed out via a pre-existing
 * AbortController path (A02 itself introduces neither).
 */
export function finalizeRejectedRecord(
  record: TelemetryRecord,
  input: RejectedFetchInput,
): TelemetryRecord {
  const started = record.fetchStartedAt ?? input.now;
  return {
    ...record,
    fetchEndedAt: input.now,
    durationMs: Math.max(0, input.now - started),
    fetchOutcome: input.outcome ?? 'rejected_error',
    httpStatus: null,
    responseOk: null,
    responseType: null,
    responseHeadersSubset: {},
    errorName: input.errorName,
    errorMessage: redactErrorMessage(input.errorMessage),
    workerSeen: false,
  };
}

/* ------------------------------------------------------------------ */
/* Ring buffer                                                        */
/* ------------------------------------------------------------------ */

export interface StorageAdapter {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface TelemetryRingBufferOptions {
  max?: number;
  storage?: StorageAdapter;
  storageKey?: string;
}

/**
 * In-memory buffer capped at `max` records. If a StorageAdapter is given
 * the buffer mirrors itself on every mutation — always after redaction,
 * because every record entering `push()` has already been built through
 * the redacting factories above.
 */
export class TelemetryRingBuffer {
  private buffer: TelemetryRecord[] = [];
  private readonly max: number;
  private readonly storage?: StorageAdapter;
  private readonly storageKey: string;

  constructor(options: TelemetryRingBufferOptions = {}) {
    this.max = options.max ?? 10;
    this.storage = options.storage;
    this.storageKey = options.storageKey ?? 'bug401-diag';
    if (this.storage) {
      const raw = this.storage.get(this.storageKey);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            this.buffer = parsed.slice(-this.max);
          }
        } catch {
          // corrupt storage — reset
          this.storage.remove(this.storageKey);
        }
      }
    }
  }

  push(record: TelemetryRecord): void {
    this.buffer.push(record);
    while (this.buffer.length > this.max) this.buffer.shift();
    this.persist();
  }

  /**
   * Replace a record in place (keyed by reference equality on the record
   * instance). Used when finalising a record that was created at submit
   * entry and mutated on fetch resolve/reject.
   */
  replace(previous: TelemetryRecord, next: TelemetryRecord): void {
    const i = this.buffer.indexOf(previous);
    if (i >= 0) this.buffer[i] = next;
    this.persist();
  }

  snapshot(): TelemetryRecord[] {
    return this.buffer.slice();
  }

  clear(): void {
    this.buffer = [];
    if (this.storage) this.storage.remove(this.storageKey);
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.set(this.storageKey, JSON.stringify(this.buffer));
    } catch {
      // storage full or unavailable — in-memory buffer is authoritative
    }
  }
}

/**
 * Compose a multi-record JSON payload suitable for a "Copy diagnostic
 * report" button. Deterministic key order + 2-space indent so users can
 * diff reports.
 */
export function buildDiagnosticReport(records: TelemetryRecord[]): string {
  return JSON.stringify({ records }, null, 2);
}
