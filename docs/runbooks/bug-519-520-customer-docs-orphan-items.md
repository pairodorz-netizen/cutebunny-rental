# BUG-519 + BUG-520 Runbook

## BUG-519: Customer Documents Duplication

### Root Cause
`customer_documents` table had no UNIQUE constraint on `(customer_id, doc_type)`.
When a customer placed multiple orders or re-uploaded documents, duplicate rows were
created. Customer `bfa9cb28-7d5e-47f3-8154-464aba4fe5d3` (ไพโรจน์) had 2× `id_card_front`
and 2× `facebook`.

### Fix Applied (Code)
1. **API response dedupe** (`apps/api/src/routes/admin/orders.ts`): Order detail endpoint
   deduplicates documents by `doc_type`, keeping the latest `created_at`.
2. **Upload flow upsert** (`apps/api/src/routes/orders.ts`): Document upload now checks
   for existing `(customer_id, doc_type)` before insert — updates if exists, creates if not.

### Migration (Run on Prod)

**Pre-check:**
```sql
SELECT customer_id, doc_type, COUNT(*) AS cnt
FROM customer_documents
GROUP BY customer_id, doc_type
HAVING COUNT(*) > 1;
```

**Run:** `migrations/20260512_180_customer_documents_unique_constraint_forward.sql`

This will:
1. DELETE duplicate rows (keep earliest per customer+doc_type)
2. ADD UNIQUE constraint `customer_documents_customer_doctype_unique`

**Post-check:** Verification queries are included in the SQL file.

**Rollback:** `migrations/20260512_180_customer_documents_unique_constraint_rollback.sql`

---

## BUG-520: Orphan Order Items (Missing Rows)

### Root Cause
Two orders have zero `order_items` rows in the database:
- `ORD-26042674` — subtotal 590 THB, 0 items
- `ORD-26048933` — subtotal 820 + deposit 4,140 = total 4,960 THB, 0 items

Both created 2026-04-22. Likely seed/migration data where items were not carried over.
This is **not** a product FK issue — the rows simply don't exist.

### Fix Applied (Code)
1. **Product FK resilience** (`apps/api/src/routes/admin/orders.ts`): Both order list
   and detail endpoints now fetch product data separately (batch `findMany`) instead of
   joining via `include`. If a product is hard-deleted, snapshot fields (`productName`,
   `size`, `rentalPricePerDay`) are used as fallback.
2. **Empty state UI** (`apps/admin/src/pages/orders.tsx`): Items table shows
   "No items recorded for this order" when items array is empty.
3. **i18n**: `orders.noItems` key added in EN/TH/ZH.

### Diagnostic SQL

Check for orders with zero items:
```sql
SELECT o.id, o.order_number, o.status, o.subtotal, o.total_amount,
       (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
FROM orders o
WHERE NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id)
ORDER BY o.created_at DESC;
```

### Data Backfill (Manual, if source available)
No automated backfill — source data for these 2 orders is unknown. If product names
can be identified from `finance_transactions.note` or external records, manually insert:

```sql
-- Example (DO NOT RUN without verified data):
-- INSERT INTO order_items (order_id, product_id, product_name, size, quantity, rental_price_per_day, subtotal, status)
-- VALUES ('...', '...', 'Product Name', 'M', 1, 295, 590, 'finished');
```

### Column Reference (Prisma ↔ PostgreSQL)

| Prisma field        | PostgreSQL column      |
|---------------------|------------------------|
| `orderItems`        | `order_items`          |
| `orderId`           | `order_id`             |
| `productId`         | `product_id`           |
| `productName`       | `product_name`         |
| `rentalPricePerDay` | `rental_price_per_day` |
| `customerId`        | `customer_id`          |
| `customerDocument`  | `customer_documents`   |
| `docType`           | `doc_type`             |
| `storageKey`        | `storage_key`          |
| `createdAt`         | `created_at`           |
