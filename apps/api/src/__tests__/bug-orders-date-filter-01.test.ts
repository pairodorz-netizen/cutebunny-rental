// BUG-ORDERS-DATE-FILTER-01 — RED gates for the rescoped include_stale
// semantic.
//
// Regression reported by owner after the BUG-ORDERS-ARCHIVE-01 wave
// (PRs #79/#80/#81/#82/#83/#84/#85/#86) closed successfully:
//
//   REPRO:
//     1. Click the "Today" date-range pill while "Show all (incl.
//        archived)" is checked.
//     2. Expected: only orders whose createdAt falls within TODAY's
//        window are visible.
//     3. Actual: orders from older dates (e.g. 04/22/2026 when today is
//        04/24/2026) are still visible — the "Today" bound is being
//        bypassed by include_stale=true.
//
//   ROOT CAUSE:
//     PR #80's `buildOrdersWindowFilter` treated `includeStale=true` as
//     a HARD bypass of every part of the window — both the archive
//     cutoff AND the user-selected createdAt bounds. That was correct
//     for the ORIGINAL rescue intent (All Time + Show all must return
//     every row) but over-broad: when the user picks a specific
//     pill ("Today" / "Last 7" / "Last 30" / "Last 90" / "This Year" /
//     a custom from-to pair), the include_stale toggle should NOT
//     silently widen the date window. Only the literal "All Time"
//     preset (which emits from='' / to='') should mean "no date
//     filter".
//
//   NEW CONTRACT (owner, this atom):
//     - `includeStale=true` bypasses the archive-cutoff ONLY.
//     - The createdAt gte/lte bounds are always enforced when present.
//     - Empty-string bounds still mean "no bound" (preset="all" path).
//
// These gates pin the new contract across all 7 preset pills × the
// include_stale toggle (14 scenarios minimum) so no future refactor
// can regress the active-date-range behaviour.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  buildOrdersWindowFilter,
  computeArchiveCutoff,
  DEFAULT_ARCHIVE_WINDOW_DAYS,
  resolveOrdersDatePreset,
} from '@cutebunny/shared/orders-archive-window';
import { buildOrdersWhere } from '../lib/orders-query';

// Hermetic "now" — 2026-04-24T12:00:00Z. All preset resolutions are
// computed relative to this to avoid flaky real-clock assertions.
const NOW = new Date('2026-04-24T12:00:00.000Z');
const TODAY_YMD = '2026-04-24';

