import { Hono } from 'hono';
import { getDb } from '../lib/db';
import { success } from '../lib/response';
import { getShippingFeeEnabled } from '../lib/shipping';
import { getMessengerConfig } from '../lib/messenger';

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

// GET /api/v1/settings/messenger — public read of messenger delivery config.
// Exposes only the fields the customer UI needs to decide whether to show
// the messenger option and display base pricing info.
settings.get('/messenger', async (c) => {
  const db = getDb();
  const config = await getMessengerConfig(db);
  return success(c, {
    enabled: config.enabled,
    base_fee: config.baseFee,
    max_distance_km: config.maxDistanceKm,
  });
});

export default settings;
