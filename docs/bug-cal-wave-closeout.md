# BUG-CAL Wave — Calendar UX Overhaul · Closeout

**Status:** CLOSED — 7/7 atoms shipped + regression spec landed
**Owner-approved scope:** 7 independent atomic PRs, TDD-first RED→GREEN, squash-merge per atom. Regression spec (`tests/e2e/calendar-ux.spec.ts`) consolidates all 7 atoms into a single Playwright guard.

## 1. Atoms shipped

| # | Atom | PR | Primary invariant |
|---|---|---|---|
| 01 | Stock unit expansion | [#67](https://github.com/pairodorz-netizen/cutebunny-rental/pull/67) | One calendar row per `InventoryUnit`; `#N` suffix when `stock_on_hand > 1`. Synthesised rows with `unit_id: null` when `InventoryUnit` is sparse; legacy `NULL unit_index` attributed to unit 1. |
| 02 | A→Z locale-aware sort | [#68](https://github.com/pairodorz-netizen/cutebunny-rental/pull/68) | Default `Intl.Collator(['th','en'], {sensitivity:'base', numeric:true})` on `display_name`, SKU ASC as deterministic tiebreaker. Name header clickable to toggle asc/desc. |
| 03 | Filter header (SKU/Brand/Name) | [#69](https://github.com/pairodorz-netizen/cutebunny-rental/pull/69) | 300 ms `useEffect` debounce, URL-synced (`?sku=&brand=&name=`), case-insensitive substring match, AND semantics. Pure logic in `@cutebunny/shared/calendar-filter`. |
| 04 | Sticky left columns | [#72](https://github.com/pairodorz-netizen/cutebunny-rental/pull/72) | SKU/Brand/Name columns `position: sticky`, offsets sourced from `cumulativeLeftOffsets()` (no hardcoded numbers). Header z-index 30, body z-index 20, date-cells 0. Right-edge shadow only on the rightmost sticky column. |
| 05 | Click-to-edit cells | [#73](https://github.com/pairodorz-netizen/cutebunny-rental/pull/73) | Every date cell → 8-state popover. `PATCH /api/v1/admin/calendar/cell` validated by zod + shared state machine (`canTransition`). Destructive `→ available` transitions require explicit `confirmed: true`. Audit row on every non-noop. Optimistic client update with snapshot rollback on 4xx. |
| 06 | Month boundary fix | [#70](https://github.com/pairodorz-netizen/cutebunny-rental/pull/70) | Exact days-in-month generated via pure-integer Y-M-D math (no `Date` parsing — immune to timezone drift). No "1" column ever appears after "31". Zero `date-fns` footprint. |
| 07 | SKU + Brand columns | [#71](https://github.com/pairodorz-netizen/cutebunny-rental/pull/71) | Readonly const `CALENDAR_LEFT_COLUMNS` (SKU 90 / Brand 120 / Name 200) drives header + body rendering. All three sortable via the BUG-CAL-02 collator. Exported `cumulativeLeftOffsets()` → `[0, 90, 210]` for ATOM 04 to consume. |

**Sequence (owner-ratified):** 01 → 02 → 03 → 06 → 07 → 04 → 05 → closeout.
Rationale: 02/03 read from the `CalendarUnitRow` shape introduced by 01. 06 is independent (backend-free). 04 depends on 07's `cumulativeLeftOffsets()`. 05 depends on no other atom but lands last so the edit popover renders inside the final DOM shape.

## 2. Shared library landed

New files under `packages/shared/src/`, all zero-dep, framework-free:

| File | Exports | Consumer |
|---|---|---|
| `calendar-row-expansion.ts` | `expandProductsToUnitRows` | `apps/api/src/routes/admin/calendar.ts` |
| `calendar-sort.ts` | `sortCalendarRows`, `nextSortState`, `CalendarSortKey`, `CalendarSortDirection` | `apps/admin/src/pages/calendar.tsx` |
| `calendar-filter.ts` | `filterCalendarRows`, `filtersToQuery`, `filtersFromQuery`, `CalendarFilters` | `apps/admin/src/pages/calendar.tsx` |
| `calendar-dates.ts` | `generateMonthDays`, `dayOfMonth`, `startOfMonthYMD`, `endOfMonthYMD`, `daysInMonth` | `apps/admin/src/pages/calendar.tsx` |
| `calendar-columns.ts` | `CALENDAR_LEFT_COLUMNS`, `cumulativeLeftOffsets`, `stickyLeftStyle` | `apps/admin/src/pages/calendar.tsx` |
| `calendar-state-machine.ts` | `SLOT_STATES`, `SLOT_STATE_LABELS`, `isValidState`, `canTransition` | `apps/admin/src/pages/calendar.tsx`, `apps/api/src/routes/admin/calendar.ts` |

## 3. Backend surface

One new route, zero schema migrations. Reuses `AvailabilityCalendar` unchanged from BUG-504 / FEAT-302.

```
PATCH /api/v1/admin/calendar/cell
  auth:   requireRole('staff')
  body:   { product_id: uuid, date: YYYY-MM-DD, unit_index: int≥1 | null,
            new_state: SlotState, confirmed?: boolean }
  200:    { data: { id?: uuid, from: SlotState, to: SlotState, noop: boolean } }
  400:    VALIDATION_ERROR  (bad body / unknown state / bad date)
  400:    INVALID_TRANSITION  (reserved for future state-machine tightening)
  409:    CONFIRM_REQUIRED  (destructive →available without confirmed: true)
  401/403: auth gate
```

Audit row shape:
```json
{
  "action": "UPDATE",
  "resource": "availability_calendar",
  "resource_id": "<slot uuid>",
  "details": {
    "product_id": "…",
    "date": "2026-04-20",
    "unit_index": 2,
    "from_state": "shipping",
    "to_state": "washing"
  }
}
```

## 4. Regression protection

### Vitest — api suite

```
550 passed | 6 skipped | 4 todo  (was 467 pre-wave)
```

Per-atom gate counts:

| Atom | File | Gates |
|---|---|---|
| 01 | `apps/api/src/__tests__/bug-cal-01-unit-expansion.test.ts` | 9 |
| 02 | `apps/api/src/__tests__/bug-cal-02-az-sort.test.ts` | 14 |
| 03 | `apps/api/src/__tests__/bug-cal-03-filter.test.ts` | 16 |
| 04 | `apps/api/src/__tests__/bug-cal-04-sticky-left.test.ts` | 11 |
| 05 | `apps/api/src/__tests__/bug-cal-05-state-machine.test.ts` | 12 |
| 05 | `apps/api/src/__tests__/bug-cal-05-patch-cell.test.ts` | 15 |
| 06 | `apps/api/src/__tests__/bug-cal-06-month-boundary.test.ts` | 14 |
| 07 | `apps/api/src/__tests__/bug-cal-07-sku-brand-columns.test.ts` | 10 |
| — | **Total new** | **101** |

### Playwright — `tests/e2e/calendar-ux.spec.ts`

7 gates, one per atom, all against the deployed admin SPA
(`E2E_ADMIN_URL`, default `https://admin-eight-rouge.vercel.app`).
Skips gracefully when `ADMIN_JWT_PROD` is unset — same pattern as
`categories-parity.spec.ts` gates 7 + 8. The spec lights up fully as
soon as BUG-504 A07.5 (parked) resumes and provisions the repo secret.

Gate → invariant map:

| Gate | Atom | Asserts |
|---|---|---|
| `atom 07 — left columns render in SKU \| Brand \| Name order` | 07 | Three `thead th[data-testid^="calendar-header-"]` in the exact sequence. |
| `atom 01 — rows expand one-per-inventory-unit, #N suffix when stock > 1` | 01 | Any suffixed row matches `/^.+#\d+$/`. |
| `atom 02 — default name ASC, clicking Name header toggles DESC` | 02 | DOM order equals `Intl.Collator(['th','en']).compare`-sorted baseline; post-click equals the reverse. |
| `atom 03 — filtering by name debounces + URL-syncs (?name=…)` | 03 | After `fill` + 500 ms, `location.search` carries `name=<probe>` and every visible row name contains it. |
| `atom 04 — SKU/Brand/Name cells stay sticky during horizontal scroll` | 04 | `computed.position === 'sticky'` on Name header; bounding-box x invariant (±1px) after `scrollLeft = 400`. |
| `atom 05 — clicking a date cell opens the 8-state popover` | 05 | First `[data-testid^="calendar-slot-"]` click reveals exactly 8 `[data-testid^="calendar-slot-option-"]` options in Prisma enum order. |
| `atom 06 — exactly N date-columns render for the current month` | 06 | Last numeric `thead th` ∈ `{28, 29, 30, 31}`; strict monotonic increase (no wrap). |

## 5. Preview deployments (latest per atom)

| Atom | Preview URL |
|---|---|
| 01 | https://admin-git-devin-1776953864-bug-7d1f46-pairodorz-2194s-projects.vercel.app/calendar |
| 02 | https://admin-git-devin-1776954367-bug-4d5483-pairodorz-2194s-projects.vercel.app/calendar |
| 03 | https://admin-git-devin-1776955640-bug-a50db3-pairodorz-2194s-projects.vercel.app/calendar |
| 04 | https://admin-git-devin-1776971892-bug-e48f7b-pairodorz-2194s-projects.vercel.app/calendar |
| 05 | https://admin-git-devin-1776972446-bug-ec4fcd-pairodorz-2194s-projects.vercel.app/calendar |
| 06 | https://admin-git-devin-1776956319-bug-b6923c-pairodorz-2194s-projects.vercel.app/calendar |
| 07 | https://admin-git-devin-1776958626-bug-e35d9a-pairodorz-2194s-projects.vercel.app/calendar |

Post-merge `main` branch preview (auto-generated by Vercel) carries the
full composed behaviour across all 7 atoms — suggested smoke path:
1. `/calendar?sku=A00&name=gigi` — confirms atoms 01 (expansion), 03 (URL-sync), 02 (sort applied inside the filtered view).
2. Horizontally scroll — confirms atom 04 (sticky) + atom 07 (column order).
3. Paginate to a 31-day month — confirms atom 06 (exact column count, no wrap).
4. Click any cell → pick `Washing` → watch colour flip optimistically → peek Settings → Audit Log for the new row — confirms atom 05.

## 6. Non-goals / explicit scope locks

- **BUG-504 wave + A07.5** remained CLOSED/PARKED throughout (see `bug504-wave-closeout.md`). This wave is independent.
- **A06 commit 3 FINAL** untouched. Still awaits literal `FINAL_CUTOVER` ack.
- **Date cells themselves are not editable** (atom 05 only clicks the status cells; month navigation unchanged).
- **Upgrade from `window.confirm` to a shadcn `<Dialog>`** deferred; wire contract is stable so the swap is a UX-only follow-up.

## 7. Protocol compliance

- **0 rollbacks** across 7 atom merges.
- **0 protocol violations.** Every atom merged only after CI 10/10 green + explicit owner ratification (auto-ratified on green + no scope creep, per standing delegation).
- Trigger-stall diagnosis from #68 surfaced a permanent `devin_env` pattern: branch from fresh main, avoid ci-nudge cruft commits, rebase + `--force-with-lease` to trigger `synchronize`. Applied proactively from #69 onward — zero further CI-trigger issues.

## 8. Related artifacts

- BUG-504 wave closeout: `bug504-wave-closeout.md`
- Security hardening: PRs #59–65 (RLS-01/02/03)
- Feature dependency: FEAT-302 `InventoryUnit` schema (pre-wave).
