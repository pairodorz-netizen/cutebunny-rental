import { describe, it, expect } from 'vitest';
import { countBusinessDays, isDeliveryAtRisk, MAX_STANDARD_DELIVERY_BUSINESS_DAYS } from '@cutebunny/shared/delivery';

describe('delivery risk — business day calculation', () => {
  it('MAX_STANDARD_DELIVERY_BUSINESS_DAYS is 4', () => {
    expect(MAX_STANDARD_DELIVERY_BUSINESS_DAYS).toBe(4);
  });

  describe('countBusinessDays', () => {
    // Reference: 2026-05-11=Mon, 12=Tue, 13=Wed, 14=Thu, 15=Fri, 16=Sat, 17=Sun, 18=Mon

    it('returns 0 for same day', () => {
      const d = new Date('2026-05-13');
      expect(countBusinessDays(d, d)).toBe(0);
    });

    it('counts weekdays only (Mon-Fri)', () => {
      // Wed May 13 → Thu May 14 = 1 business day
      expect(countBusinessDays(new Date('2026-05-13'), new Date('2026-05-14'))).toBe(1);
    });

    it('skips weekends', () => {
      // Fri May 15 → Mon May 18 = 1 business day (Monday)
      expect(countBusinessDays(new Date('2026-05-15'), new Date('2026-05-18'))).toBe(1);
    });

    it('counts full work week correctly', () => {
      // Mon May 11 → Fri May 15 = 4 business days (Tue, Wed, Thu, Fri)
      expect(countBusinessDays(new Date('2026-05-11'), new Date('2026-05-15'))).toBe(4);
    });

    it('counts across weekend', () => {
      // Mon May 11 → Mon May 18 = 5 business days (Tue-Fri + Mon)
      expect(countBusinessDays(new Date('2026-05-11'), new Date('2026-05-18'))).toBe(5);
    });

    it('Saturday to Monday = 1 business day', () => {
      // Sat May 16 → Mon May 18 = 1 business day (Monday)
      expect(countBusinessDays(new Date('2026-05-16'), new Date('2026-05-18'))).toBe(1);
    });

    it('Fri to next Fri = 5 business days', () => {
      // Fri May 15 → Fri May 22 = 5 business days (Mon, Tue, Wed, Thu, Fri)
      expect(countBusinessDays(new Date('2026-05-15'), new Date('2026-05-22'))).toBe(5);
    });
  });

  describe('isDeliveryAtRisk', () => {
    it('returns true when start date is tomorrow (1 business day away)', () => {
      const today = new Date('2026-05-13'); // Wed
      const startDate = new Date('2026-05-14'); // Thu = 1 biz day
      expect(isDeliveryAtRisk(startDate, today)).toBe(true);
    });

    it('returns true when start date is 3 business days away (< 4)', () => {
      const today = new Date('2026-05-12'); // Tue
      const startDate = new Date('2026-05-15'); // Fri = 3 biz days (Wed, Thu, Fri)
      expect(isDeliveryAtRisk(startDate, today)).toBe(true);
    });

    it('returns false when start date is exactly 4 business days away', () => {
      const today = new Date('2026-05-11'); // Mon
      const startDate = new Date('2026-05-15'); // Fri = 4 biz days (Tue, Wed, Thu, Fri)
      expect(isDeliveryAtRisk(startDate, today)).toBe(false);
    });

    it('returns false when start date is 5+ business days away', () => {
      const today = new Date('2026-05-11'); // Mon
      const startDate = new Date('2026-05-18'); // Next Mon = 5 biz days
      expect(isDeliveryAtRisk(startDate, today)).toBe(false);
    });

    it('accounts for weekends in risk calculation', () => {
      const today = new Date('2026-05-14'); // Thu
      // Thu→Fri(1), Mon(2), Tue(3) = May 19 is 3 biz days → at risk
      expect(isDeliveryAtRisk(new Date('2026-05-19'), today)).toBe(true);
      // Thu→Fri(1), Mon(2), Tue(3), Wed(4) = May 20 is 4 biz days → safe
      expect(isDeliveryAtRisk(new Date('2026-05-20'), today)).toBe(false);
    });

    it('returns true for same day (0 business days)', () => {
      const today = new Date('2026-05-13');
      expect(isDeliveryAtRisk(today, today)).toBe(true);
    });
  });
});
