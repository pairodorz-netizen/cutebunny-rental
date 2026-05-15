-- BUG-543: Remove duplicate finance_transactions for ORD-26042674
--
-- Context: ORD-26042674 has duplicate transaction rows in the
-- finance_transactions table, likely caused by status-change side
-- effects firing more than once. This migration keeps the earliest
-- row per (order_id, tx_type, amount) group and deletes the rest.
--
-- Idempotent: safe to run multiple times. If no duplicates exist,
-- zero rows are deleted.
--
-- ⚠️  DO NOT RUN ON PRODUCTION until reviewed.
--     Run the dry-run SELECT first (see dry-run-select.sql).

-- Step 1: Delete duplicate rows, keeping the earliest per (order_id, tx_type, amount)
DELETE FROM finance_transactions
WHERE id IN (
  SELECT id FROM (
    SELECT
      ft.id,
      ROW_NUMBER() OVER (
        PARTITION BY ft.order_id, ft.tx_type, ft.amount
        ORDER BY ft.created_at ASC, ft.id ASC
      ) AS rn
    FROM finance_transactions ft
    INNER JOIN orders o ON o.id = ft.order_id
    WHERE o.order_number = 'ORD-26042674'
  ) ranked
  WHERE rn > 1
);
