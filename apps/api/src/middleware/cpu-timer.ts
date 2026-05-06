import { createMiddleware } from 'hono/factory';

export const cpuTimer = createMiddleware(async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  c.res.headers.set('Server-Timing', `cpu;dur=${ms}`);
  if (ms > 30) {
    console.warn(`[cpu-timer] ${c.req.method} ${c.req.path} took ${ms}ms`);
  }
});
