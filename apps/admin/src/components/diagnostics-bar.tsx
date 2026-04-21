import { useEffect, useState } from 'react';
import { API_BASE } from '@/lib/api';
import { buildApiNetworkError, formatApiNetworkError, ApiNetworkError } from '@cutebunny/shared/diagnostics';
import { isDiagBarOn } from '@/lib/diag/flag';
import { getDiagnosticReport } from '@/lib/diag/telemetry-store';
import { installWindowErrorCapture } from '@/lib/diag/window-errors';

type Status = 'idle' | 'checking' | 'ok' | 'failed';

/**
 * BUG401-A02 — the admin shell's diagnostic bar.
 *
 * When DIAG_BAR is off:
 *   The component early-returns `null` BEFORE attaching any listeners,
 *   probing, mounting children, or touching storage. This is the
 *   "fully absent" guarantee (acceptance criterion 1 + 10).
 *
 * When DIAG_BAR is on:
 *   - a small green "✓ diagnostics-loaded" marker is rendered on every
 *     admin page so H5-c (Create Product page never loaded the bar) can
 *     be distinguished from H6 (bar loaded, handler never fired).
 *   - a health probe against `${API_BASE}/health` runs on boot + on the
 *     `online` event. If it fails, a sticky red bar appears on top of
 *     the marker with the usual ApiNetworkError payload.
 *   - a "Copy diagnostic report" button dumps the last 10 redacted
 *     telemetry records as JSON to the clipboard.
 *   - window.onerror + unhandledrejection are captured so uncaught
 *     exceptions on the Create Product page can be correlated with the
 *     telemetry ring buffer.
 */
export function DiagnosticsBar() {
  const flagOn = isDiagBarOn();

  if (!flagOn) {
    // Explicit early-return: no effects, no listeners, no DOM, no storage.
    return null;
  }

  return <DiagnosticsBarInner />;
}

function DiagnosticsBarInner() {
  const [status, setStatus] = useState<Status>('idle');
  const [err, setErr] = useState<ApiNetworkError | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reportCopied, setReportCopied] = useState(false);

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
    const uninstallErrCapture = installWindowErrorCapture();
    return () => {
      window.removeEventListener('online', onOnline);
      uninstallErrCapture();
    };
  }, []);

  async function copyToClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        return document.execCommand('copy');
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  async function handleCopyError() {
    if (!err) return;
    const ok = await copyToClipboard(formatApiNetworkError(err));
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  async function handleCopyReport() {
    const ok = await copyToClipboard(getDiagnosticReport());
    if (ok) {
      setReportCopied(true);
      setTimeout(() => setReportCopied(false), 2000);
    }
  }

  const failedBanner =
    status === 'failed' && err && !dismissed ? (
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
              onClick={handleCopyError}
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
    ) : null;

  return (
    <>
      {failedBanner}
      <div
        data-testid="diagnostics-loaded"
        className="sticky top-0 z-40 flex items-center justify-end gap-2 border-b border-emerald-200 bg-emerald-50/80 px-3 py-1 text-[11px] text-emerald-900"
      >
        <span className="font-mono">✓ diagnostics-loaded</span>
        <button
          type="button"
          onClick={handleCopyReport}
          className="rounded border border-emerald-400 bg-white px-2 py-0.5 text-emerald-900 hover:bg-emerald-100"
          data-testid="diagnostics-copy-report"
        >
          {reportCopied ? 'Copied' : 'Copy diagnostic report'}
        </button>
      </div>
    </>
  );
}
