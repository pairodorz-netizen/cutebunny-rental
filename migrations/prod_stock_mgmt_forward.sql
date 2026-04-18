-- ============================================================
-- Stock Management Feature — Production Forward Migration
-- Migrations 003 + 004 + 005 (Waves 1 & 2)
-- Idempotent: safe to run multiple times
-- ============================================================
BEGIN;

-- ─── Migration 003a: Stock columns on products ─────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_on_hand INT DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_threshold INT DEFAULT 5;

-- Backfill: ensure all products have threshold = 5
UPDATE products SET low_stock_threshold = 5
  WHERE low_stock_threshold IS NULL OR low_stock_threshold = 1;

-- ─── Migration 003b: Audit log table ───────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  admin_id UUID NOT NULL REFERENCES admin_users(id),
  action TEXT NOT NULL,
  resource TEXT,
  resource_id TEXT,
  details JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── Migration 003c: StockLogType enum + product_stock_logs ────
DO $$ BEGIN
  CREATE TYPE "StockLogType" AS ENUM (
    'purchase', 'adjust', 'loss', 'return_stock', 'rental_out', 'rental_in'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS product_stock_logs (
  id UUID NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type "StockLogType" NOT NULL,
  quantity INT NOT NULL,
  unit_cost INT DEFAULT 0,
  total_cost INT DEFAULT 0,
  note TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── Migration 004: Index for cursor pagination ────────────────
CREATE INDEX IF NOT EXISTS stock_log_product_date
  ON product_stock_logs (product_id, created_at DESC);

-- ─── Migration 005: Combo-set orphaned flag ────────────────────
ALTER TABLE combo_sets ADD COLUMN IF NOT EXISTS orphaned BOOLEAN DEFAULT false;

COMMIT;
