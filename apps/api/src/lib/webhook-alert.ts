/**
 * Persistent webhook failure tracking + alert dispatch.
 *
 * Uses Cloudflare KV for durable failure counters that survive
 * isolate restarts and Worker redeploys. Falls back to in-memory
 * tracking when no KV namespace is bound (local dev, tests).
 *
 * Alert thresholds:
 *   - 3 consecutive failures
 *   - 5 failures within 1 hour (sliding window)
 *
 * Alert dispatch: POST to WEBHOOK_ALERT_URL (LINE Notify or generic webhook).
 */

import type { WebhookResult } from './stripe-webhook';

// ─── KV Interface ──────────────────────────────────────────────────────

export interface WebhookAlertKV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

// ─── Failure State ─────────────────────────────────────────────────────

export interface FailureState {
  consecutiveFailures: number;
  hourlyFailures: Array<{ timestamp: number; eventId: string; error: string }>;
  lastFailure: { timestamp: number; eventId: string; error: string } | null;
  lastAlertSentAt: number | null;
}

const KV_KEY_FAILURE_STATE = 'webhook:failure_state';
const CONSECUTIVE_THRESHOLD = 3;
const HOURLY_THRESHOLD = 5;
const HOUR_MS = 60 * 60 * 1000;
const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 min between alerts
const KV_TTL_SECONDS = 24 * 60 * 60; // 24h TTL for failure state

// In-memory fallback when KV is not bound
let memoryState: FailureState = createEmptyState();

function createEmptyState(): FailureState {
  return {
    consecutiveFailures: 0,
    hourlyFailures: [],
    lastFailure: null,
    lastAlertSentAt: null,
  };
}

// ─── State Persistence ─────────────────────────────────────────────────

async function readState(kv: WebhookAlertKV | undefined): Promise<FailureState> {
  if (!kv) return memoryState;
  const raw = await kv.get(KV_KEY_FAILURE_STATE);
  if (!raw) return createEmptyState();
  try {
    return JSON.parse(raw) as FailureState;
  } catch {
    return createEmptyState();
  }
}

async function writeState(
  kv: WebhookAlertKV | undefined,
  state: FailureState,
): Promise<void> {
  if (!kv) {
    memoryState = state;
    return;
  }
  await kv.put(KV_KEY_FAILURE_STATE, JSON.stringify(state), {
    expirationTtl: KV_TTL_SECONDS,
  });
}

// ─── Core Tracking ─────────────────────────────────────────────────────

export async function trackWebhookFailure(
  kv: WebhookAlertKV | undefined,
  result: WebhookResult,
  alertUrl: string | undefined,
): Promise<{ alerted: boolean; reason?: string }> {
  const state = await readState(kv);
  const now = Date.now();

  if (result.success) {
    // Reset consecutive counter on success, keep hourly for monitoring
    state.consecutiveFailures = 0;
    await writeState(kv, state);
    return { alerted: false };
  }

  // Record failure
  state.consecutiveFailures++;
  const failEntry = {
    timestamp: now,
    eventId: result.eventId,
    error: result.error ?? 'Unknown error',
  };
  state.lastFailure = failEntry;
  state.hourlyFailures.push(failEntry);

  // Prune entries older than 1 hour
  state.hourlyFailures = state.hourlyFailures.filter(
    (f) => now - f.timestamp < HOUR_MS,
  );

  // Check thresholds
  let alertReason: string | undefined;

  if (state.consecutiveFailures >= CONSECUTIVE_THRESHOLD) {
    alertReason = `${state.consecutiveFailures} consecutive webhook failures`;
  } else if (state.hourlyFailures.length >= HOURLY_THRESHOLD) {
    alertReason = `${state.hourlyFailures.length} webhook failures in the last hour`;
  }

  await writeState(kv, state);

  // Dispatch alert if threshold met and cooldown elapsed
  if (alertReason) {
    const cooldownOk =
      !state.lastAlertSentAt || now - state.lastAlertSentAt >= ALERT_COOLDOWN_MS;

    if (cooldownOk && alertUrl) {
      await dispatchAlert(alertUrl, alertReason, state);
      state.lastAlertSentAt = now;
      await writeState(kv, state);
      return { alerted: true, reason: alertReason };
    }

    // Log even if alert suppressed by cooldown or missing URL
    console.error(
      JSON.stringify({
        type: 'stripe_webhook_alert',
        alert: alertReason,
        consecutiveFailures: state.consecutiveFailures,
        hourlyFailures: state.hourlyFailures.length,
        lastEventId: result.eventId,
        lastError: result.error,
        alertDispatched: false,
        reason: !alertUrl ? 'no_alert_url' : 'cooldown',
      }),
    );

    return { alerted: false, reason: alertReason };
  }

  return { alerted: false };
}

// ─── Alert Dispatch ────────────────────────────────────────────────────

async function dispatchAlert(
  alertUrl: string,
  reason: string,
  state: FailureState,
): Promise<void> {
  const payload = {
    text: `⚠️ CuteBunny Webhook Alert\n\n${reason}\n\nLast error: ${state.lastFailure?.error ?? 'N/A'}\nLast event: ${state.lastFailure?.eventId ?? 'N/A'}\nHourly failures: ${state.hourlyFailures.length}\nConsecutive: ${state.consecutiveFailures}`,
  };

  try {
    // LINE Notify uses form-encoded 'message' param
    const isLineNotify = alertUrl.includes('notify-api.line.me');

    if (isLineNotify) {
      const body = new URLSearchParams();
      body.set('message', payload.text);
      await fetch(alertUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } else {
      // Generic webhook (Slack, Discord, custom)
      await fetch(alertUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    console.log(
      JSON.stringify({
        type: 'stripe_webhook_alert',
        alert: reason,
        alertDispatched: true,
        alertUrl: alertUrl.replace(/\/[^/]{8,}$/, '/***'),
      }),
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'stripe_webhook_alert_error',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

// ─── Query State (for admin endpoint) ──────────────────────────────────

export async function getFailureState(
  kv: WebhookAlertKV | undefined,
): Promise<FailureState> {
  return readState(kv);
}

export async function resetFailureState(
  kv: WebhookAlertKV | undefined,
): Promise<void> {
  await writeState(kv, createEmptyState());
}

// ─── Test helpers ──────────────────────────────────────────────────────

export function _resetMemoryState(): void {
  memoryState = createEmptyState();
}

export {
  CONSECUTIVE_THRESHOLD,
  HOURLY_THRESHOLD,
  ALERT_COOLDOWN_MS,
};
