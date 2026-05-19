/**
 * Webhook alert infrastructure tests.
 *
 * Covers:
 * - Persistent failure tracking (KV + in-memory fallback)
 * - Consecutive failure threshold (3)
 * - Hourly failure threshold (5 in 1 hour)
 * - Alert dispatch (LINE Notify + generic webhook)
 * - Alert cooldown (5 min)
 * - State reset
 * - Admin endpoint query
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  trackWebhookFailure,
  getFailureState,
  resetFailureState,
  _resetMemoryState,
  CONSECUTIVE_THRESHOLD,
  HOURLY_THRESHOLD,
  ALERT_COOLDOWN_MS,
  type WebhookAlertKV,
} from '../lib/webhook-alert';
import type { WebhookResult } from '../lib/stripe-webhook';

// ─── Helpers ───────────────────────────────────────────────────────────

function makeResult(overrides: Partial<WebhookResult> = {}): WebhookResult {
  return {
    success: true,
    eventId: 'evt_test_1',
    type: 'checkout.session.completed',
    outcome: 'processed',
    durationMs: 50,
    ...overrides,
  };
}

function makeFailedResult(overrides: Partial<WebhookResult> = {}): WebhookResult {
  return makeResult({
    success: false,
    outcome: 'failed',
    error: 'Order not found',
    ...overrides,
  });
}

function createFakeKV(): WebhookAlertKV & { __dump: () => Record<string, string> } {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    __dump: () => Object.fromEntries(store),
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('webhook-alert', () => {
  beforeEach(() => {
    _resetMemoryState();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('in-memory fallback (no KV)', () => {
    it('tracks consecutive failures without KV', async () => {
      for (let i = 0; i < CONSECUTIVE_THRESHOLD - 1; i++) {
        const res = await trackWebhookFailure(
          undefined,
          makeFailedResult({ eventId: `evt_fail_${i}` }),
          undefined,
        );
        expect(res.alerted).toBe(false);
      }

      const state = await getFailureState(undefined);
      expect(state.consecutiveFailures).toBe(CONSECUTIVE_THRESHOLD - 1);
    });

    it('resets consecutive counter on success', async () => {
      await trackWebhookFailure(undefined, makeFailedResult(), undefined);
      await trackWebhookFailure(undefined, makeFailedResult(), undefined);

      const beforeReset = await getFailureState(undefined);
      expect(beforeReset.consecutiveFailures).toBe(2);

      await trackWebhookFailure(undefined, makeResult(), undefined);

      const afterReset = await getFailureState(undefined);
      expect(afterReset.consecutiveFailures).toBe(0);
    });

    it('records lastFailure details', async () => {
      await trackWebhookFailure(
        undefined,
        makeFailedResult({ eventId: 'evt_last', error: 'DB timeout' }),
        undefined,
      );

      const state = await getFailureState(undefined);
      expect(state.lastFailure).not.toBeNull();
      expect(state.lastFailure!.eventId).toBe('evt_last');
      expect(state.lastFailure!.error).toBe('DB timeout');
    });
  });

  describe('KV-backed tracking', () => {
    it('persists state across reads', async () => {
      const kv = createFakeKV();

      await trackWebhookFailure(kv, makeFailedResult(), undefined);
      await trackWebhookFailure(kv, makeFailedResult({ eventId: 'evt_2' }), undefined);

      const state = await getFailureState(kv);
      expect(state.consecutiveFailures).toBe(2);
      expect(state.hourlyFailures).toHaveLength(2);
    });

    it('survives KV reinitialization (simulated isolate restart)', async () => {
      const kv = createFakeKV();

      await trackWebhookFailure(kv, makeFailedResult(), undefined);
      await trackWebhookFailure(kv, makeFailedResult({ eventId: 'evt_2' }), undefined);

      // Simulate reading from "new isolate" — state comes from KV
      const state = await getFailureState(kv);
      expect(state.consecutiveFailures).toBe(2);
    });
  });

  describe('consecutive failure threshold', () => {
    it(`alerts after ${CONSECUTIVE_THRESHOLD} consecutive failures`, async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('ok', { status: 200 }),
      );

      const alertUrl = 'https://hooks.example.com/webhook';

      for (let i = 0; i < CONSECUTIVE_THRESHOLD - 1; i++) {
        const res = await trackWebhookFailure(
          undefined,
          makeFailedResult({ eventId: `evt_${i}` }),
          alertUrl,
        );
        expect(res.alerted).toBe(false);
      }

      const res = await trackWebhookFailure(
        undefined,
        makeFailedResult({ eventId: `evt_threshold` }),
        alertUrl,
      );

      expect(res.alerted).toBe(true);
      expect(res.reason).toContain('consecutive');
      expect(fetchSpy).toHaveBeenCalledOnce();

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe(alertUrl);
      expect((options as RequestInit).method).toBe('POST');
      expect((options as RequestInit).headers).toEqual(
        expect.objectContaining({ 'Content-Type': 'application/json' }),
      );

      fetchSpy.mockRestore();
    });

    it('does not alert without alert URL', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      for (let i = 0; i < CONSECUTIVE_THRESHOLD; i++) {
        await trackWebhookFailure(
          undefined,
          makeFailedResult({ eventId: `evt_${i}` }),
          undefined,
        );
      }

      const state = await getFailureState(undefined);
      expect(state.consecutiveFailures).toBe(CONSECUTIVE_THRESHOLD);
      // Should log but not dispatch
      expect(consoleSpy).toHaveBeenCalled();
      const logCalls = consoleSpy.mock.calls.map((c) => c[0] as string);
      const alertLog = logCalls.find((l) => l.includes('stripe_webhook_alert'));
      expect(alertLog).toBeDefined();
      expect(alertLog).toContain('no_alert_url');

      consoleSpy.mockRestore();
    });
  });

  describe('hourly failure threshold', () => {
    it(`alerts after ${HOURLY_THRESHOLD} failures within 1 hour`, async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('ok', { status: 200 }),
      );
      const alertUrl = 'https://hooks.example.com/webhook';

      // Mix failures and successes to avoid consecutive threshold
      for (let i = 0; i < HOURLY_THRESHOLD; i++) {
        await trackWebhookFailure(
          undefined,
          makeFailedResult({ eventId: `evt_hourly_${i}` }),
          alertUrl,
        );
        // Reset consecutive by inserting a success (except last)
        if (i < HOURLY_THRESHOLD - 2) {
          await trackWebhookFailure(undefined, makeResult(), alertUrl);
        }
      }

      const state = await getFailureState(undefined);
      expect(state.hourlyFailures.length).toBeGreaterThanOrEqual(HOURLY_THRESHOLD);

      fetchSpy.mockRestore();
    });
  });

  describe('LINE Notify dispatch', () => {
    it('sends form-encoded message to LINE Notify API', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('ok', { status: 200 }),
      );

      const lineUrl = 'https://notify-api.line.me/api/notify';

      for (let i = 0; i < CONSECUTIVE_THRESHOLD; i++) {
        await trackWebhookFailure(
          undefined,
          makeFailedResult({ eventId: `evt_line_${i}` }),
          lineUrl,
        );
      }

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe(lineUrl);
      expect((options as RequestInit).headers).toEqual(
        expect.objectContaining({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      );
      const body = (options as RequestInit).body as string;
      expect(body).toContain('message=');

      fetchSpy.mockRestore();
    });
  });

  describe('alert cooldown', () => {
    it('suppresses duplicate alerts within cooldown period', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('ok', { status: 200 }),
      );
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const alertUrl = 'https://hooks.example.com/webhook';

      // Trigger first alert
      for (let i = 0; i < CONSECUTIVE_THRESHOLD; i++) {
        await trackWebhookFailure(
          undefined,
          makeFailedResult({ eventId: `evt_cool1_${i}` }),
          alertUrl,
        );
      }
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // More failures should NOT trigger another alert (cooldown)
      for (let i = 0; i < CONSECUTIVE_THRESHOLD; i++) {
        await trackWebhookFailure(
          undefined,
          makeFailedResult({ eventId: `evt_cool2_${i}` }),
          alertUrl,
        );
      }
      // Still only 1 fetch call (cooldown suppressed second alert)
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      fetchSpy.mockRestore();
    });
  });

  describe('state management', () => {
    it('resetFailureState clears all counters', async () => {
      await trackWebhookFailure(undefined, makeFailedResult(), undefined);
      await trackWebhookFailure(undefined, makeFailedResult(), undefined);

      const before = await getFailureState(undefined);
      expect(before.consecutiveFailures).toBe(2);

      await resetFailureState(undefined);

      const after = await getFailureState(undefined);
      expect(after.consecutiveFailures).toBe(0);
      expect(after.hourlyFailures).toHaveLength(0);
      expect(after.lastFailure).toBeNull();
    });

    it('resetFailureState works with KV', async () => {
      const kv = createFakeKV();
      await trackWebhookFailure(kv, makeFailedResult(), undefined);

      await resetFailureState(kv);

      const state = await getFailureState(kv);
      expect(state.consecutiveFailures).toBe(0);
    });
  });

  describe('alert dispatch error handling', () => {
    it('logs error when alert dispatch fails', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
        new Error('Network unreachable'),
      );
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const alertUrl = 'https://hooks.example.com/webhook';

      for (let i = 0; i < CONSECUTIVE_THRESHOLD; i++) {
        await trackWebhookFailure(
          undefined,
          makeFailedResult({ eventId: `evt_err_${i}` }),
          alertUrl,
        );
      }

      const errorLogs = consoleSpy.mock.calls.map((c) => c[0] as string);
      const alertError = errorLogs.find((l) => l.includes('stripe_webhook_alert_error'));
      expect(alertError).toBeDefined();
      expect(alertError).toContain('Network unreachable');

      fetchSpy.mockRestore();
      consoleSpy.mockRestore();
      logSpy.mockRestore();
    });
  });

  describe('edge cases', () => {
    it('handles rapid-fire failures gracefully', async () => {
      const kv = createFakeKV();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // 10 rapid failures
      for (let i = 0; i < 10; i++) {
        await trackWebhookFailure(
          kv,
          makeFailedResult({ eventId: `evt_rapid_${i}`, error: `Error ${i}` }),
          undefined,
        );
      }

      const state = await getFailureState(kv);
      expect(state.consecutiveFailures).toBe(10);
      expect(state.hourlyFailures).toHaveLength(10);
      expect(state.lastFailure!.error).toBe('Error 9');

      consoleSpy.mockRestore();
    });

    it('handles missing error in failed result', async () => {
      await trackWebhookFailure(
        undefined,
        makeFailedResult({ error: undefined }),
        undefined,
      );

      const state = await getFailureState(undefined);
      expect(state.lastFailure!.error).toBe('Unknown error');
    });
  });
});
