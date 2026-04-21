/**
 * Pure helpers for wrapping admin-client `fetch` transport failures into a
 * structured error that carries enough context for a "Copy debug info" banner
 * and for disambiguating root causes of opaque "Failed to fetch" reports.
 *
 * Intentionally framework-free and browser-free: the caller passes any
 * browser-side values (navigator.onLine, token presence) in so the function
 * itself is testable under node/vitest without jsdom.
 */

export interface ApiNetworkErrorPayload {
  url: string;
  method: string;
  tokenPresent: boolean;
  online: boolean;
  message: string;
  name: string;
  elapsedMs: number;
  startedAt: string;
  userAgent?: string;
}

export class ApiNetworkError extends Error {
  readonly payload: ApiNetworkErrorPayload;
  constructor(payload: ApiNetworkErrorPayload) {
    super(payload.message);
    this.name = 'ApiNetworkError';
    this.payload = payload;
  }
}

export interface BuildApiNetworkErrorInput {
  url: string;
  method: string;
  tokenPresent: boolean;
  online: boolean;
  err: unknown;
  startedAt: number;
  now?: number;
  userAgent?: string;
}

/**
 * Build an ApiNetworkError payload from a caught fetch failure. Safe to call
 * with any `unknown` thrown value — falls back to best-effort string fields.
 */
export function buildApiNetworkError(input: BuildApiNetworkErrorInput): ApiNetworkError {
  const now = input.now ?? Date.now();
  const elapsedMs = Math.max(0, now - input.startedAt);
  const errObj = input.err instanceof Error ? input.err : null;
  const message = errObj?.message ?? (typeof input.err === 'string' ? input.err : 'Unknown network error');
  const name = errObj?.name ?? 'Error';
  return new ApiNetworkError({
    url: input.url,
    method: input.method.toUpperCase(),
    tokenPresent: input.tokenPresent,
    online: input.online,
    message,
    name,
    elapsedMs,
    startedAt: new Date(input.startedAt).toISOString(),
    userAgent: input.userAgent,
  });
}

/**
 * Human-readable multi-line debug dump suitable for a "Copy debug info" button.
 * Stable ordering so users can diff across repros.
 */
export function formatApiNetworkError(err: ApiNetworkError): string {
  const p = err.payload;
  const lines = [
    `BUG401 debug info`,
    `startedAt:    ${p.startedAt}`,
    `elapsedMs:    ${p.elapsedMs}`,
    `method:       ${p.method}`,
    `url:          ${p.url}`,
    `tokenPresent: ${p.tokenPresent}`,
    `online:       ${p.online}`,
    `errorName:    ${p.name}`,
    `errorMessage: ${p.message}`,
  ];
  if (p.userAgent) lines.push(`userAgent:    ${p.userAgent}`);
  return lines.join('\n');
}
