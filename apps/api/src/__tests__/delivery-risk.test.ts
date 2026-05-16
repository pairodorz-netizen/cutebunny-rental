import { describe, it, expect } from 'vitest';
import {
  countCalendarDays,
  isDeliveryAtRisk,
  isQueueCollisionRisk,
  isPreviousReturnRisk,
  MAX_STANDARD_DELIVERY_DAYS,
  QUEUE_BUFFER_DAYS_BKK,
  QUEUE_BUFFER_DAYS_PROVINCE,
  PREVIOUS_RETURN_BUFFER_DAYS,
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

  describe('previous return risk constant', () => {
    it('PREVIOUS_RETURN_BUFFER_DAYS is 4', () => {
      expect(PREVIOUS_RETURN_BUFFER_DAYS).toBe(4);
    });
  });

  describe('isPreviousReturnRisk', () => {
    // Scenario: new rental starts May 20, previous booking ended on various dates
    const startDate = new Date('2026-05-20');

    describe('gap < 4 → warn', () => {
      it('returns true when gap = 1 day (prev ended May 19)', () => {
        expect(isPreviousReturnRisk(startDate, new Date('2026-05-19'))).toBe(true);
      });

      it('returns true when gap = 2 days (prev ended May 18)', () => {
        expect(isPreviousReturnRisk(startDate, new Date('2026-05-18'))).toBe(true);
      });

      it('returns true when gap = 3 days (prev ended May 17)', () => {
        expect(isPreviousReturnRisk(startDate, new Date('2026-05-17'))).toBe(true);
      });

      it('returns true when gap = 0 days (prev ended same day)', () => {
        expect(isPreviousReturnRisk(startDate, new Date('2026-05-20'))).toBe(true);
      });
    });

    describe('gap = 4 → no warn (edge)', () => {
      it('returns false when gap = 4 days exactly (prev ended May 16)', () => {
        expect(isPreviousReturnRisk(startDate, new Date('2026-05-16'))).toBe(false);
      });
    });

    describe('gap = 5+ → no warn', () => {
      it('returns false when gap = 5 days (prev ended May 15)', () => {
        expect(isPreviousReturnRisk(startDate, new Date('2026-05-15'))).toBe(false);
      });

      it('returns false when gap = 7 days (prev ended May 13)', () => {
        expect(isPreviousReturnRisk(startDate, new Date('2026-05-13'))).toBe(false);
      });

      it('returns false when gap = 10 days (prev ended May 10)', () => {
        expect(isPreviousReturnRisk(startDate, new Date('2026-05-10'))).toBe(false);
      });
    });

    describe('previous = null → no warn', () => {
      it('returns false when previousBookingEnd is null', () => {
        expect(isPreviousReturnRisk(startDate, null)).toBe(false);
      });

      it('returns false when previousBookingEnd is null with explicit buffer', () => {
        expect(isPreviousReturnRisk(startDate, null, 4)).toBe(false);
      });
    });

    describe('custom buffer', () => {
      it('returns true at gap=2 with bufferDays=3', () => {
        expect(isPreviousReturnRisk(startDate, new Date('2026-05-18'), 3)).toBe(true);
      });

      it('returns false at gap=3 with bufferDays=3', () => {
        expect(isPreviousReturnRisk(startDate, new Date('2026-05-17'), 3)).toBe(false);
      });

      it('returns true at gap=1 with bufferDays=2', () => {
        expect(isPreviousReturnRisk(startDate, new Date('2026-05-19'), 2)).toBe(true);
      });

      it('returns false at gap=2 with bufferDays=2', () => {
        expect(isPreviousReturnRisk(startDate, new Date('2026-05-18'), 2)).toBe(false);
      });
    });

    describe('default buffer uses PREVIOUS_RETURN_BUFFER_DAYS (4)', () => {
      it('returns true at 3-day gap with default buffer', () => {
        expect(isPreviousReturnRisk(startDate, new Date('2026-05-17'))).toBe(true);
      });

      it('returns false at 4-day gap with default buffer', () => {
        expect(isPreviousReturnRisk(startDate, new Date('2026-05-16'))).toBe(false);
      });
    });

    describe('weekends do not affect calculation', () => {
      it('gap across weekend still uses calendar days', () => {
        // Fri May 15 → Mon May 18: gap = 3 calendar days → < 4 → true
        expect(isPreviousReturnRisk(new Date('2026-05-18'), new Date('2026-05-15'))).toBe(true);
        // Thu May 14 → Mon May 18: gap = 4 calendar days → = 4 → false
        expect(isPreviousReturnRisk(new Date('2026-05-18'), new Date('2026-05-14'))).toBe(false);
      });
    });
  });

  describe('BUG-543: 1-day range (start === end) — all popup variants', () => {
    // Scenario: user clicks May 31 twice → start=end="2026-05-31", days=1
    // All shared risk functions should work identically for 1-day ranges
    const today = new Date('2026-05-14');

    describe('delivery risk on 1-day range', () => {
      it('triggers when start=end is within 4 calendar days of today', () => {
        // today+1 → start=end="2026-05-15"
        expect(isDeliveryAtRisk(new Date('2026-05-15'), today)).toBe(true);
      });

      it('triggers at +3 days (start=end="2026-05-17")', () => {
        expect(isDeliveryAtRisk(new Date('2026-05-17'), today)).toBe(true);
      });

      it('does not trigger at +4 days (start=end="2026-05-18")', () => {
        expect(isDeliveryAtRisk(new Date('2026-05-18'), today)).toBe(false);
      });
    });

    describe('queue collision on 1-day range', () => {
      it('triggers when 1-day end is close to next booking (gap=1)', () => {
        // end="2026-05-31", next booking="2026-06-01" → gap=1 ≤ 5 → true
        expect(isQueueCollisionRisk(new Date('2026-05-31'), new Date('2026-06-01'), QUEUE_BUFFER_DAYS_PROVINCE)).toBe(true);
      });

      it('triggers at BKK threshold (gap=2)', () => {
        expect(isQueueCollisionRisk(new Date('2026-05-31'), new Date('2026-06-02'), QUEUE_BUFFER_DAYS_BKK)).toBe(true);
      });

      it('does not trigger when gap > province threshold', () => {
        // end="2026-05-31", next="2026-06-06" → gap=6 > 5 → false
        expect(isQueueCollisionRisk(new Date('2026-05-31'), new Date('2026-06-06'), QUEUE_BUFFER_DAYS_PROVINCE)).toBe(false);
      });
    });

    describe('previous return on 1-day range (BUG-543 primary case)', () => {
      it('triggers when start=end="2026-05-31", previous ended May 30 (gap=1)', () => {
        expect(isPreviousReturnRisk(new Date('2026-05-31'), new Date('2026-05-30'))).toBe(true);
      });

      it('triggers when start=end="2026-05-31", previous ended May 29 (gap=2)', () => {
        expect(isPreviousReturnRisk(new Date('2026-05-31'), new Date('2026-05-29'))).toBe(true);
      });

      it('triggers when start=end="2026-05-31", previous ended May 28 (gap=3)', () => {
        expect(isPreviousReturnRisk(new Date('2026-05-31'), new Date('2026-05-28'))).toBe(true);
      });

      it('does not trigger when gap = 4 (edge, previous ended May 27)', () => {
        expect(isPreviousReturnRisk(new Date('2026-05-31'), new Date('2026-05-27'))).toBe(false);
      });

      it('does not trigger when no previous booking', () => {
        expect(isPreviousReturnRisk(new Date('2026-05-31'), null)).toBe(false);
      });
    });
  });
});
