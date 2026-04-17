import type { Context } from 'hono';

interface EnvelopeSuccess<T> {
  data: T;
  meta?: Record<string, unknown>;
}

interface EnvelopeError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

type Envelope<T> = EnvelopeSuccess<T> | EnvelopeError;

export function success<T>(c: Context, data: T, meta?: Record<string, unknown>, status: 200 | 201 = 200) {
  const body: Envelope<T> = { data };
  if (meta) body.meta = meta;
  return c.json(body, status);
}

export function created<T>(c: Context, data: T, meta?: Record<string, unknown>) {
  return success(c, data, meta, 201);
}

export function error(c: Context, status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500, code: string, message: string, details?: unknown) {
  const body: EnvelopeError = {
    error: { code, message },
  };
  if (details !== undefined) body.error.details = details;
  return c.json(body, status);
}
