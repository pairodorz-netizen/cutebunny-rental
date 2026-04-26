/**
 * BUG-COMBO-DELETE-02 — pure classifier for the admin combo-set delete
 * mutation. Keeps the UI layer in `apps/admin/src/pages/products.tsx` thin:
 * the page only has to render the classifier's verdict (toast, rollback,
 * refresh, redirect).
 *
 * Classification policy (owner-ratified):
 *   200                  → success        (refresh, no rollback)
 *   409 ACTIVE_RENTALS   → active_rentals (rollback, no refresh; toast
 *                                          interpolates rentalCount)
 *   other 409            → active_rentals (defence-in-depth: still rollback;
 *                                          count defaults to 1)
 *   404 NOT_FOUND        → not_found      (refresh stale cache, no rollback)
 *   401                  → auth           (rollback + redirect to /login)
 *   TypeError / 5xx / …  → unknown        (rollback, network toast)
 *
 * Pure function; no DOM, fetch, or i18n side effects — toast copy is
 * addressed by i18n key so the caller can translate.
 */

export type ComboDeleteKind =
  | 'success'
  | 'active_rentals'
  | 'not_found'
  | 'auth'
  | 'unknown';

export interface ComboDeleteOutcome {
  kind: ComboDeleteKind;
  toastVariant: 'success' | 'error';
  toastKey: string;
  /** Optional i18n interpolation parameters. Omitted keys imply no params. */
  toastParams?: Record<string, string | number>;
  rollback: boolean;
  refresh: boolean;
  redirect: boolean;
}

interface ComboDeleteInput {
  /** HTTP status if the request reached the server. */
  status?: number;
  /** Parsed JSON body (success envelope or {error:{...}}). */
  body?: unknown;
  /** Thrown error if the request never completed (e.g. fetch failure). */
  error?: unknown;
}

function withDefaults(
  partial: Omit<ComboDeleteOutcome, 'toastVariant'> & {
    toastVariant?: 'success' | 'error';
  },
): ComboDeleteOutcome {
  return {
    toastVariant: partial.toastVariant ?? 'error',
    ...partial,
  };
}

export function classifyComboDeleteResult(
  input: ComboDeleteInput,
): ComboDeleteOutcome {
  if (input.error !== undefined || input.status === undefined) {
    return {
      kind: 'unknown',
      toastVariant: 'error',
      toastKey: 'products.comboDeleteNetwork',
      rollback: true,
      refresh: false,
      redirect: false,
    };
  }

  const { status, body } = input;

  if (status === 200 || status === 201 || status === 204) {
    return {
      kind: 'success',
      toastVariant: 'success',
      toastKey: 'products.comboDeleteSuccess',
      rollback: false,
      refresh: true,
      redirect: false,
    };
  }

  if (status === 409) {
    const count = readRentalCount(body);
    return {
      kind: 'active_rentals',
      toastVariant: 'error',
      toastKey: 'products.comboDeleteActiveRentals',
      toastParams: { count },
      rollback: true,
      refresh: false,
      redirect: false,
    };
  }

  if (status === 404) {
    return {
      kind: 'not_found',
      toastVariant: 'error',
      toastKey: 'products.comboDeleteNotFound',
      rollback: false,
      refresh: true,
      redirect: false,
    };
  }

  if (status === 401 || status === 403) {
    return {
      kind: 'auth',
      toastVariant: 'error',
      toastKey: 'products.comboDeleteAuthLost',
      rollback: true,
      refresh: false,
      redirect: true,
    };
  }

  return withDefaults({
    kind: 'unknown',
    toastKey: 'products.comboDeleteNetwork',
    rollback: true,
    refresh: false,
    redirect: false,
  });
}

function readRentalCount(body: unknown): number {
  if (!body || typeof body !== 'object') return 1;
  const err = (body as { error?: unknown }).error;
  if (!err || typeof err !== 'object') return 1;
  const details = (err as { details?: unknown }).details;
  if (!details || typeof details !== 'object') return 1;
  const n = (details as { rentalCount?: unknown }).rentalCount;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 1;
}
