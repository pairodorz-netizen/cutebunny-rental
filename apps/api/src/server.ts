import { serve } from '@hono/node-server';
import { validateEnv } from './lib/env';
import app from './index';

// Fail fast if required env vars are missing
const env = validateEnv();

console.log(`CuteBunny API starting on http://localhost:${env.PORT} (${env.NODE_ENV})`);

serve({
  fetch: app.fetch,
  port: env.PORT,
});
