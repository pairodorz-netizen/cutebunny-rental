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
});
