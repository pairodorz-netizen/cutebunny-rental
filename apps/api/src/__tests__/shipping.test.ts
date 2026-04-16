import { describe, it, expect } from 'vitest';
import { calculateShippingFeeSync } from '../lib/shipping';

describe('Shipping Fee Calculation', () => {
  describe('calculateShippingFeeSync', () => {
    it('calculates total as base + addon', () => {
      expect(calculateShippingFeeSync(50, 0)).toBe(50);
    });

    it('includes addon fee', () => {
      expect(calculateShippingFeeSync(50, 20)).toBe(70);
    });

    it('handles zero fees', () => {
      expect(calculateShippingFeeSync(0, 0)).toBe(0);
    });

    it('handles nationwide with high addon', () => {
      expect(calculateShippingFeeSync(150, 80)).toBe(230);
    });

    it('handles item count parameter without affecting base calculation', () => {
      expect(calculateShippingFeeSync(100, 30, 3)).toBe(130);
    });
  });
});
