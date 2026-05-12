-- ROLLBACK: BUG-519 — Remove UNIQUE constraint on customer_documents(customer_id, doc_type)
-- Only run if rollback is needed. Does NOT restore deleted duplicate rows.

BEGIN;

SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '2s';

ALTER TABLE customer_documents
  DROP CONSTRAINT IF EXISTS customer_documents_customer_doctype_unique;

-- Verification
SELECT
  'constraint_removed' AS check_name,
  NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customer_documents_customer_doctype_unique'
  ) AS result;

-- Should return true.

COMMIT;
