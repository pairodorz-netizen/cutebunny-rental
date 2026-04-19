# ADR-004: Shipping + Wash Lifecycle Blocking Strategy

**Date:** 2026-04-16  
**Status:** Accepted  
**Supersedes:** None  
**Related:** ADR-003 (unit_index on availability_calendar), spec-stock-v3.2.0

## Context

CuteBunny Rental ships dress items to customers and receives them back after the rental period. During transit and post-return cleaning, the item is unavailable for other bookings. Without blocking these turnaround windows, the system allows double-bookings where an item hasn't physically returned or been cleaned before the next rental.

User acceptance testing (v3.1.0) revealed that customers could book dates immediately adjacent to an existing rental, ignoring the physical constraints of shipping and washing.

## Decision

### Approach: Inline calendar blocking on the `availability_calendar` table

We extend the existing `SlotStatus` enum with two new values:
- `shipping` — days reserved for outbound/return transit
- `washing` — days reserved for post-return cleaning

When an order is placed, the system:
1. Looks up `shipping_days` for the customer's province (from `ShippingProvinceConfig`, FEAT-403)
2. Looks up `wash_duration_days` from `SystemConfig` (FEAT-404)
3. Creates calendar entries with appropriate statuses around the rental period

### Alternatives considered

**Option A (chosen): SlotStatus enum extension**
- Pro: Reuses existing calendar infrastructure, no new tables
- Pro: Calendar queries automatically respect shipping/washing blocks
- Pro: Admin/customer UIs show distinct colors without code changes to query layer
- Con: Enum values cannot be removed in PostgreSQL without recreating the type

**Option B: Separate `turnaround_blocks` table**
- Pro: Clean separation of concerns
- Pro: Easy to drop/recreate without touching calendar
- Con: Every calendar query needs a JOIN or subquery to include turnaround blocks
- Con: More complex UI integration (two data sources for one calendar view)

**Option C: Computed blocking (no persistence)**
- Pro: No schema changes
- Con: Every calendar render must compute blocks on the fly from orders + province config
- Con: Race conditions — two concurrent bookings might not see each other's computed blocks

Option A was chosen for simplicity and consistency with the existing calendar pattern. The minor con (enum values persist after rollback) is acceptable since rollback converts statuses to `blocked_repair`.

## Configuration

| Config | Source | Default | Range |
|--------|--------|---------|-------|
| `shipping_days` | `ShippingProvinceConfig.shippingDays` per province | 2 | 1–30 |
| `wash_duration_days` | `SystemConfig` key | 1 | >= 1 |
| `origin_province` | `SystemConfig` key | BKK | Any province code |

### Province shipping_days defaults (seed)
- Bangkok + perimeter (BKK, NBI, PTH, SMK): 1 day
- Central Thailand: 2 days (default)
- Northern/Southern/Isan: 3 days

## Consequences

1. **Calendar accuracy:** Turnaround time is now visible and enforced, preventing physical conflicts
2. **Admin visibility:** Shipping (amber) and washing (cyan) days are visually distinct on both calendar pages
3. **Customer experience:** Available date ranges correctly exclude turnaround windows
4. **Backfill:** Existing orders placed before FEAT-402 do not have lifecycle blocks. A future backfill script may be needed if historical accuracy is required.
5. **Performance:** Each order placement now creates `2D + W` additional calendar rows. For typical values (D=2, W=1), this adds 5 rows per product per order — negligible.

## Migration strategy

- `ALTER TYPE "SlotStatus" ADD VALUE IF NOT EXISTS 'shipping'` — cannot run inside a transaction
- `ALTER TYPE "SlotStatus" ADD VALUE IF NOT EXISTS 'washing'` — same constraint
- Must be run as standalone statements, not inside Prisma's transaction wrapper
- Rollback: `UPDATE ... SET slot_status = 'blocked_repair' WHERE slot_status IN ('shipping', 'washing')`
