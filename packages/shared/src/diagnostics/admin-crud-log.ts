/**
 * BUG-504-RC1-RC2 — structured DELETE/PATCH log envelope.
 *
 * Cloudflare Workers Logs masks path identifiers (the categories
 * REDACTED segment in the user's report). Without an identifier we
 * cannot correlate "the failing DELETE" to "the offending row" from
 * logs alone. Reverse: emitting raw UUIDs leaks PII / makes logs
 * grep-replayable for replay attacks.
 *
 * `buildAdminCrudLogEntry` returns a deterministic, non-reversible
 * 12-hex-char hash of the identifier so:
 *   • Two log lines with the same id collide (correlatable).
 *   • Different ids do not collide.
 *   • The raw identifier never appears in the serialized envelope
 *     (verified by the test in `bug504-rc1-rc2-categories-fk.test.ts`).
 *
 * The hash is FNV-1a 32-bit twice (over the id and over the id +
 * a fixed pepper) concatenated → 12 hex chars. This is fast,
 * dependency-free, runs in the Worker isolate without `crypto.subtle`
 * (which is async and would force this helper to be async too), and
 * is more than enough collision space for the few hundred admin CRUD
 * events per hour we see in production.
 *
 * NOT cryptographic — the goal is observability + redaction, not
 * authentication. The pepper prevents trivial pre-image lookups for
 * known UUIDs but anyone with the source code + a known UUID can
 * reproduce the hash. That tradeoff is documented and accepted.
 */

export type AdminCrudOutcome =
  | 'success'
  | 'not_found'
  | 'in_use_blocked'
  | 'validation_error'
  | 'conflict'
  | 'unauthorized'
  | 'forbidden'
  | 'internal_error';

export interface AdminCrudLogInput {
  route: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  identifier: string | null;
  outcome: AdminCrudOutcome;
  errorCode: string | null;
  /** Optional structured details (must NOT contain PII). */
  details?: Record<string, string | number | boolean | null>;
}

export interface AdminCrudLogEntry {
  route: string;
  method: string;
  identifier_hash: string | null;
  outcome: AdminCrudOutcome;
  error_code: string | null;
  details?: Record<string, string | number | boolean | null>;
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const PEPPER = 'cutebunny:admin:crud:v1';

function fnv1a32(input: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  // Coerce to unsigned 32-bit.
  return hash >>> 0;
}

function toHex(n: number, width: number): string {
  return n.toString(16).padStart(width, '0').slice(0, width);
}

export function hashAdminCrudIdentifier(identifier: string): string {
  const a = fnv1a32(identifier);
  const b = fnv1a32(identifier + ':' + PEPPER);
  return (toHex(a, 6) + toHex(b, 6)).slice(0, 12);
}

export function buildAdminCrudLogEntry(input: AdminCrudLogInput): AdminCrudLogEntry {
  const entry: AdminCrudLogEntry = {
    route: input.route,
    method: input.method,
    identifier_hash: input.identifier ? hashAdminCrudIdentifier(input.identifier) : null,
    outcome: input.outcome,
    error_code: input.errorCode,
  };
  if (input.details) {
    entry.details = input.details;
  }
  return entry;
}
