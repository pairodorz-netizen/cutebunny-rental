import { describe, it, expect } from 'vitest';
import {
  countCalendarDays,
  isDeliveryAtRisk,
  isQueueCollisionRisk,
  MAX_STANDARD_DELIVERY_DAYS,
  QUEUE_BUFFER_DAYS_BKK,
  QUEUE_BUFFER_DAYS_PROVINCE,
} from '@cutebunny/shared/delivery';

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

  describe('queue collision constants', () => {
    it('QUEUE_BUFFER_DAYS_BKK is 2', () => {
      expect(QUEUE_BUFFER_DAYS_BKK).toBe(2);
    });

    it('QUEUE_BUFFER_DAYS_PROVINCE is 5', () => {
      expect(QUEUE_BUFFER_DAYS_PROVINCE).toBe(5);
    });
  });

  describe('isQueueCollisionRisk', () => {
    const endDate = new Date('2026-05-20');

    describe('BKK threshold (2 days)', () => {
      it('returns true when gap = 0 days (next booking same day)', () => {
        expect(isQueueCollisionRisk(endDate, new Date('2026-05-20'), QUEUE_BUFFER_DAYS_BKK)).toBe(true);
      });

      it('returns true when gap = 1 day (May 21)', () => {
        expect(isQueueCollisionRisk(endDate, new Date('2026-05-21'), QUEUE_BUFFER_DAYS_BKK)).toBe(true);
      });

      it('returns true when gap = 2 days (May 22) — at threshold', () => {
        expect(isQueueCollisionRisk(endDate, new Date('2026-05-22'), QUEUE_BUFFER_DAYS_BKK)).toBe(true);
      });

      it('returns false when gap = 3 days (May 23) — beyond threshold', () => {
        expect(isQueueCollisionRisk(endDate, new Date('2026-05-23'), QUEUE_BUFFER_DAYS_BKK)).toBe(false);
      });
    });

    describe('province threshold (5 days)', () => {
      it('returns true when gap = 1 day (May 21)', () => {
        expect(isQueueCollisionRisk(endDate, new Date('2026-05-21'), QUEUE_BUFFER_DAYS_PROVINCE)).toBe(true);
      });

      it('returns true when gap = 3 days (May 23)', () => {
        expect(isQueueCollisionRisk(endDate, new Date('2026-05-23'), QUEUE_BUFFER_DAYS_PROVINCE)).toBe(true);
      });

      it('returns true when gap = 5 days (May 25) — at threshold', () => {
        expect(isQueueCollisionRisk(endDate, new Date('2026-05-25'), QUEUE_BUFFER_DAYS_PROVINCE)).toBe(true);
      });

      it('returns false when gap = 6 days (May 26) — beyond threshold', () => {
        expect(isQueueCollisionRisk(endDate, new Date('2026-05-26'), QUEUE_BUFFER_DAYS_PROVINCE)).toBe(false);
      });

      it('returns false when gap = 10 days (May 30)', () => {
        expect(isQueueCollisionRisk(endDate, new Date('2026-05-30'), QUEUE_BUFFER_DAYS_PROVINCE)).toBe(false);
      });
    });

    describe('no next booking', () => {
      it('returns false when nextBookingStart is null', () => {
        expect(isQueueCollisionRisk(endDate, null)).toBe(false);
      });

      it('returns false when nextBookingStart is null (BKK threshold)', () => {
        expect(isQueueCollisionRisk(endDate, null, QUEUE_BUFFER_DAYS_BKK)).toBe(false);
      });

      it('returns false when nextBookingStart is null (province threshold)', () => {
        expect(isQueueCollisionRisk(endDate, null, QUEUE_BUFFER_DAYS_PROVINCE)).toBe(false);
      });
    });

    describe('default buffer uses province threshold', () => {
      it('returns true at 5-day gap with default buffer', () => {
        expect(isQueueCollisionRisk(endDate, new Date('2026-05-25'))).toBe(true);
      });

      it('returns false at 6-day gap with default buffer', () => {
        expect(isQueueCollisionRisk(endDate, new Date('2026-05-26'))).toBe(false);
      });
    });
  });
});
