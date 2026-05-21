-- Remove "cleaning" / "cleaned" enum values from 5 PostgreSQL enums.
-- Safe to run: all transactional data has been wiped, no rows reference these values.

-- 1. FinanceTxType: remove 'cleaning'
ALTER TYPE "FinanceTxType" RENAME TO "FinanceTxType_old";
CREATE TYPE "FinanceTxType" AS ENUM ('rental_revenue', 'deposit_received', 'deposit_returned', 'deposit_forfeited', 'late_fee', 'damage_fee', 'force_buy', 'shipping', 'cogs', 'repair', 'marketing', 'platform_fee');
ALTER TABLE "finance_transactions" ALTER COLUMN "tx_type" TYPE "FinanceTxType" USING ("tx_type"::text::"FinanceTxType");
DROP TYPE "FinanceTxType_old";

-- 2. InventoryPhysicalStatus: remove 'cleaning'
ALTER TYPE "InventoryPhysicalStatus" RENAME TO "InventoryPhysicalStatus_old";
CREATE TYPE "InventoryPhysicalStatus" AS ENUM ('available', 'rented', 'repair', 'ready', 'decommissioned');
ALTER TABLE "inventory_units" ALTER COLUMN "physical_status" TYPE "InventoryPhysicalStatus" USING ("physical_status"::text::"InventoryPhysicalStatus");
DROP TYPE "InventoryPhysicalStatus_old";

-- 3. OrderItemStatus: remove 'cleaned'
ALTER TYPE "OrderItemStatus" RENAME TO "OrderItemStatus_old";
CREATE TYPE "OrderItemStatus" AS ENUM ('pending', 'confirmed', 'shipped', 'delivered', 'returned', 'inspecting', 'damaged', 'lost');
ALTER TABLE "order_items" ALTER COLUMN "status" TYPE "OrderItemStatus" USING ("status"::text::"OrderItemStatus");
DROP TYPE "OrderItemStatus_old";

-- 4. OrderStatus: remove 'cleaning'
ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
CREATE TYPE "OrderStatus" AS ENUM ('unpaid', 'paid_locked', 'shipped', 'returned', 'repair', 'finished', 'cancelled');
ALTER TABLE "orders" ALTER COLUMN "status" TYPE "OrderStatus" USING ("status"::text::"OrderStatus");
ALTER TABLE "order_status_logs" ALTER COLUMN "from_status" TYPE "OrderStatus" USING ("from_status"::text::"OrderStatus");
ALTER TABLE "order_status_logs" ALTER COLUMN "to_status" TYPE "OrderStatus" USING ("to_status"::text::"OrderStatus");
DROP TYPE "OrderStatus_old";

-- 5. SlotStatus: remove 'cleaning'
ALTER TYPE "SlotStatus" RENAME TO "SlotStatus_old";
CREATE TYPE "SlotStatus" AS ENUM ('available', 'booked', 'blocked_repair', 'tentative', 'late_return', 'shipping', 'washing');
ALTER TABLE "availability_calendar" ALTER COLUMN "slot_status" TYPE "SlotStatus" USING ("slot_status"::text::"SlotStatus");
DROP TYPE "SlotStatus_old";
