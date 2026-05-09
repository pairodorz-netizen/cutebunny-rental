-- FEAT-510: Add size column to product_stock_logs for multi-size stock entry
-- Safe: nullable TEXT column, no data modification, no USING clause needed

ALTER TABLE "product_stock_logs"
ADD COLUMN IF NOT EXISTS "size" TEXT;

-- Index for querying stock by size
CREATE INDEX IF NOT EXISTS "stock_log_product_size"
ON "product_stock_logs" ("product_id", "size");
