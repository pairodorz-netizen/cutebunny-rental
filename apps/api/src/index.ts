// BUG-AUTH: force Worker redeploy to flush the in-memory rate-limit Map.
// Follow-up PR migrates rate-limiter to KV so counters persist across
// isolates and reset paths don't require a full deploy.
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getDb, resetDb } from './lib/db';
import { setEnv, type Env } from './lib/env';
import { requireAuth } from './middleware/auth';
import { cpuTimer } from './middleware/cpu-timer';
import products from './routes/products';
import categories from './routes/categories';
import cart from './routes/cart';
import orders from './routes/orders';
import shipping from './routes/shipping';
import publicSettings from './routes/settings';
import adminAuth from './routes/admin/auth';
import adminDashboard from './routes/admin/dashboard';
import adminOrders from './routes/admin/orders';
import adminProducts from './routes/admin/products';
import adminCalendar from './routes/admin/calendar';
import adminCustomers from './routes/admin/customers';
import adminShipping from './routes/admin/shipping';
import adminFinance from './routes/admin/finance';
import adminImages from './routes/admin/images';
import adminSettings from './routes/admin/settings';
import adminCategories from './routes/admin/categories';
import adminComboSets from './routes/admin/combo-sets';
import customerAuth from './routes/customer-auth';

const app = new Hono<{ Bindings: Env }>();

// Initialize env from Workers bindings on every request
app.use('*', async (c, next) => {
  if (c.env?.DATABASE_URL) {
    setEnv(c.env);
    resetDb();
  }
  await next();
});

app.use('*', cors({
  origin: (origin) => {
    if (!origin) return '*';
    if (origin.endsWith('.vercel.app')) return origin;
    if (origin === 'http://localhost:3000' || origin === 'http://localhost:5173') return origin;
    return null;
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}));

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
app.route('/api/v1/categories', categories);
app.route('/api/v1/cart', cart);
app.route('/api/v1/orders', orders);
app.route('/api/v1/shipping', shipping);
app.route('/api/v1/settings', publicSettings);
app.route('/api/v1/customer/auth', customerAuth);

// ─── Admin APIs (v1) ───────────────────────────────────────────────────
// Auth (public, rate-limited)
app.route('/api/v1/admin/auth', adminAuth);

// CPU-time logging on admin dashboard routes
app.use('/api/v1/admin/dashboard/*', cpuTimer);

// Protected admin routes
app.use('/api/v1/admin/dashboard/*', requireAuth);
app.use('/api/v1/admin/orders/*', requireAuth);
app.use('/api/v1/admin/products/*', requireAuth);
app.use('/api/v1/admin/calendar/*', requireAuth);
app.use('/api/v1/admin/customers/*', requireAuth);
app.use('/api/v1/admin/shipping/*', requireAuth);
app.use('/api/v1/admin/finance/*', requireAuth);
app.use('/api/v1/admin/images/*', requireAuth);
app.use('/api/v1/admin/settings/*', requireAuth);
app.use('/api/v1/admin/categories', requireAuth);
app.use('/api/v1/admin/categories/*', requireAuth);
app.use('/api/v1/admin/combo-sets/*', requireAuth);

app.route('/api/v1/admin/dashboard', adminDashboard);
app.route('/api/v1/admin/orders', adminOrders);
app.route('/api/v1/admin/products', adminProducts);
app.route('/api/v1/admin/calendar', adminCalendar);
app.route('/api/v1/admin/customers', adminCustomers);
app.route('/api/v1/admin/shipping', adminShipping);
app.route('/api/v1/admin/finance', adminFinance);
app.route('/api/v1/admin/images', adminImages);
app.route('/api/v1/admin/settings', adminSettings);
app.route('/api/v1/admin/categories', adminCategories);
app.route('/api/v1/admin/combo-sets', adminComboSets);

export default app;
export type AppType = typeof app;
