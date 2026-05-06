/**
 * BUG-505 — Cloudflare Workers entry point.
 *
 * This module is the `main` entry for wrangler. It re-exports the Hono
 * app's `fetch` handler AND adds the `scheduled` cron handler for
 * order auto-advance.
 *
 * Tests import from `./index` (the Hono app) directly, so the
 * `scheduled` handler is isolated here to avoid breaking `app.request()`.
 */

import app from './index';
import { setEnv, type Env } from './lib/env';
import { getDb, resetDb } from './lib/db';
import { processOrderAutoAdvance } from './scheduled';

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
    _event: CfScheduledEvent,
    env: Env,
    _ctx: CfExecutionContext,
  ): Promise<void> {
    setEnv(env);
    resetDb();
    const db = getDb();
    try {
      const metrics = await processOrderAutoAdvance(db);
      console.log('[scheduled] completed:', JSON.stringify(metrics));
    } catch (err) {
      console.error('[scheduled] fatal error:', err);
    }
  },
};
