/**
 * BUG-CAL-06 — Month boundary fix (RED → GREEN).
 *
 * Regression: March 31 used to wrap to column "1" of the next month because
 * the date-generation loop mixed UTC and local-month anchors. This suite
 * locks in:
 *   - exact column count per month (28 / 29 / 30 / 31)
 *   - no column labelled "1" appears after "31"
 *   - leap-year Feb gets 29 days
 *   - timezone-stable `dayOfMonth()` extractor (no `new Date`)
 */
import { describe, it, expect } from 'vitest';
import {
  generateMonthDays,
  dayOfMonth,
  daysInMonth,
  startOfMonthYMD,
  endOfMonthYMD,
} from '@cutebunny/shared/calendar-dates';

describe('BUG-CAL-06 — generateMonthDays', () => {
  it('Feb 2026 yields exactly 28 days', () => {
    const days = generateMonthDays('2026-02-01');
    expect(days).toHaveLength(28);
    expect(days[0]).toBe('2026-02-01');
    expect(days[27]).toBe('2026-02-28');
  });

  it('Mar 2026 yields exactly 31 days ending on 2026-03-31', () => {
    const days = generateMonthDays('2026-03-01');
    expect(days).toHaveLength(31);
    expect(days[0]).toBe('2026-03-01');
    expect(days[30]).toBe('2026-03-31');
  });

  it('Apr 2026 yields exactly 30 days ending on 2026-04-30', () => {
    const days = generateMonthDays('2026-04-01');
    expect(days).toHaveLength(30);
    expect(days[29]).toBe('2026-04-30');
  });

  it('no column labelled "1" appears after "31" (primary regression)', () => {
    const days = generateMonthDays('2026-03-15');
    const dayNumbers = days.map(dayOfMonth);
    // "1" should appear only at index 0, never anywhere else in the row.
    expect(dayNumbers.indexOf(1)).toBe(0);
    expect(dayNumbers.lastIndexOf(1)).toBe(0);
    // Last column is literally 31, not 1 of the next month.
    expect(dayNumbers[dayNumbers.length - 1]).toBe(31);
  });

  it('leap year Feb 2024 yields exactly 29 days', () => {
    expect(generateMonthDays('2024-02-01')).toHaveLength(29);
    expect(generateMonthDays('2024-02-15').at(-1)).toBe('2024-02-29');
  });

  it('non-leap Feb 2025 yields exactly 28 days', () => {
    expect(generateMonthDays('2025-02-01')).toHaveLength(28);
  });

  it('ignores the day component of the anchor', () => {
    const a = generateMonthDays('2026-03-01');
    const b = generateMonthDays('2026-03-15');
    const c = generateMonthDays('2026-03-31');
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('accepts a Date instance as anchor', () => {
    const days = generateMonthDays(new Date(2026, 2, 10)); // local month=2 => March
    expect(days).toHaveLength(31);
    expect(days[0]).toBe('2026-03-01');
    expect(days[30]).toBe('2026-03-31');
  });

  it('rejects malformed anchor strings', () => {
    expect(() => generateMonthDays('not-a-date')).toThrow();
    expect(() => generateMonthDays('2026-13-01')).toThrow();
  });

  it('snapshot shape for Feb / Mar / Apr 2026', () => {
    expect({
      feb: generateMonthDays('2026-02-01').length,
      mar: generateMonthDays('2026-03-01').length,
      apr: generateMonthDays('2026-04-01').length,
      febLast: generateMonthDays('2026-02-01').at(-1),
      marLast: generateMonthDays('2026-03-01').at(-1),
      aprLast: generateMonthDays('2026-04-01').at(-1),
    }).toMatchInlineSnapshot(`
      {
        "apr": 30,
        "aprLast": "2026-04-30",
        "feb": 28,
        "febLast": "2026-02-28",
        "mar": 31,
        "marLast": "2026-03-31",
      }
    `);
  });
});

describe('BUG-CAL-06 — dayOfMonth', () => {
  it('extracts day number from ISO string without Date parsing', () => {
    expect(dayOfMonth('2026-03-31')).toBe(31);
    expect(dayOfMonth('2026-02-09')).toBe(9);
    expect(dayOfMonth('2026-04-01')).toBe(1);
  });

  it('throws on malformed input', () => {
    expect(() => dayOfMonth('2026-03-xx')).toThrow();
    expect(() => dayOfMonth('2026-03-32')).toThrow();
  });
});

describe('BUG-CAL-06 — month boundary helpers', () => {
  it('daysInMonth knows its Februaries', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2026, 2)).toBe(28);
  });

  it('startOfMonthYMD / endOfMonthYMD produce tidy bounds', () => {
    expect(startOfMonthYMD('2026-03-15')).toBe('2026-03-01');
    expect(endOfMonthYMD('2026-03-15')).toBe('2026-03-31');
    expect(endOfMonthYMD('2026-02-15')).toBe('2026-02-28');
    expect(endOfMonthYMD('2024-02-15')).toBe('2024-02-29');
  });
});
