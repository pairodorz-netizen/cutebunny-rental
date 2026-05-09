-- FEAT-510: Add size column to product_stock_logs for multi-size stock entry
-- Safe: nullable TEXT column, no data modification, no USING clause needed

ALTER TABLE "product_stock_logs"
ADD COLUMN IF NOT EXISTS "size" TEXT;

-- Gemini QC Fix 2: CREATE INDEX CONCURRENTLY to avoid table lock on large prod tables
-- CONCURRENTLY cannot run inside a transaction block, so this migration must be
-- run outside of a transaction (Prisma: set `-- Disable Transaction` or run manually).
-- IF NOT EXISTS ensures idempotency if the index already exists from a prior partial run.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "stock_log_product_size"
ON "product_stock_logs" ("product_id", "size");
