-- Messenger Delivery feature: add DeliveryMethod enum, new columns on orders,
-- and seed system_configs for messenger pricing/toggle.

-- ─── DeliveryMethod enum ────────────────────────────────────────────────────
CREATE TYPE "DeliveryMethod" AS ENUM ('standard', 'messenger');

-- ─── New columns on orders ──────────────────────────────────────────────────
ALTER TABLE "orders"
  ADD COLUMN "delivery_method" "DeliveryMethod" NOT NULL DEFAULT 'standard',
  ADD COLUMN "return_method"   "DeliveryMethod" NOT NULL DEFAULT 'standard',
  ADD COLUMN "messenger_fee_send"     INT NOT NULL DEFAULT 0,
  ADD COLUMN "messenger_fee_return"   INT NOT NULL DEFAULT 0,
  ADD COLUMN "messenger_distance_km"  DOUBLE PRECISION,
  ADD COLUMN "messenger_payment_mode" TEXT;

-- ─── Seed messenger system_configs (idempotent) ─────────────────────────────
INSERT INTO "system_configs" (id, key, value, label, "group")
VALUES
  (uuid_generate_v4(), 'messenger_enabled',          '"false"', 'Enable Messenger Delivery',   'shipping'),
  (uuid_generate_v4(), 'messenger_base_fee',          '"100"',  'Messenger Base Fee (THB)',     'shipping'),
  (uuid_generate_v4(), 'messenger_per_km_fee',        '"15"',   'Messenger Per-km Fee (THB)',   'shipping'),
  (uuid_generate_v4(), 'messenger_base_distance_km',  '"5"',    'Messenger Base Distance (km)', 'shipping'),
  (uuid_generate_v4(), 'messenger_max_distance_km',   '"50"',   'Messenger Max Distance (km)',  'shipping'),
  (uuid_generate_v4(), 'shop_origin_lat',             '"0"',    'Shop Origin Latitude',         'shipping'),
  (uuid_generate_v4(), 'shop_origin_lng',             '"0"',    'Shop Origin Longitude',        'shipping')
ON CONFLICT (key) DO NOTHING;
