-- BUG-543: Clean up ORD-26042674 finance_transactions
--
-- Background (from BUG-517 runbook):
--   ORD-26042674 had rental_revenue created at BOTH payment verification
--   AND returned-status → duplicate +590. BUG-517 reconciliation then
--   inserted a reversing -590 entry to cancel the duplicate.
--
-- Current state (3 rows, all tx_type=rental_revenue):
--   +590  "Rental revenue"          ← original duplicate (DELETE)
--   -590  "BUG-517 reconci..."      ← reversal workaround (DELETE)
--   +590  "Payment verified..."     ← correct entry (KEEP)
--
-- This migration deletes the original duplicate AND its BUG-517 reversal,
-- leaving only the "Payment verified" row. Net revenue stays +590.
--
-- Idempotent: if either row is already gone, it's simply not matched.
--
-- ⚠️  DO NOT RUN ON PRODUCTION until reviewed.
--     Run dry-run-select.sql first.

BEGIN;

-- Step 1: Delete the BUG-517 reconciliation reversal (-590)
DELETE FROM finance_transactions
WHERE id IN (
  SELECT ft.id
  FROM finance_transactions ft
  INNER JOIN orders o ON o.id = ft.order_id
  WHERE o.order_number = 'ORD-26042674'
    AND ft.tx_type = 'rental_revenue'
    AND ft.amount < 0
    AND ft.note LIKE 'BUG-517%'
);

-- Step 2: Delete the original duplicate +590 (earliest positive entry)
-- Keeps only the latest +590 ("Payment verified") row.
DELETE FROM finance_transactions
WHERE id IN (
  SELECT id FROM (
    SELECT
      ft.id,
      ROW_NUMBER() OVER (
        PARTITION BY ft.order_id, ft.tx_type
        ORDER BY ft.created_at ASC, ft.id ASC
      ) AS rn
    FROM finance_transactions ft
    INNER JOIN orders o ON o.id = ft.order_id
    WHERE o.order_number = 'ORD-26042674'
      AND ft.tx_type = 'rental_revenue'
      AND ft.amount > 0
  ) ranked
  WHERE rn = 1
  -- Only delete if there are multiple positive entries (idempotent guard)
  AND (SELECT COUNT(*)
       FROM finance_transactions ft2
       INNER JOIN orders o2 ON o2.id = ft2.order_id
       WHERE o2.order_number = 'ORD-26042674'
         AND ft2.tx_type = 'rental_revenue'
         AND ft2.amount > 0) > 1
);

COMMIT;
