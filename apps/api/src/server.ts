import { serve } from '@hono/node-server';
import { validateEnv } from './lib/env';
import app from './index';

// Fail fast if required env vars are missing
const env = validateEnv();

// Server startup info (console.info is intentional for ops visibility, not debug logging)
console.info(`CuteBunny API starting on port ${env.PORT} (${env.NODE_ENV})`);

serve({
  fetch: app.fetch,
  port: env.PORT,
});
