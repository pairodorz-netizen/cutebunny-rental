import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  ENVIRONMENT: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', cors());

app.get('/', (c) => {
  return c.json({
    name: 'CuteBunny Rental API',
    version: '0.1.0',
    status: 'ok',
  });
});

app.get('/health', (c) => {
  return c.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

export default app;
