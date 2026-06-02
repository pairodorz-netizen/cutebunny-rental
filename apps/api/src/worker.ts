/**
 * Cloudflare Workers entry point.
 *
 * This module is the `main` entry for wrangler. It re-exports the Hono
 * app's `fetch` handler AND adds the `scheduled` cron handler for:
 *   - BUG-505: Order auto-advance (hourly)
 *   - BUG-507: PII retention — mask/delete IPs (daily 03:00 BKK)
 *
 * Tests import from `./index` (the Hono app) directly, so the
 * `scheduled` handler is isolated here to avoid breaking `app.request()`.
 */

import app from './index';
import { setEnv, type Env } from './lib/env';
import { getDb, resetDb } from './lib/db';
import { processOrderAutoAdvance, processPiiRetention } from './scheduled';

// Cloudflare Workers scheduled event types (declared locally to avoid
// polluting the global scope — the full @cloudflare/workers-types
// package overrides Response.json() and breaks existing test type checks).
interface CfScheduledEvent {
  cron: string;
  type: 'scheduled';
  scheduledTime: number;
}
interface CfExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export default {
  fetch: app.fetch,

  async scheduled(
    event: CfScheduledEvent,
    env: Env,
    _ctx: CfExecutionContext,
  ): Promise<void> {
    setEnv(env);
    resetDb();
    const db = getDb();

    // Warmup: keep isolate alive + pre-warm Prisma/Neon connection pool
    if (event.cron === '*/5 * * * *') {
      try {
        await db.$queryRaw`SELECT 1`;
        console.log('[warmup] DB connection OK');
      } catch (err) {
        console.error('[warmup] DB connection failed:', err);
      }
      return;
    }

    // BUG-505: Hourly order auto-advance (0 * * * *)
    if (event.cron === '0 * * * *') {
      try {
        const metrics = await processOrderAutoAdvance(db);
        console.log('[scheduled] completed:', JSON.stringify(metrics));
      } catch (err) {
        console.error('[scheduled] fatal error:', err);
      }
    }

    // BUG-507: Daily PII retention at 20:00 UTC (03:00 Asia/Bangkok)
    if (event.cron === '0 20 * * *') {
      try {
        const metrics = await processPiiRetention(db);
        console.log('[pii_retention] completed:', JSON.stringify(metrics));
        if (metrics.alert) {
          console.error('[pii_retention] ALERT: batch failures exceeded threshold');
        }
      } catch (err) {
        console.error('[pii_retention] fatal error:', err);
      }
    }
  },
};