describe('BUG-ORDERS-DATE-FILTER-01 · buildOrdersWindowFilter · includeStale rescoped to archive-only', () => {
  it('[preset=today + includeStale=true] enforces today-only bounds and skips archive cutoff', () => {
    const resolved = resolveOrdersDatePreset('today', NOW);
    const result = buildOrdersWindowFilter({
      includeStale: true, // user flipped Show all AFTER picking Today
      dateFrom: resolved.from,
      dateTo: resolved.to,
      now: NOW,
    });
    expect(result.createdAt?.gte).toEqual(new Date(TODAY_YMD));
    expect(result.createdAt?.lte).toEqual(new Date(`${TODAY_YMD}T23:59:59.999Z`));
    expect(result.archiveCutoff).toBeUndefined();
  });

  it('[preset=today + includeStale=false] enforces today-only bounds AND applies archive cutoff', () => {
    const resolved = resolveOrdersDatePreset('today', NOW);
    const result = buildOrdersWindowFilter({
      includeStale: false,
      dateFrom: resolved.from,
      dateTo: resolved.to,
      now: NOW,
    });
    expect(result.createdAt?.gte).toEqual(new Date(TODAY_YMD));
    expect(result.createdAt?.lte).toEqual(new Date(`${TODAY_YMD}T23:59:59.999Z`));
    expect(result.archiveCutoff).toEqual(
      computeArchiveCutoff(NOW, DEFAULT_ARCHIVE_WINDOW_DAYS),
    );
  });

  it('[preset=7 + includeStale=true] enforces last-7-day bounds; no archive cutoff', () => {
    const resolved = resolveOrdersDatePreset('7', NOW);
    const result = buildOrdersWindowFilter({
      includeStale: true,
      dateFrom: resolved.from,
      dateTo: resolved.to,
      now: NOW,
    });
    expect(result.createdAt?.gte).toEqual(new Date('2026-04-17'));
    expect(result.createdAt?.lte).toEqual(new Date(`${TODAY_YMD}T23:59:59.999Z`));
    expect(result.archiveCutoff).toBeUndefined();
  });

  it('[preset=7 + includeStale=false] enforces last-7-day bounds AND archive cutoff', () => {
    const resolved = resolveOrdersDatePreset('7', NOW);
    const result = buildOrdersWindowFilter({
      includeStale: false,
      dateFrom: resolved.from,
      dateTo: resolved.to,
      now: NOW,
    });
    expect(result.createdAt?.gte).toEqual(new Date('2026-04-17'));
    expect(result.archiveCutoff).toBeDefined();
  });

  it('[preset=30 + includeStale=true] enforces last-30-day bounds; no archive cutoff', () => {
    const resolved = resolveOrdersDatePreset('30', NOW);
    const result = buildOrdersWindowFilter({
      includeStale: true,
      dateFrom: resolved.from,
      dateTo: resolved.to,
      now: NOW,
    });
    expect(result.createdAt?.gte).toEqual(new Date('2026-03-25'));
    expect(result.archiveCutoff).toBeUndefined();
  });

  it('[preset=30 + includeStale=false] enforces last-30-day bounds AND archive cutoff', () => {
    const resolved = resolveOrdersDatePreset('30', NOW);
    const result = buildOrdersWindowFilter({
      includeStale: false,
      dateFrom: resolved.from,
      dateTo: resolved.to,
      now: NOW,
    });
    expect(result.createdAt?.gte).toEqual(new Date('2026-03-25'));
    expect(result.archiveCutoff).toBeDefined();
  });

  it('[preset=90 + includeStale=true] enforces last-90-day bounds; no archive cutoff', () => {
    const resolved = resolveOrdersDatePreset('90', NOW);
    const result = buildOrdersWindowFilter({
      includeStale: true,
      dateFrom: resolved.from,
      dateTo: resolved.to,
      now: NOW,
    });
    expect(result.createdAt?.gte).toEqual(new Date('2026-01-24'));
    expect(result.archiveCutoff).toBeUndefined();
  });

  it('[preset=90 + includeStale=false] enforces last-90-day bounds AND archive cutoff', () => {
    const resolved = resolveOrdersDatePreset('90', NOW);
    const result = buildOrdersWindowFilter({
      includeStale: false,
      dateFrom: resolved.from,
      dateTo: resolved.to,
      now: NOW,
    });
    expect(result.createdAt?.gte).toEqual(new Date('2026-01-24'));
    expect(result.archiveCutoff).toBeDefined();
  });

  it('[preset=year + includeStale=true] enforces YTD bounds; no archive cutoff', () => {
    const resolved = resolveOrdersDatePreset('year', NOW);
    const result = buildOrdersWindowFilter({
      includeStale: true,
      dateFrom: resolved.from,
      dateTo: resolved.to,
      now: NOW,
    });
    expect(result.createdAt?.gte).toEqual(new Date('2026-01-01'));
    expect(result.archiveCutoff).toBeUndefined();
  });

  it('[preset=year + includeStale=false] enforces YTD bounds AND archive cutoff', () => {
    const resolved = resolveOrdersDatePreset('year', NOW);
    const result = buildOrdersWindowFilter({
      includeStale: false,
      dateFrom: resolved.from,
      dateTo: resolved.to,
      now: NOW,
    });
    expect(result.createdAt?.gte).toEqual(new Date('2026-01-01'));
    expect(result.archiveCutoff).toBeDefined();
  });

  it('[preset=all + includeStale=true] carries NO bounds and NO archive cutoff (owner contract preserved)', () => {
    const resolved = resolveOrdersDatePreset('all', NOW);
    const result = buildOrdersWindowFilter({
      includeStale: true,
      dateFrom: resolved.from, // ''
      dateTo: resolved.to, // ''
      now: NOW,
    });
    expect(result.createdAt).toBeUndefined();
    expect(result.archiveCutoff).toBeUndefined();
  });

  it('[preset=all + includeStale=false] is never emitted by the preset resolver (sanity check)', () => {
    // Defensive: owner's contract is "All Time" ALWAYS flips Show-all
    // ON. This gate documents that the preset resolver upholds that.
    const resolved = resolveOrdersDatePreset('all', NOW);
    expect(resolved.includeStale).toBe(true);
  });

  it('[custom from/to + includeStale=true] enforces custom bounds; no archive cutoff', () => {
    const result = buildOrdersWindowFilter({
      includeStale: true,
      dateFrom: '2025-12-01',
      dateTo: '2026-02-15',
      now: NOW,
    });
    expect(result.createdAt?.gte).toEqual(new Date('2025-12-01'));
    expect(result.createdAt?.lte).toEqual(new Date('2026-02-15T23:59:59.999Z'));
    expect(result.archiveCutoff).toBeUndefined();
  });

  it('[custom from/to + includeStale=false] enforces custom bounds AND archive cutoff', () => {
    const result = buildOrdersWindowFilter({
      includeStale: false,
      dateFrom: '2025-12-01',
      dateTo: '2026-02-15',
      now: NOW,
    });
    expect(result.createdAt?.gte).toEqual(new Date('2025-12-01'));
    expect(result.archiveCutoff).toBeDefined();
  });

  it('[no bounds + includeStale=true] (raw API call, owner default) returns a total-empty filter', () => {
    const result = buildOrdersWindowFilter({
      includeStale: true,
      now: NOW,
    });
    expect(result).toEqual({});
  });

  it('[no bounds + includeStale=false] applies archive cutoff only (protected default)', () => {
    const result = buildOrdersWindowFilter({
      includeStale: false,
      now: NOW,
    });
    expect(result.createdAt).toBeUndefined();
    expect(result.archiveCutoff).toBeDefined();
  });
});

