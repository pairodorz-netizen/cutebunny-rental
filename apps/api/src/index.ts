import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { PrismaClient } from '@prisma/client';

type Bindings = {
  ENVIRONMENT: string;
  DATABASE_URL: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', cors());

app.get('/', (c) => {
  return c.json({
    name: 'CuteBunny Rental API',
    version: '0.2.0',
    status: 'ok',
  });
});

app.get('/health', async (c) => {
  const result: {
    status: string;
    timestamp: string;
    database: string;
    error?: string;
  } = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    database: 'disconnected',
  };

  try {
    const prisma = new PrismaClient({
      datasourceUrl: c.env.DATABASE_URL,
    });
    await prisma.$queryRaw`SELECT 1`;
    result.database = 'connected';
    await prisma.$disconnect();
  } catch (err) {
    result.status = 'degraded';
    result.database = 'error';
    result.error = err instanceof Error ? err.message : 'Unknown DB error';
  }

  return c.json(result);
});

export default app;
