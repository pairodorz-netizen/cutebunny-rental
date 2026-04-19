# Stock Management Spec v3.2.0

**Supersedes:** spec-stock-v3.1.0  
**Date:** 2026-04-16  
**Status:** Complete

## Changes from v3.1.0

### Wave 6 — Bug fixes + UX (4 atoms, all merged)

| PR | Atom | Description |
|----|------|-------------|
| #7 | BUG-401 | Stock log duplication after Add Stock — root cause: `resetQueries` vs `invalidateQueries` race |
| #8 | FEAT-401 | UnitSwitcher extracted to reusable `<UnitSwitcher />` component |
| #9 | BUG-402 | Auto-populate `availability_calendar` with 90-day `available` rows on Add Stock |
| #10 | BUG-403 | **CRITICAL** — Customer calendar date-range picker rejects ranges spanning blocked days; server returns `409 CONFLICT_RANGE` |

### Wave 7 — Shipping & wash config (2 atoms, all merged)

| PR | Atom | Description |
|----|------|-------------|
| #11 | FEAT-403 | `shippingDays` per province on `ShippingProvinceConfig` (default 2); admin UI inline edit; origin province config |
| #12 | FEAT-404 | `wash_duration_days` system config (default 1 day); validation (int >= 1); Settings → System Config |

### Wave 8 — Lifecycle-aware calendar (1 atom)

| PR | Atom | Description |
|----|------|-------------|
| #13 | FEAT-402 | Lifecycle-aware calendar: pre-block shipping days before rental, post-block shipping + wash days after rental; `shipping` and `washing` SlotStatus enum values; amber/cyan calendar colors |

## Schema changes (v3.2.0)

### ShippingProvinceConfig
- `shipping_days INTEGER NOT NULL DEFAULT 2` — transit time in days per province

### SlotStatus enum
- Added `shipping` — transit window (outbound/return)
- Added `washing` — post-return cleaning window

### SystemConfig (seed data)
- `wash_duration_days = '1'` (group: operations)
- `origin_province = 'BKK'` (group: shipping)

## Lifecycle blocking algorithm

For a rental `R_start..R_end` to customer in province P with `shipping_days = D` and `wash_duration_days = W`:

```
Pre-block:  [R_start - D .. R_start - 1]  → status: shipping
Rental:     [R_start .. R_end]             → status: booked
Post-block: [R_end + 1 .. R_end + D]       → status: shipping
Wash:       [R_end + D + 1 .. R_end + D + W] → status: washing
```

**Example:** R = Jun 15–17, Chonburi (D=2), W=1:
- Jun 13–14: shipping (outbound)
- Jun 15–17: booked
- Jun 18–19: shipping (return)
- Jun 20: washing

## Migrations

| Migration | Description |
|-----------|-------------|
| `20260418_007_shipping_days` | ADD COLUMN `shipping_days` to `shipping_province_configs` |
| `20260418_008_lifecycle_calendar` | ADD VALUE `shipping`, `washing` to `SlotStatus` enum |

## Rollback scripts

| Script | Description |
|--------|-------------|
| `scripts/rollback/007_shipping_days_down.sql` | DROP COLUMN `shipping_days` |
| `scripts/rollback/008_lifecycle_calendar_down.sql` | Convert shipping/washing → blocked_repair (enum values persist) |

## Test coverage

- 218 tests passing (was 203 at v3.1.0 end)
- Key new tests: lifecycle blocking windows (5), shipping_days validation (4), wash duration config (3), stock log dedup regression (1)

## ADRs

- **ADR-003:** unit_index on availability_calendar (v3.1.0)
- **ADR-004:** Shipping + wash lifecycle blocking strategy (v3.2.0)
