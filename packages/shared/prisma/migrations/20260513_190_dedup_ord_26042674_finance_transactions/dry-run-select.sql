-- BUG-543: Dry-run — preview which rows would be deleted
-- Run this BEFORE the migration to verify the deletion scope.

-- 1. Show ALL finance_transactions for ORD-26042674
SELECT
  ft.id,
  ft.order_id,
  ft.tx_type,
  ft.amount,
  ft.note,
  ft.created_at,
  o.order_number
FROM finance_transactions ft
INNER JOIN orders o ON o.id = ft.order_id
WHERE o.order_number = 'ORD-26042674'
ORDER BY ft.tx_type, ft.amount, ft.created_at;

-- 2. Show ONLY the duplicate rows that would be DELETED (rn > 1)
SELECT
  id,
  order_id,
  tx_type,
  amount,
  note,
  created_at,
  'WILL BE DELETED' AS action
FROM (
  SELECT
    ft.id,
    ft.order_id,
    ft.tx_type,
    ft.amount,
    ft.note,
    ft.created_at,
    ROW_NUMBER() OVER (
      PARTITION BY ft.order_id, ft.tx_type, ft.amount
      ORDER BY ft.created_at ASC, ft.id ASC
    ) AS rn
  FROM finance_transactions ft
  INNER JOIN orders o ON o.id = ft.order_id
  WHERE o.order_number = 'ORD-26042674'
) ranked
WHERE rn > 1
ORDER BY tx_type, amount, created_at;

-- 3. Show rows that would be KEPT (rn = 1)
SELECT
  id,
  order_id,
  tx_type,
  amount,
  note,
  created_at,
  'WILL BE KEPT' AS action
FROM (
  SELECT
    ft.id,
    ft.order_id,
    ft.tx_type,
    ft.amount,
    ft.note,
    ft.created_at,
    ROW_NUMBER() OVER (
      PARTITION BY ft.order_id, ft.tx_type, ft.amount
      ORDER BY ft.created_at ASC, ft.id ASC
    ) AS rn
  FROM finance_transactions ft
  INNER JOIN orders o ON o.id = ft.order_id
  WHERE o.order_number = 'ORD-26042674'
) ranked
WHERE rn = 1
ORDER BY tx_type, amount, created_at;
