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

// GET /api/v1/settings/rental-terms — returns the editable rental terms
// text for the customer checkout page. No auth required.
// BUG-503: accepts ?locale=th|en|zh to return per-locale terms.
// Looks up rental_terms_{locale} first, falls back to rental_terms (Thai).
settings.get('/rental-terms', async (c) => {
  const db = getDb();
  const locale = (c.req.query('locale') || 'th').toLowerCase();
  const SUPPORTED_LOCALES = ['th', 'en', 'zh'];
  const effectiveLocale = SUPPORTED_LOCALES.includes(locale) ? locale : 'th';

  // Try locale-specific key first (e.g. rental_terms_en), fall back to rental_terms
  const localeKey = effectiveLocale === 'th' ? 'rental_terms' : `rental_terms_${effectiveLocale}`;
  let row = await db.systemConfig.findUnique({ where: { key: localeKey } });
  if (!row && localeKey !== 'rental_terms') {
    row = await db.systemConfig.findUnique({ where: { key: 'rental_terms' } });
  }

  let terms = '';
  if (row?.value) {
    const raw = row.value;
    if (typeof raw === 'string') {
      try { terms = JSON.parse(raw); } catch { terms = raw; }
    } else {
      terms = String(raw);
    }
  }
  return success(c, { rental_terms: terms });
});

// GET /api/v1/settings/storefront — returns the storefront URL from
// system_configs. Falls back to the hardcoded Vercel deployment URL when
// the config row hasn't been seeded yet.
const FALLBACK_STOREFRONT_URL = 'https://customer-eta-ruby.vercel.app';

settings.get('/storefront', async (c) => {
  const db = getDb();
  const row = await db.systemConfig.findUnique({ where: { key: 'storefront_url' } });
  const raw = row?.value;
  // value is stored as a JSON string (e.g. `"https://..."`) — unwrap it.
  let url = FALLBACK_STOREFRONT_URL;
  if (typeof raw === 'string') {
    try { url = JSON.parse(raw); } catch { url = raw; }
  }
  return success(c, { storefront_url: url });
});

export default settings;
