import { describe, it, expect } from 'vitest';
import { countCalendarDays, isDeliveryAtRisk, MAX_STANDARD_DELIVERY_DAYS } from '@cutebunny/shared/delivery';

describe('delivery risk — calendar day calculation', () => {
  it('MAX_STANDARD_DELIVERY_DAYS is 4', () => {
    expect(MAX_STANDARD_DELIVERY_DAYS).toBe(4);
  });

  describe('countCalendarDays', () => {
    it('returns 0 for same day', () => {
      expect(countCalendarDays(new Date('2026-05-14'), new Date('2026-05-14'))).toBe(0);
    });

    it('returns 1 for next day', () => {
      expect(countCalendarDays(new Date('2026-05-14'), new Date('2026-05-15'))).toBe(1);
    });

    it('counts weekends as normal days', () => {
      // Thu May 14 → Mon May 18 = 4 calendar days (includes Sat+Sun)
      expect(countCalendarDays(new Date('2026-05-14'), new Date('2026-05-18'))).toBe(4);
    });

    it('returns 5 for 5 days apart', () => {
      expect(countCalendarDays(new Date('2026-05-14'), new Date('2026-05-19'))).toBe(5);
    });

    it('returns 7 for one week', () => {
      expect(countCalendarDays(new Date('2026-05-14'), new Date('2026-05-21'))).toBe(7);
    });
  });

  describe('isDeliveryAtRisk', () => {
    // User story: today = May 14
    const today = new Date('2026-05-14');

    it('returns true for +1 day (May 15)', () => {
      expect(isDeliveryAtRisk(new Date('2026-05-15'), today)).toBe(true);
    });

    it('returns true for +2 days (May 16)', () => {
      expect(isDeliveryAtRisk(new Date('2026-05-16'), today)).toBe(true);
    });

    it('returns true for +3 days (May 17)', () => {
      expect(isDeliveryAtRisk(new Date('2026-05-17'), today)).toBe(true);
    });

    it('returns false for +4 days (May 18) — exactly at threshold', () => {
      expect(isDeliveryAtRisk(new Date('2026-05-18'), today)).toBe(false);
    });

    it('returns false for +5 days (May 19)', () => {
      expect(isDeliveryAtRisk(new Date('2026-05-19'), today)).toBe(false);
    });

    it('returns true for same day (0 days)', () => {
      expect(isDeliveryAtRisk(new Date('2026-05-14'), today)).toBe(true);
    });

    it('weekends do NOT affect calculation (pure calendar days)', () => {
      // Fri May 15 → Sat=16, Sun=17, Mon=18
      // From May 15: May 19 = +4 calendar days → safe
      const friday = new Date('2026-05-15');
      expect(isDeliveryAtRisk(new Date('2026-05-19'), friday)).toBe(false);
      // From May 15: May 18 = +3 → at risk
      expect(isDeliveryAtRisk(new Date('2026-05-18'), friday)).toBe(true);
    });
  });
});
