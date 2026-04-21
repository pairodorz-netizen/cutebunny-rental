/**
 * BUG401-A02 — framework-free factory that binds the record factories +
 * ring buffer behind a runtime flag. Admin code wires browser side-
 * effects (sessionStorage, navigator) via dependency injection so this
 * module is fully testable under node/vitest.
 */
import {
  TelemetryRingBuffer,
  buildDiagnosticReport,
  buildSubmitEntryRecord,
  finalizeRejectedRecord,
  finalizeResolvedRecord,
  markFetchStarted,
  markSerializationEnded,
  markSerializationStarted,
  type RejectedFetchInput,
  type ResolvedFetchInput,
  type StorageAdapter,
  type SubmitEntryInput,
  type TelemetryRecord,
} from './telemetry';

/**
 * Opaque per-submit handle. Inactive handles are no-ops on every method
 * AND expose `active=false` so callers can early-skip expensive setup
 * when diagnostics are off.
 */
export interface TelemetryHandle {
  readonly active: boolean;
  markSerializationStart(now?: number): void;
  markSerializationEnd(now?: number): void;
  markFetchStart(now?: number): void;
  finalizeResolved(input: Omit<ResolvedFetchInput, 'now'> & { now?: number }): void;
  finalizeRejected(input: Omit<RejectedFetchInput, 'now'> & { now?: number }): void;
}

export interface EnvironmentProbe {
  now(): number;
  navigatorOnline(): boolean;
  connectionEffectiveType(): string | 'unsupported';
  connectionRtt(): number | 'unsupported';
  connectionDownlink(): number | 'unsupported';
}

export interface CreateTelemetryStoreOptions {
  getFlag: () => boolean;
  env: EnvironmentProbe;
  storage?: StorageAdapter;
  storageKey?: string;
  max?: number;
}

export interface StartSubmitInput
  extends Omit<
    SubmitEntryInput,
    'now' | 'navigatorOnline' | 'connectionEffectiveType' | 'connectionRtt' | 'connectionDownlink'
  > {
  now?: number;
}

export interface TelemetryStore {
  readonly active: boolean;
  startCreateProductSubmit(input: StartSubmitInput): TelemetryHandle;
  getReport(): string;
  clear(): void;
  /**
   * Snapshot for tests. Never call from UI code — the public surface is
   * `getReport()` which returns a redacted JSON string.
   */
  __snapshotForTest(): ReadonlyArray<TelemetryRecord>;
}

function inactiveHandle(): TelemetryHandle {
  return {
    active: false,
    markSerializationStart() {},
    markSerializationEnd() {},
    markFetchStart() {},
    finalizeResolved() {},
    finalizeRejected() {},
  };
}

export function createTelemetryStore(opts: CreateTelemetryStoreOptions): TelemetryStore {
  let buffer: TelemetryRingBuffer | null = null;

  function getBuffer(): TelemetryRingBuffer {
    if (!buffer) {
      buffer = new TelemetryRingBuffer({
        max: opts.max ?? 10,
        storage: opts.storage,
        storageKey: opts.storageKey ?? 'bug401-diag',
      });
    }
    return buffer;
  }

  return {
    get active() {
      return opts.getFlag();
    },

    startCreateProductSubmit(input) {
      if (!opts.getFlag()) return inactiveHandle();

      const now = input.now ?? opts.env.now();
      let record = buildSubmitEntryRecord({
        now,
        frontendDeploymentId: input.frontendDeploymentId,
        apiBaseUrl: input.apiBaseUrl,
        requestUrl: input.requestUrl,
        contentType: input.contentType,
        hasAuthorizationHeader: input.hasAuthorizationHeader,
        authTokenPresent: input.authTokenPresent,
        authTokenExpiresAt: input.authTokenExpiresAt,
        navigatorOnline: opts.env.navigatorOnline(),
        connectionEffectiveType: opts.env.connectionEffectiveType(),
        connectionRtt: opts.env.connectionRtt(),
        connectionDownlink: opts.env.connectionDownlink(),
      });
      const buf = getBuffer();
      buf.push(record);
      let finalised = false;

      function replace(next: TelemetryRecord): void {
        const prev = record;
        record = next;
        buf.replace(prev, next);
      }

      return {
        active: true,
        markSerializationStart(t) {
          if (finalised) return;
          replace(markSerializationStarted(record, t ?? opts.env.now()));
        },
        markSerializationEnd(t) {
          if (finalised) return;
          replace(markSerializationEnded(record, t ?? opts.env.now()));
        },
        markFetchStart(t) {
          if (finalised) return;
          replace(markFetchStarted(record, t ?? opts.env.now()));
        },
        finalizeResolved(i) {
          if (finalised) return;
          finalised = true;
          replace(
            finalizeResolvedRecord(record, {
              now: i.now ?? opts.env.now(),
              status: i.status,
              ok: i.ok,
              type: i.type,
              headers: i.headers,
            }),
          );
        },
        finalizeRejected(i) {
          if (finalised) return;
          finalised = true;
          replace(
            finalizeRejectedRecord(record, {
              now: i.now ?? opts.env.now(),
              errorName: i.errorName,
              errorMessage: i.errorMessage,
              outcome: i.outcome,
            }),
          );
        },
      };
    },

    getReport() {
      if (!opts.getFlag()) return buildDiagnosticReport([]);
      return buildDiagnosticReport(getBuffer().snapshot());
    },

    clear() {
      if (buffer) buffer.clear();
    },

    __snapshotForTest() {
      if (!buffer) return [];
      return buffer.snapshot();
    },
  };
}