describe('BUG-ORDERS-DATE-FILTER-01 · buildOrdersWhere delegation', () => {
  it('include_stale=true + Today bounds → where.createdAt still present (route parity)', () => {
    const where = buildOrdersWhere({
      include_stale: 'true',
      from: TODAY_YMD,
      to: TODAY_YMD,
    });
    // The whole point of this atom: even with include_stale=true, the
    // route-level WHERE must still scope createdAt to the user's pill.
    expect(where.createdAt).toBeDefined();
    // BUG-501: buildOrdersWhere now emits ISO strings (not Date objects)
    // to work around Prisma Neon-adapter date-serialisation edge cases.
    expect((where.createdAt as { gte?: string; lte?: string }).gte).toBe(
      new Date(TODAY_YMD).toISOString(),
    );
    expect((where.createdAt as { gte?: string; lte?: string }).lte).toBe(
      new Date(`${TODAY_YMD}T23:59:59.999Z`).toISOString(),
    );
  });

  it('include_stale=true + All-Time (empty bounds) → where has NO createdAt', () => {
    const where = buildOrdersWhere({
      include_stale: 'true',
      from: '',
      to: '',
    });
    expect(where.createdAt).toBeUndefined();
  });
});

describe('BUG-ORDERS-DATE-FILTER-01 · orders.tsx "(incl. archived)" suffix UX', () => {
  const ordersTsxPath = path.resolve(
    __dirname,
    '../../../../apps/admin/src/pages/orders.tsx',
  );

  function readOrdersTsx(): string {
    return fs.readFileSync(ordersTsxPath, 'utf-8');
  }

  it('orders.tsx carries an "incl. archived" suffix string for the active pill label', () => {
    const src = readOrdersTsx();
    // The suffix must appear in the component's render output so the
    // owner can tell at a glance that Show-all is applied to the
    // currently-selected date window. Accept either the literal
    // English string or an i18n key that resolves to it — the
    // companion i18n gate pins the EN/TH/ZH copy.
    const hasLiteral = /incl\.\s*archived/i.test(src);
    const hasI18nKey = /orders\.(dateFilter|datePreset|filters)\.archivedSuffix|archivedSuffix/i.test(src);
    expect(hasLiteral || hasI18nKey).toBe(true);
  });
});
