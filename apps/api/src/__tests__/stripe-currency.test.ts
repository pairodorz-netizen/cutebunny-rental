import { describe, it, expect } from 'vitest';
import { thbToSatang, satangToThb, STRIPE_CURRENCY } from '../lib/stripe-currency';

describe('stripe-currency', () => {
  describe('thbToSatang', () => {
    it('converts whole THB to satang', () => {
      expect(thbToSatang(100)).toBe(10000);
      expect(thbToSatang(1500)).toBe(150000);
      expect(thbToSatang(1)).toBe(100);
      expect(thbToSatang(0)).toBe(0);
    });

    it('handles large amounts', () => {
      expect(thbToSatang(99999)).toBe(9999900);
      expect(thbToSatang(1000000)).toBe(100000000);
    });

    it('rounds fractional amounts', () => {
      // Database stores Int so fractions shouldn't occur,
      // but the function should be safe
      expect(thbToSatang(10.50)).toBe(1050);
      expect(thbToSatang(10.99)).toBe(1099);
      expect(thbToSatang(10.005)).toBe(1001); // rounds
    });
  });

  describe('satangToThb', () => {
    it('converts satang to whole THB', () => {
      expect(satangToThb(10000)).toBe(100);
      expect(satangToThb(150000)).toBe(1500);
      expect(satangToThb(100)).toBe(1);
      expect(satangToThb(0)).toBe(0);
    });

    it('handles large amounts', () => {
      expect(satangToThb(9999900)).toBe(99999);
      expect(satangToThb(100000000)).toBe(1000000);
    });

    it('rounds when satang is not evenly divisible', () => {
      expect(satangToThb(150)).toBe(2); // 1.50 rounds to 2
      expect(satangToThb(149)).toBe(1); // 1.49 rounds to 1
      expect(satangToThb(99)).toBe(1);  // 0.99 rounds to 1
      expect(satangToThb(50)).toBe(1);  // 0.50 rounds to 1
      expect(satangToThb(49)).toBe(0);  // 0.49 rounds to 0
    });

    it('is inverse of thbToSatang for whole THB', () => {
      const testValues = [0, 1, 100, 290, 1500, 5000, 99999];
      for (const thb of testValues) {
        expect(satangToThb(thbToSatang(thb))).toBe(thb);
      }
    });
  });

  describe('STRIPE_CURRENCY', () => {
    it('is "thb"', () => {
      expect(STRIPE_CURRENCY).toBe('thb');
    });
  });
});
