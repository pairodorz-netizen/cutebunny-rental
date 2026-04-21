/**
 * BUG401-A02 — runtime feature flag for the DiagnosticsBar + telemetry
 * pipeline. Precedence (highest wins):
 *
 *   1. URL query ?diag=on | ?diag=off        (instant, session-scoped)
 *   2. sessionStorage 'DIAG_BAR'              (survives in-tab navigations)
 *   3. import.meta.env.VITE_DIAG_BAR === 'on' (build-time default)
 *
 * Why this shape:
 *   - Rollback via (1) or (2) is instant and does NOT require a redeploy.
 *   - Rollback via (3) requires flipping the Vercel env var AND redeploying
 *     the admin app — a fact the PR description calls out explicitly.
 *
 * Intentional non-goals:
 *   - This flag does NOT persist across tab close (sessionStorage only).
 *   - This flag is NOT tied to user identity; it is a per-browser toggle.
 */

const SS_KEY = 'DIAG_BAR';

function readSessionStorageFlag(): 'on' | 'off' | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const v = sessionStorage.getItem(SS_KEY);
    if (v === 'on' || v === 'off') return v;
    return null;
  } catch {
    return null;
  }
}

function readUrlFlag(): 'on' | 'off' | null {
  try {
    if (typeof window === 'undefined' || !window.location) return null;
    const qs = new URLSearchParams(window.location.search);
    const v = qs.get('diag');
    if (v === 'on' || v === 'off') return v;
    return null;
  } catch {
    return null;
  }
}

function readEnvFlag(): boolean {
  try {
    return import.meta.env?.VITE_DIAG_BAR === 'on';
  } catch {
    return false;
  }
}

/**
 * True when DiagnosticsBar + telemetry pipeline must be active.
 * When false, everything A02 added must be fully absent (no DOM, no
 * listeners, no storage writes, no wrappers attached).
 */
export function isDiagBarOn(): boolean {
  // URL param takes precedence AND persists the decision so that a page
  // reload without the param still honours the last explicit choice.
  const fromUrl = readUrlFlag();
  if (fromUrl !== null) {
    try {
      if (typeof sessionStorage !== 'undefined') {
        if (fromUrl === 'on') sessionStorage.setItem(SS_KEY, 'on');
        else sessionStorage.removeItem(SS_KEY);
      }
    } catch {
      // storage unavailable — proceed with URL decision in-memory only
    }
    return fromUrl === 'on';
  }
  const fromSession = readSessionStorageFlag();
  if (fromSession !== null) return fromSession === 'on';
  return readEnvFlag();
}

/**
 * Test-only override to force a flag value. Exposed so future integration
 * tests can assert flag-off absence without mocking the environment.
 */
export function __setDiagBarFlagForTest(value: 'on' | 'off' | null): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (value === null) sessionStorage.removeItem(SS_KEY);
    else sessionStorage.setItem(SS_KEY, value);
  } catch {
    // ignore
  }
}
