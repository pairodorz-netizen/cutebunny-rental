/**
 * BUG401-A02 — capture uncaught window errors and unhandled promise
 * rejections so that H6 (handler fired but threw before reaching fetch)
 * can be distinguished from H5-c (handler never fired at all).
 *
 * Constraints:
 *   - fully absent when flag is off: no listener is registered at all.
 *   - redact message + url: never persist an uploaded filename or a full
 *     URL-with-query into the ring buffer via a window-error.
 */
import { redactErrorMessage, redactUrl } from '@cutebunny/shared/diagnostics';
import { isDiagBarOn } from './flag';

export interface CapturedWindowError {
  kind: 'error' | 'unhandledrejection';
  name: string;
  message: string | null;
  sourceOrigin: string;
  sourcePath: string;
  at: string;
}

type Listener = (event: CapturedWindowError) => void;

const listeners = new Set<Listener>();
let installed = false;
let onError: ((event: ErrorEvent) => void) | null = null;
let onRejection: ((event: PromiseRejectionEvent) => void) | null = null;

function emit(captured: CapturedWindowError): void {
  for (const l of Array.from(listeners)) {
    try {
      l(captured);
    } catch {
      // swallow; one bad listener should not kill the others
    }
  }
}

export function subscribeWindowErrors(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Install window.onerror + unhandledrejection capture if — and only if —
 * the flag is on. Returns an uninstall function. Idempotent: a second
 * call while already installed is a no-op.
 */
export function installWindowErrorCapture(): () => void {
  if (!isDiagBarOn()) return () => {};
  if (installed) return uninstallWindowErrorCapture;
  if (typeof window === 'undefined') return () => {};

  onError = (e: ErrorEvent) => {
    const source = typeof e.filename === 'string' ? e.filename : '';
    const red = redactUrl(source);
    emit({
      kind: 'error',
      name: e.error?.name ?? 'Error',
      message: redactErrorMessage(e.message ?? null),
      sourceOrigin: red.origin,
      sourcePath: red.path,
      at: new Date().toISOString(),
    });
  };

  onRejection = (e: PromiseRejectionEvent) => {
    let name = 'UnhandledRejection';
    let message: string | null = null;
    const reason = e.reason;
    if (reason instanceof Error) {
      name = reason.name;
      message = reason.message;
    } else if (typeof reason === 'string') {
      message = reason;
    } else if (reason && typeof reason === 'object') {
      const maybe = reason as { name?: unknown; message?: unknown };
      if (typeof maybe.name === 'string') name = maybe.name;
      if (typeof maybe.message === 'string') message = maybe.message;
    }
    emit({
      kind: 'unhandledrejection',
      name,
      message: redactErrorMessage(message),
      sourceOrigin: '',
      sourcePath: '',
      at: new Date().toISOString(),
    });
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  installed = true;
  return uninstallWindowErrorCapture;
}

export function uninstallWindowErrorCapture(): void {
  if (!installed) return;
  if (typeof window === 'undefined') return;
  if (onError) window.removeEventListener('error', onError);
  if (onRejection) window.removeEventListener('unhandledrejection', onRejection);
  onError = null;
  onRejection = null;
  installed = false;
}

export function __isWindowErrorCaptureInstalledForTest(): boolean {
  return installed;
}
