import { useEffect, useState } from 'react';
import { API_BASE } from '@/lib/api';
import { buildApiNetworkError, formatApiNetworkError, ApiNetworkError } from '@cutebunny/shared/diagnostics';

type Status = 'idle' | 'checking' | 'ok' | 'failed';

/**
 * BUG401-A02 Track A: a thin, always-visible probe that calls the API's
 * `/health` endpoint once on boot and again on reconnect. If the probe fails
 * we surface a dismissable red bar with the full diagnostic payload so the
 * user can report exactly which URL / error / token state / onLine signal is
 * happening in their browser.
 *
 * Intentionally lives outside the main layout (so it also renders on /login)
 * and does NOT require auth to run.
 */
export function DiagnosticsBar() {
  const [status, setStatus] = useState<Status>('idle');
  const [err, setErr] = useState<ApiNetworkError | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);

  async function probe() {
    setStatus('checking');
    const url = `${API_BASE}/health`;
    const startedAt = Date.now();
    try {
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) {
        throw new Error(`Health check returned ${res.status}`);
      }
      setErr(null);
      setStatus('ok');
    } catch (caught) {
      const wrapped = buildApiNetworkError({
        url,
        method: 'GET',
        tokenPresent: false,
        online: typeof navigator !== 'undefined' ? navigator.onLine : true,
        err: caught,
        startedAt,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      });
      setErr(wrapped);
      setStatus('failed');
    }
  }

  useEffect(() => {
    probe();
    const onOnline = () => probe();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  if (status !== 'failed' || !err || dismissed) return null;

  const debugText = formatApiNetworkError(err);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(debugText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fall back: select + copy via hidden textarea
      const ta = document.createElement('textarea');
      ta.value = debugText;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  return (
    <div
      role="alert"
      className="sticky top-0 z-50 border-b border-red-300 bg-red-50 text-red-900 px-4 py-2 text-xs"
      data-testid="diagnostics-bar"
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:gap-4">
        <div className="flex-1 min-w-0">
          <div className="font-medium">
            API unreachable from this browser
            <span className="ml-2 font-normal opacity-80">
              ({err.payload.name}: {err.payload.message})
            </span>
          </div>
          <div className="mt-1 font-mono break-all opacity-80">
            {err.payload.method} {err.payload.url} · online={String(err.payload.online)} · tokenPresent=
            {String(err.payload.tokenPresent)} · elapsed={err.payload.elapsedMs}ms
          </div>
        </div>
        <div className="flex gap-2 mt-2 sm:mt-0 shrink-0">
          <button
            type="button"
            onClick={handleCopy}
            className="rounded border border-red-400 bg-white px-2 py-1 text-red-900 hover:bg-red-100"
          >
            {copied ? 'Copied' : 'Copy debug info'}
          </button>
          <button
            type="button"
            onClick={() => probe()}
            className="rounded border border-red-400 bg-white px-2 py-1 text-red-900 hover:bg-red-100"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
            className="rounded border border-red-400 bg-white px-2 py-1 text-red-900 hover:bg-red-100"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
