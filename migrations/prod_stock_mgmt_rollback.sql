-- ============================================================
-- Stock Management Feature — ROLLBACK
-- Reverses Migrations 005 → 004 → 003 in reverse order
-- Idempotent: safe to run multiple times
-- ============================================================
BEGIN;

-- ─── Rollback 005: Remove orphaned column ──────────────────────
ALTER TABLE combo_sets DROP COLUMN IF EXISTS orphaned;

-- ─── Rollback 004: Remove pagination index ─────────────────────
DROP INDEX IF EXISTS stock_log_product_date;

-- ─── Rollback 003c: Remove stock logs table + enum ─────────────
DROP TABLE IF EXISTS product_stock_logs;
DO $$ BEGIN
  DROP TYPE IF EXISTS "StockLogType";
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ─── Rollback 003b: Remove audit_logs table ────────────────────
DROP TABLE IF EXISTS audit_logs;

-- ─── Rollback 003a: Remove stock columns from products ─────────
ALTER TABLE products DROP COLUMN IF EXISTS low_stock_threshold;
ALTER TABLE products DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE products DROP COLUMN IF EXISTS stock_on_hand;

COMMIT;
