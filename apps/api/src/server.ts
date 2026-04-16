import { serve } from '@hono/node-server';
import app from './index';

const port = parseInt(process.env.PORT ?? '3001', 10);

console.log(`CuteBunny API starting on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
