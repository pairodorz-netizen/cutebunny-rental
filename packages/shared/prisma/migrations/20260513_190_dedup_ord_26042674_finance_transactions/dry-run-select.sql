-- BUG-543: Dry-run — preview which rows would be deleted/kept
-- Run this BEFORE the migration to verify the deletion scope.

-- 1. Show ALL finance_transactions for ORD-26042674
SELECT
  ft.id,
  ft.tx_type,
  ft.amount,
  ft.note,
  ft.created_at,
  o.order_number
FROM finance_transactions ft
INNER JOIN orders o ON o.id = ft.order_id
WHERE o.order_number = 'ORD-26042674'
ORDER BY ft.tx_type, ft.created_at;

-- 2. Show rows that WILL BE DELETED
--    Group A: BUG-517 reconciliation reversal (negative amount + note starts with BUG-517)
--    Group B: Original duplicate +590 (earliest positive rental_revenue)
SELECT ft.id, ft.tx_type, ft.amount, ft.note, ft.created_at,
  CASE
    WHEN ft.amount < 0 AND ft.note LIKE 'BUG-517%'
      THEN 'DELETE — BUG-517 reversal workaround'
    ELSE 'DELETE — original duplicate +590'
  END AS action
FROM finance_transactions ft
INNER JOIN orders o ON o.id = ft.order_id
WHERE o.order_number = 'ORD-26042674'
  AND ft.tx_type = 'rental_revenue'
  AND (
    -- Group A: BUG-517 reversal
    (ft.amount < 0 AND ft.note LIKE 'BUG-517%')
    OR
    -- Group B: earliest positive entry (the original duplicate)
    ft.id = (
      SELECT ft2.id
      FROM finance_transactions ft2
      INNER JOIN orders o2 ON o2.id = ft2.order_id
      WHERE o2.order_number = 'ORD-26042674'
        AND ft2.tx_type = 'rental_revenue'
        AND ft2.amount > 0
      ORDER BY ft2.created_at ASC, ft2.id ASC
      LIMIT 1
    )
  )
ORDER BY ft.created_at;

-- 3. Show the row that WILL BE KEPT (should be exactly 1: "Payment verified" +590)
SELECT ft.id, ft.tx_type, ft.amount, ft.note, ft.created_at,
  'KEEP — correct entry' AS action
FROM finance_transactions ft
INNER JOIN orders o ON o.id = ft.order_id
WHERE o.order_number = 'ORD-26042674'
  AND ft.tx_type = 'rental_revenue'
  AND ft.amount > 0
  AND ft.id != (
    SELECT ft2.id
    FROM finance_transactions ft2
    INNER JOIN orders o2 ON o2.id = ft2.order_id
    WHERE o2.order_number = 'ORD-26042674'
      AND ft2.tx_type = 'rental_revenue'
      AND ft2.amount > 0
    ORDER BY ft2.created_at ASC, ft2.id ASC
    LIMIT 1
  )
ORDER BY ft.created_at;

-- 4. Post-migration verification: net revenue should equal +590
SELECT
  SUM(ft.amount) AS net_revenue,
  590 AS expected
FROM finance_transactions ft
INNER JOIN orders o ON o.id = ft.order_id
WHERE o.order_number = 'ORD-26042674'
  AND ft.tx_type = 'rental_revenue';
