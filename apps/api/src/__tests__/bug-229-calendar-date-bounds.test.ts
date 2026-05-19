import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MAX_BOOKING_YEARS,
  getMaxBookingDate,
  getTodayDate,
  isDateWithinBookingWindow,
  getMaxBookingMonth,
  isMonthNavigable,
} from '@cutebunny/shared/date-bounds';

describe('BUG-229: Calendar date bounds validation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Fix reference date: 2026-05-13
    vi.setSystemTime(new Date(2026, 4, 13)); // May 13, 2026
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('MAX_BOOKING_YEARS', () => {
    it('should be 2', () => {
      expect(MAX_BOOKING_YEARS).toBe(2);
    });
  });

  describe('getMaxBookingDate()', () => {
    it('returns today + 2 years as YYYY-MM-DD', () => {
      expect(getMaxBookingDate()).toBe('2028-05-13');
    });

    it('accepts a custom reference date', () => {
      const ref = new Date(2025, 0, 15); // Jan 15, 2025
      expect(getMaxBookingDate(ref)).toBe('2027-01-15');
    });

    it('handles leap year boundary (Feb 29 reference)', () => {
      // 2024 is a leap year, Feb 29 + 2 years = 2026 Mar 1 (Feb has 28 days in 2026)
      const ref = new Date(2024, 1, 29); // Feb 29, 2024
      // JavaScript Date(2026, 1, 29) → Mar 1, 2026 (since Feb 2026 has 28 days)
      const result = getMaxBookingDate(ref);
      // The function uses new Date(year + 2, month, day) which auto-rolls
      expect(result).toBe('2026-03-01');
    });
  });

  describe('getTodayDate()', () => {
    it('returns today as YYYY-MM-DD', () => {
      expect(getTodayDate()).toBe('2026-05-13');
    });
  });

  describe('isDateWithinBookingWindow()', () => {
    it('accepts today', () => {
      expect(isDateWithinBookingWindow('2026-05-13')).toBe(true);
    });

    it('accepts tomorrow', () => {
      expect(isDateWithinBookingWindow('2026-05-14')).toBe(true);
    });

    it('accepts a date 1 year from now', () => {
      expect(isDateWithinBookingWindow('2027-05-13')).toBe(true);
    });

    it('accepts the exact boundary date (today + 2 years)', () => {
      expect(isDateWithinBookingWindow('2028-05-13')).toBe(true);
    });

    it('rejects one day past the boundary', () => {
      expect(isDateWithinBookingWindow('2028-05-14')).toBe(false);
    });

    it('rejects year 2226 (the specific repro case)', () => {
      expect(isDateWithinBookingWindow('2226-01-01')).toBe(false);
    });

    it('rejects year 2030 (4 years from now)', () => {
      expect(isDateWithinBookingWindow('2030-05-13')).toBe(false);
    });

    it('rejects invalid format', () => {
      expect(isDateWithinBookingWindow('')).toBe(false);
      expect(isDateWithinBookingWindow('not-a-date')).toBe(false);
      expect(isDateWithinBookingWindow('2026/05/13')).toBe(false);
    });

    it('accepts dates in the past (only upper bound enforced)', () => {
      expect(isDateWithinBookingWindow('2020-01-01')).toBe(true);
    });
  });

  describe('getMaxBookingMonth()', () => {
    it('returns year+2 and current month', () => {
      const result = getMaxBookingMonth();
      expect(result).toEqual({ year: 2028, month: 5 });
    });
  });

  describe('isMonthNavigable()', () => {
    it('allows current month', () => {
      expect(isMonthNavigable(2026, 5)).toBe(true);
    });

    it('allows next month', () => {
      expect(isMonthNavigable(2026, 6)).toBe(true);
    });

    it('allows the max month (May 2028)', () => {
      expect(isMonthNavigable(2028, 5)).toBe(true);
    });

    it('rejects one month past max (June 2028)', () => {
      expect(isMonthNavigable(2028, 6)).toBe(false);
    });

    it('rejects a year past max (2029)', () => {
      expect(isMonthNavigable(2029, 1)).toBe(false);
    });

    it('rejects year 2226 (the specific repro case)', () => {
      expect(isMonthNavigable(2226, 1)).toBe(false);
    });

    it('allows past months', () => {
      expect(isMonthNavigable(2020, 1)).toBe(true);
    });
  });
});
