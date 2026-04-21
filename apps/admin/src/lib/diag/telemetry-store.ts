/**
 * BUG401-A02 — admin-side wiring of the shared telemetry factory.
 *
 * - flag reader: `isDiagBarOn()` (URL → sessionStorage → VITE_DIAG_BAR)
 * - storage:    sessionStorage (never localStorage)
 * - env probe:  Date.now + navigator + NetworkInformation
 *
 * The store itself (ring buffer, redaction, record factories, flag-off
 * absence) is framework-free and fully unit-tested in `apps/api/src/
 * __tests__/telemetry-store.test.ts`.
 */
import {
  createTelemetryStore,
  type EnvironmentProbe,
  type StorageAdapter,
  type TelemetryHandle,
  type TelemetryStore,
} from '@cutebunny/shared/diagnostics';
import { isDiagBarOn } from './flag';

const STORAGE_KEY = 'bug401-diag';

function createSessionStorageAdapter(): StorageAdapter | undefined {
  try {
    if (typeof sessionStorage === 'undefined') return undefined;
    return {
      get: (k) => sessionStorage.getItem(k),
      set: (k, v) => sessionStorage.setItem(k, v),
      remove: (k) => sessionStorage.removeItem(k),
    };
  } catch {
    return undefined;
  }
}

const browserEnv: EnvironmentProbe = {
  now: () => Date.now(),
  navigatorOnline: () => (typeof navigator !== 'undefined' ? navigator.onLine : true),
  connectionEffectiveType: () => {
    try {
      const c = (navigator as unknown as { connection?: { effectiveType?: string } }).connection;
      return typeof c?.effectiveType === 'string' ? c.effectiveType : 'unsupported';
    } catch {
      return 'unsupported';
    }
  },
  connectionRtt: () => {
    try {
      const c = (navigator as unknown as { connection?: { rtt?: number } }).connection;
      return typeof c?.rtt === 'number' ? c.rtt : 'unsupported';
    } catch {
      return 'unsupported';
    }
  },
  connectionDownlink: () => {
    try {
      const c = (navigator as unknown as { connection?: { downlink?: number } }).connection;
      return typeof c?.downlink === 'number' ? c.downlink : 'unsupported';
    } catch {
      return 'unsupported';
    }
  },
};

let store: TelemetryStore | null = null;
function getStore(): TelemetryStore {
  if (!store) {
    store = createTelemetryStore({
      getFlag: isDiagBarOn,
      env: browserEnv,
      storage: createSessionStorageAdapter(),
      storageKey: STORAGE_KEY,
      max: 10,
    });
  }
  return store;
}

export type { TelemetryHandle };

export function startCreateProductSubmit(
  input: Parameters<TelemetryStore['startCreateProductSubmit']>[0],
): TelemetryHandle {
  return getStore().startCreateProductSubmit(input);
}

export function getDiagnosticReport(): string {
  return getStore().getReport();
}

export function clearDiagnosticBuffer(): void {
  getStore().clear();
}

export function __resetDiagnosticBufferForTest(): void {
  store = null;
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
