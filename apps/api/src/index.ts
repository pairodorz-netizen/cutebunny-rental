import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getDb } from './lib/db';
import { requireAuth } from './middleware/auth';
import products from './routes/products';
import cart from './routes/cart';
import orders from './routes/orders';
import shipping from './routes/shipping';
import adminAuth from './routes/admin/auth';
import adminDashboard from './routes/admin/dashboard';
import adminOrders from './routes/admin/orders';
import adminProducts from './routes/admin/products';
import adminCalendar from './routes/admin/calendar';
import adminCustomers from './routes/admin/customers';
import adminShipping from './routes/admin/shipping';
import adminFinance from './routes/admin/finance';

const app = new Hono();

app.use('*', cors());

// ─── Public routes ─────────────────────────────────────────────────────
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
    const db = getDb();
    await db.$queryRaw`SELECT 1`;
    result.database = 'connected';
  } catch (err) {
    result.status = 'degraded';
    result.database = 'error';
    result.error = err instanceof Error ? err.message : 'Unknown DB error';
  }

  return c.json(result);
});

// ─── Customer Storefront APIs (v1) ─────────────────────────────────────
app.route('/api/v1/products', products);
app.route('/api/v1/cart', cart);
app.route('/api/v1/orders', orders);
app.route('/api/v1/shipping', shipping);

// ─── Admin APIs (v1) ───────────────────────────────────────────────────
// Auth (public, rate-limited)
app.route('/api/v1/admin/auth', adminAuth);

// Protected admin routes
app.use('/api/v1/admin/dashboard/*', requireAuth);
app.use('/api/v1/admin/orders/*', requireAuth);
app.use('/api/v1/admin/products/*', requireAuth);
app.use('/api/v1/admin/calendar/*', requireAuth);
app.use('/api/v1/admin/customers/*', requireAuth);
app.use('/api/v1/admin/shipping/*', requireAuth);
app.use('/api/v1/admin/finance/*', requireAuth);

app.route('/api/v1/admin/dashboard', adminDashboard);
app.route('/api/v1/admin/orders', adminOrders);
app.route('/api/v1/admin/products', adminProducts);
app.route('/api/v1/admin/calendar', adminCalendar);
app.route('/api/v1/admin/customers', adminCustomers);
app.route('/api/v1/admin/shipping', adminShipping);
app.route('/api/v1/admin/finance', adminFinance);

export default app;
export type AppType = typeof app;
