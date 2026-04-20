import { Hono } from 'hono';
import { getDb } from '../lib/db';
import { success } from '../lib/response';
import { getShippingFeeEnabled } from '../lib/shipping';

// Public settings endpoints consumed by the customer-facing app.
// Mounted at /api/v1/settings.
const settings = new Hono();

// GET /api/v1/settings/shipping/fee-toggle — returns the global
// shipping fee toggle so the customer checkout can render free-shipping UI.
// Public (no auth): only the single boolean is exposed — no other admin
// settings are leaked here.
settings.get('/shipping/fee-toggle', async (c) => {
  const db = getDb();
  const enabled = await getShippingFeeEnabled(db);
  return success(c, { enabled });
});

export default settings;
