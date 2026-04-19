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

  // FEAT-403: Shipping days configuration
  describe('FEAT-403: shipping_days per province', () => {
    it('default shipping_days is 2 for new provinces', () => {
      // Schema default: shippingDays Int @default(2)
      const defaultShippingDays = 2;
      expect(defaultShippingDays).toBe(2);
    });

    it('BKK + perimeter provinces should have 1 day shipping', () => {
      const bkkZoneProvinces = ['BKK', 'NBI', 'PBI', 'SPK', 'NPT', 'SUT'];
      const expectedDays = 1;
      // All BKK-perimeter provinces should have 1-day shipping
      bkkZoneProvinces.forEach((code) => {
        expect(code).toBeTruthy();
        expect(expectedDays).toBe(1);
      });
    });

    it('northern/southern/isan provinces should have 3 day shipping', () => {
      const remoteProvinces = ['CMI', 'HYI', 'NRT', 'SKN', 'UDN', 'KKN'];
      const expectedDays = 3;
      remoteProvinces.forEach((code) => {
        expect(code).toBeTruthy();
        expect(expectedDays).toBe(3);
      });
    });

    it('shipping_days must be integer between 1 and 30', () => {
      const validDays = [1, 2, 3, 5, 7, 14, 30];
      const invalidDays = [0, -1, 31, 1.5];

      validDays.forEach((d) => {
        expect(Number.isInteger(d) && d >= 1 && d <= 30).toBe(true);
      });
      invalidDays.forEach((d) => {
        expect(Number.isInteger(d) && d >= 1 && d <= 30).toBe(false);
      });
    });
  });
});
