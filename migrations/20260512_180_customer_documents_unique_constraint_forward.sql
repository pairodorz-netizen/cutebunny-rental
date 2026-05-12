-- HOTFIX: BUG-519 — Add UNIQUE constraint on customer_documents(customer_id, doc_type)
-- Prevents duplicate document uploads per customer per document type.
-- Prerequisites: None (standalone, idempotent)
-- Run in: Supabase SQL Editor (prod)
-- DO NOT run inside a transaction if using pg < 12 (constraint creation is DDL-safe).

BEGIN;

SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '2s';

-- Step 1: Remove duplicate rows, keeping the EARLIEST per (customer_id, doc_type).
-- This preserves the original verified=true row if it was uploaded first.
DELETE FROM customer_documents
WHERE id NOT IN (
  SELECT DISTINCT ON (customer_id, doc_type) id
  FROM customer_documents
  ORDER BY customer_id, doc_type, created_at ASC
);

-- Step 2: Add unique constraint (idempotent — will fail silently if exists).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customer_documents_customer_doctype_unique'
  ) THEN
    ALTER TABLE customer_documents
      ADD CONSTRAINT customer_documents_customer_doctype_unique
      UNIQUE (customer_id, doc_type);
  END IF;
END $$;

-- Step 3: Verification
SELECT
  'duplicates_remaining' AS check_name,
  COUNT(*) AS count
FROM (
  SELECT customer_id, doc_type, COUNT(*) AS cnt
  FROM customer_documents
  GROUP BY customer_id, doc_type
  HAVING COUNT(*) > 1
) dupes;

-- Should return 0 duplicates.

SELECT
  'constraint_exists' AS check_name,
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customer_documents_customer_doctype_unique'
  ) AS result;

-- Should return true.

COMMIT;
