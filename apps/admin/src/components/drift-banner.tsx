/**
 * BUG-504-A06.5 DriftBanner — surfaces admin/public category drift.
 *
 * Dismissible per render cycle (component-local state). If the next
 * fetch still reports drift, the banner re-mounts because its parent
 * re-renders with a fresh `report` reference. Dismissal does NOT
 * persist across sessions by design (per owner ack 2026-04-22).
 */
import { useState, useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import type { DriftReport } from '@cutebunny/shared/categories-drift-guard';

interface DriftBannerProps {
  report: DriftReport | undefined;
}

export function DriftBanner({ report }: DriftBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  // Re-arm when a new report arrives (identity-based, so a fresh fetch
  // result pops the banner back even if the underlying drift is the
  // same shape).
  useEffect(() => {
    setDismissed(false);
  }, [report]);

  if (!report || !report.hasDrift || dismissed) return null;

  const missingSlugs = report.missingInAdmin.map((c) => c.slug);
  const mismatchLines = report.labelMismatches;

  return (
    <div
      role="alert"
      data-testid="category-drift-banner"
      className="flex items-start gap-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" aria-hidden="true" />
      <div className="flex-1 space-y-1">
        <p className="font-semibold">Category drift detected</p>
        <p className="text-xs">
          The admin category list ({report.adminCount} slugs) does not match the customer-facing source of truth
          ({report.publicCount} slugs). This usually indicates a stale endpoint, a deploy mismatch, or a
          legacy handler leaking into the admin UI. An audit log entry has been recorded.
        </p>
        {missingSlugs.length > 0 && (
          <p className="text-xs">
            <span className="font-medium">Missing from admin:</span>{' '}
            <code className="font-mono">{missingSlugs.join(', ')}</code>
          </p>
        )}
        {mismatchLines.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-xs">
            {mismatchLines.map((m, i) => (
              <li key={`${m.slug}-${m.field}-${i}`}>
                <code className="font-mono">{m.slug}</code> ({m.field}): admin=
                <code className="font-mono">{JSON.stringify(m.admin)}</code>, public=
                <code className="font-mono">{JSON.stringify(m.public)}</code>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="flex-shrink-0 rounded p-0.5 hover:bg-red-100"
        aria-label="Dismiss drift banner"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
