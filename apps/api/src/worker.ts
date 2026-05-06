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

/// <reference types="@cloudflare/workers-types" />

import app from './index';
import { setEnv, type Env } from './lib/env';
import { getDb, resetDb } from './lib/db';
import { processOrderAutoAdvance } from './scheduled';

export default {
  fetch: app.fetch,

  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext,
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
