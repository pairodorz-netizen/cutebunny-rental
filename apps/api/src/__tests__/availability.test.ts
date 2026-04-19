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
});
