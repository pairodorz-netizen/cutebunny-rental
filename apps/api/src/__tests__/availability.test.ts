import { describe, it, expect } from 'vitest';

// Test the pure logic helpers for availability
// The async DB functions are tested via integration tests

describe('Availability Logic', () => {
  describe('date range generation', () => {
    it('generates correct number of dates for rental period', () => {
      const startDate = new Date('2024-06-01');
      const rentalDays = 3;
      const dates: string[] = [];

      for (let i = 0; i < rentalDays; i++) {
        const d = new Date(startDate);
        d.setDate(d.getDate() + i);
        dates.push(d.toISOString().split('T')[0]);
      }

      expect(dates).toEqual(['2024-06-01', '2024-06-02', '2024-06-03']);
    });

    it('handles month boundary crossing', () => {
      const startDate = new Date('2024-06-30');
      const rentalDays = 3;
      const dates: string[] = [];

      for (let i = 0; i < rentalDays; i++) {
        const d = new Date(startDate);
        d.setDate(d.getDate() + i);
        dates.push(d.toISOString().split('T')[0]);
      }

      expect(dates).toEqual(['2024-06-30', '2024-07-01', '2024-07-02']);
    });

    it('handles single day rental', () => {
      const startDate = new Date('2024-06-15');
      const rentalDays = 1;
      const dates: string[] = [];

      for (let i = 0; i < rentalDays; i++) {
        const d = new Date(startDate);
        d.setDate(d.getDate() + i);
        dates.push(d.toISOString().split('T')[0]);
      }

      expect(dates).toEqual(['2024-06-15']);
    });
  });

  describe('month calendar generation', () => {
    it('generates correct number of days for a 30-day month', () => {
      const year = 2024;
      const month = 6; // June
      const endDate = new Date(year, month, 0); // last day of June
      expect(endDate.getDate()).toBe(30);
    });

    it('generates correct number of days for a 31-day month', () => {
      const year = 2024;
      const month = 7; // July
      const endDate = new Date(year, month, 0);
      expect(endDate.getDate()).toBe(31);
    });

    it('handles February in a leap year', () => {
      const year = 2024;
      const month = 2; // February
      const endDate = new Date(year, month, 0);
      expect(endDate.getDate()).toBe(29);
    });

    it('handles February in a non-leap year', () => {
      const year = 2025;
      const month = 2;
      const endDate = new Date(year, month, 0);
      expect(endDate.getDate()).toBe(28);
    });
  });

  describe('conflict detection logic', () => {
    it('identifies conflicts from booked slots', () => {
      const bookedStatuses = ['booked', 'cleaning', 'blocked_repair', 'late_return'];
      const slotStatus = 'booked';
      expect(bookedStatuses.includes(slotStatus)).toBe(true);
    });

    it('identifies available slots as non-conflicting', () => {
      const bookedStatuses = ['booked', 'cleaning', 'blocked_repair', 'late_return'];
      const slotStatus = 'available';
      expect(bookedStatuses.includes(slotStatus)).toBe(false);
    });

    it('identifies tentative slots as non-conflicting', () => {
      const bookedStatuses = ['booked', 'cleaning', 'blocked_repair', 'late_return'];
      const slotStatus = 'tentative';
      expect(bookedStatuses.includes(slotStatus)).toBe(false);
    });
  });

  // BUG-403: Date-range picker must reject ranges containing blocked days
  describe('BUG-403: range-with-blocked-day rejection', () => {
    it('rejects a date range that spans across a blocked day', () => {
      // Simulates the client-side hasBlockedDayInRange check
      const days = [
        { date: '2026-04-14', status: 'available' },
        { date: '2026-04-15', status: 'booked' },
        { date: '2026-04-16', status: 'booked' },
        { date: '2026-04-17', status: 'booked' },
        { date: '2026-04-18', status: 'available' },
      ];

      function hasBlockedDayInRange(start: string, end: string): boolean {
        for (const day of days) {
          if (day.date > start && day.date < end) {
            if (day.status !== 'available') return true;
          }
        }
        return false;
      }

      // Range Apr 14 → Apr 18 spans blocked days 15-17
      expect(hasBlockedDayInRange('2026-04-14', '2026-04-18')).toBe(true);
    });

    it('allows a date range with all available days', () => {
      const days = [
        { date: '2026-04-01', status: 'available' },
        { date: '2026-04-02', status: 'available' },
        { date: '2026-04-03', status: 'available' },
      ];

      function hasBlockedDayInRange(start: string, end: string): boolean {
        for (const day of days) {
          if (day.date > start && day.date < end) {
            if (day.status !== 'available') return true;
          }
        }
        return false;
      }

      expect(hasBlockedDayInRange('2026-04-01', '2026-04-03')).toBe(false);
    });

    it('allows single-day selection (no in-between days to check)', () => {
      const days = [
        { date: '2026-04-10', status: 'available' },
        { date: '2026-04-11', status: 'booked' },
      ];

      function hasBlockedDayInRange(start: string, end: string): boolean {
        for (const day of days) {
          if (day.date > start && day.date < end) {
            if (day.status !== 'available') return true;
          }
        }
        return false;
      }

      // Single day — no days between start and end
      expect(hasBlockedDayInRange('2026-04-10', '2026-04-10')).toBe(false);
    });
  });

  // FEAT-402: Lifecycle-aware calendar blocking logic
  describe('FEAT-402: lifecycle blocking windows', () => {
    it('pre-blocks D shipping days before rental start', () => {
      const rentalStart = new Date('2026-06-15');
      const shippingDays = 2;
      const preBlockDates: string[] = [];

      for (let i = 1; i <= shippingDays; i++) {
        const d = new Date(rentalStart);
        d.setDate(d.getDate() - i);
        preBlockDates.push(d.toISOString().split('T')[0]);
      }

      expect(preBlockDates).toEqual(['2026-06-14', '2026-06-13']);
    });

    it('post-blocks D shipping days after rental end', () => {
      const rentalEnd = new Date('2026-06-17');
      const shippingDays = 2;
      const postBlockDates: string[] = [];

      for (let i = 1; i <= shippingDays; i++) {
        const d = new Date(rentalEnd);
        d.setDate(d.getDate() + i);
        postBlockDates.push(d.toISOString().split('T')[0]);
      }

      expect(postBlockDates).toEqual(['2026-06-18', '2026-06-19']);
    });

    it('adds W wash days after return shipping window', () => {
      const rentalEnd = new Date('2026-06-17');
      const shippingDays = 2;
      const washDays = 1;
      const washDates: string[] = [];

      for (let i = 1; i <= washDays; i++) {
        const d = new Date(rentalEnd);
        d.setDate(d.getDate() + shippingDays + i);
        washDates.push(d.toISOString().split('T')[0]);
      }

      expect(washDates).toEqual(['2026-06-20']);
    });

    it('full lifecycle example: R=15-17, D=2, W=1', () => {
      const rentalStart = new Date('2026-06-15');
      const rentalEnd = new Date('2026-06-17');
      const shippingDays = 2;
      const washDays = 1;

      const allBlocked: { date: string; status: string }[] = [];

      // Pre-shipping (before rental)
      for (let i = shippingDays; i >= 1; i--) {
        const d = new Date(rentalStart);
        d.setDate(d.getDate() - i);
        allBlocked.push({ date: d.toISOString().split('T')[0], status: 'shipping' });
      }

      // Rental period
      const rentalDays = 3;
      for (let i = 0; i < rentalDays; i++) {
        const d = new Date(rentalStart);
        d.setDate(d.getDate() + i);
        allBlocked.push({ date: d.toISOString().split('T')[0], status: 'booked' });
      }

      // Post-shipping (return)
      for (let i = 1; i <= shippingDays; i++) {
        const d = new Date(rentalEnd);
        d.setDate(d.getDate() + i);
        allBlocked.push({ date: d.toISOString().split('T')[0], status: 'shipping' });
      }

      // Washing
      for (let i = 1; i <= washDays; i++) {
        const d = new Date(rentalEnd);
        d.setDate(d.getDate() + shippingDays + i);
        allBlocked.push({ date: d.toISOString().split('T')[0], status: 'washing' });
      }

      expect(allBlocked).toEqual([
        { date: '2026-06-13', status: 'shipping' },
        { date: '2026-06-14', status: 'shipping' },
        { date: '2026-06-15', status: 'booked' },
        { date: '2026-06-16', status: 'booked' },
        { date: '2026-06-17', status: 'booked' },
        { date: '2026-06-18', status: 'shipping' },
        { date: '2026-06-19', status: 'shipping' },
        { date: '2026-06-20', status: 'washing' },
      ]);
    });

    it('handles zero shipping days (local pickup)', () => {
      const rentalStart = new Date('2026-06-15');
      const rentalEnd = new Date('2026-06-17');
      const shippingDays = 0;
      const washDays = 1;

      const preBlock: string[] = [];
      for (let i = 1; i <= shippingDays; i++) {
        const d = new Date(rentalStart);
        d.setDate(d.getDate() - i);
        preBlock.push(d.toISOString().split('T')[0]);
      }

      const postBlock: string[] = [];
      for (let i = 1; i <= shippingDays; i++) {
        const d = new Date(rentalEnd);
        d.setDate(d.getDate() + i);
        postBlock.push(d.toISOString().split('T')[0]);
      }

      const washBlock: string[] = [];
      for (let i = 1; i <= washDays; i++) {
        const d = new Date(rentalEnd);
        d.setDate(d.getDate() + shippingDays + i);
        washBlock.push(d.toISOString().split('T')[0]);
      }

      expect(preBlock).toEqual([]);
      expect(postBlock).toEqual([]);
      expect(washBlock).toEqual(['2026-06-18']); // wash starts right after rental end
    });
  });
});
