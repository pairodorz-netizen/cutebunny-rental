# BUG-517: Finance Revenue Fix — Runbook

## Summary

Revenue was double-counted and inflated due to two bugs:
1. `rental_revenue` created at **both** payment verification AND returned-status → double-count
2. Payment verification used `order.totalAmount` (includes deposit) instead of `order.subtotal`

## Code Changes (PR #166)

| Change | Detail |
|--------|--------|
| Payment verification | Uses `order.subtotal` instead of `order.totalAmount` |
| Returned-status guard | Checks if `rental_revenue` exists before creating; skips if found (prevents double-count), creates if missing (fallback for manual/cash payments) |
| Cancellation reversal | Already uses `-order.subtotal` (no change) |
| Finance UI tooltips | Added Info icon + tooltip on Revenue/Expenses/Net Profit cards (EN/TH/ZH) |

## Revenue Entry Points — Risk Matrix

| Payment Channel | Verification Flow? | Revenue at Payment? | Revenue at Returned? |
|---|---|---|---|
| Payment slip → verify | Yes | Yes (subtotal) | Guard skips (already exists) |
| Manual mark_as_paid (order create) | No | No | Guard creates (fallback) |
| Admin edit → paid_locked | No | No | Guard creates (fallback) |
| Cancelled order | N/A | Reversal (-subtotal) | N/A |

## Important: SQL Column Name Mapping

Prisma uses camelCase model names, but the actual PostgreSQL tables use snake_case
via `@@map` / `@map`. The SQL below uses the **real PostgreSQL names**:

| Prisma model / field | PostgreSQL table / column |
|---|---|
| `financeTransaction` | `finance_transactions` |
| `orderId` | `order_id` |
| `txType` | `tx_type` |
| `totalAmount` | `total_amount` |
| `createdAt` | `created_at` |
| `createdBy` | `created_by` |
| `orders` | `orders` (same) |
| `subtotal` | `subtotal` (same) |
| `amount` | `amount` (same) |
| `note` | `note` (same) |

## Post-Merge: Historical Data Reconciliation

**DO NOT run on prod without human approval.**

### Step 1: Identify affected transactions

```sql
-- Find rental_revenue transactions that used total_amount instead of subtotal
-- (created before BUG-517 fix was deployed)
SELECT
  ft.id AS tx_id,
  ft.order_id,
  ft.amount AS recorded_amount,
  o.subtotal AS correct_amount,
  o.total_amount,
  ft.amount - o.subtotal AS overstated_by,
  ft.created_at
FROM finance_transactions ft
JOIN orders o ON o.id = ft.order_id
WHERE ft.tx_type = 'rental_revenue'
  AND ft.amount > 0
  AND ft.amount = o.total_amount
  AND ft.amount != o.subtotal
ORDER BY ft.created_at;
```

### Step 2: Find duplicate revenue records (double-counted orders)

```sql
-- Orders with more than one positive rental_revenue transaction
SELECT
  order_id,
  COUNT(*) AS revenue_count,
  SUM(amount) AS total_recorded,
  MIN(amount) AS min_amount,
  MAX(amount) AS max_amount
FROM finance_transactions
WHERE tx_type = 'rental_revenue'
  AND amount > 0
GROUP BY order_id
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;
```

### Step 3: Reconciliation (create reversing transactions)

```sql
-- For each overstated transaction, create a correction entry
BEGIN;

-- Correct overstated amount (total_amount → subtotal)
INSERT INTO finance_transactions (order_id, tx_type, amount, note, created_by)
SELECT
  ft.order_id,
  'rental_revenue',
  -(ft.amount - o.subtotal),
  'BUG-517 reconciliation: correct total_amount→subtotal (overstated by ' || (ft.amount - o.subtotal) || ')',
  ft.created_by
FROM finance_transactions ft
JOIN orders o ON o.id = ft.order_id
WHERE ft.tx_type = 'rental_revenue'
  AND ft.amount > 0
  AND ft.amount = o.total_amount
  AND ft.amount != o.subtotal;

-- Remove duplicate revenue records (keep earliest, reverse later ones)
WITH ranked AS (
  SELECT
    id,
    order_id,
    amount,
    ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY created_at) AS rn
  FROM finance_transactions
  WHERE tx_type = 'rental_revenue'
    AND amount > 0
)
INSERT INTO finance_transactions (order_id, tx_type, amount, note, created_by)
SELECT
  r.order_id,
  'rental_revenue',
  -r.amount,
  'BUG-517 reconciliation: remove duplicate revenue record',
  (SELECT created_by FROM finance_transactions WHERE id = r.id)
FROM ranked r
WHERE r.rn > 1;

COMMIT;
```

### Step 4: Verification

```sql
-- After reconciliation, verify no duplicates remain
SELECT
  order_id,
  COUNT(*) AS positive_revenue_count
FROM finance_transactions
WHERE tx_type = 'rental_revenue'
  AND amount > 0
GROUP BY order_id
HAVING COUNT(*) > 1;
-- Expected: 0 rows

-- Verify revenue amounts match subtotals
SELECT
  ft.order_id,
  SUM(ft.amount) AS net_revenue,
  o.subtotal
FROM finance_transactions ft
JOIN orders o ON o.id = ft.order_id
WHERE ft.tx_type = 'rental_revenue'
GROUP BY ft.order_id, o.subtotal
HAVING SUM(ft.amount) != o.subtotal
  AND SUM(ft.amount) != 0;
-- Expected: 0 rows (all match subtotal, or 0 for cancelled)
```

## Rollback

No schema changes — code-only fix. To rollback:
1. Revert the commit on `orders.ts`
2. Revenue will return to previous (double-counting) behavior
3. Reconciliation transactions are permanent (reversing entries, not hard-deletes)

## Smoke Test

After deploy:
1. Open Finance > Summary tab — verify tooltip appears on hover over Revenue/Expenses/Net Profit
2. Create test order with `mark_as_paid` → transition to returned → verify exactly 1 `rental_revenue` transaction
3. Create test order → verify payment slip → transition to returned → verify exactly 1 `rental_revenue` transaction (no duplicate)
