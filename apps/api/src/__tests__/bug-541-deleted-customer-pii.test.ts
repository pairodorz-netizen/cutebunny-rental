/**
 * BUG-541: Mask PII of soft-deleted customers.
 *
 * Soft-deleted customers are identified by email prefix 'deleted_'.
 * Their name, email, phone, and address must be masked in API responses.
 * Orders of deleted customers must still be visible but PII must not
 * be searchable.
 */

import { describe, it, expect } from 'vitest';
import {
  isCustomerDeleted,
  customerDisplayName,
  customerDisplayEmail,
  customerDisplayPhone,
  maskCustomerPII,
} from '@cutebunny/shared/customer-pii';

describe('BUG-541: Deleted customer PII masking helpers', () => {
  describe('isCustomerDeleted', () => {
    it('returns true for soft-deleted email prefix', () => {
      expect(isCustomerDeleted('deleted_1777274315688_malee.cm@example.com')).toBe(true);
      expect(isCustomerDeleted('deleted_1777274320001_somchai.bkk@example.com')).toBe(true);
    });

    it('returns false for active customer email', () => {
      expect(isCustomerDeleted('pairodorz@gmail.com')).toBe(false);
      expect(isCustomerDeleted('0894658255@placeholder.local')).toBe(false);
    });
  });

  describe('customerDisplayName', () => {
    it('returns "[Deleted customer]" for soft-deleted customers', () => {
      expect(customerDisplayName('มาลี', 'ดอกไม้', 'deleted_123_malee@test.com')).toBe('[Deleted customer]');
    });

    it('returns full name for active customers', () => {
      expect(customerDisplayName('ไพโรจน์', 'ทรงดำรงทัศน์', 'pairodorz@gmail.com')).toBe('ไพโรจน์ ทรงดำรงทัศน์');
    });
  });

  describe('customerDisplayEmail', () => {
    it('returns "***@***" for soft-deleted customers', () => {
      expect(customerDisplayEmail('deleted_123_malee@test.com')).toBe('***@***');
    });

    it('returns real email for active customers', () => {
      expect(customerDisplayEmail('pairodorz@gmail.com')).toBe('pairodorz@gmail.com');
    });
  });

  describe('customerDisplayPhone', () => {
    it('returns "***-***-****" for soft-deleted customers', () => {
      expect(customerDisplayPhone('0898765432', 'deleted_123_malee@test.com')).toBe('***-***-****');
    });

    it('returns real phone for active customers', () => {
      expect(customerDisplayPhone('0999999999', 'pairodorz@gmail.com')).toBe('0999999999');
    });

    it('returns null for active customers with no phone', () => {
      expect(customerDisplayPhone(null, 'pairodorz@gmail.com')).toBeNull();
    });
  });

  describe('maskCustomerPII', () => {
    const deletedCustomer = {
      firstName: 'มาลี',
      lastName: 'ดอกไม้',
      email: 'deleted_1777274315688_malee.cm@example.com',
      phone: '0898765432',
      address: { line1: '123 Main St' },
    };

    const activeCustomer = {
      firstName: 'ไพโรจน์',
      lastName: 'ทรงดำรงทัศน์',
      email: 'pairodorz@gmail.com',
      phone: '0999999999',
      address: { line1: '456 Main St' },
    };

    it('masks all PII fields for deleted customer', () => {
      const masked = maskCustomerPII(deletedCustomer);
      expect(masked.firstName).toBe('[Deleted');
      expect(masked.lastName).toBe('customer]');
      expect(masked.email).toBe('***@***');
      expect(masked.phone).toBe('***-***-****');
      expect(masked.address).toEqual({});
      expect(masked._deleted).toBe(true);
    });

    it('preserves all fields for active customer', () => {
      const result = maskCustomerPII(activeCustomer);
      expect(result.firstName).toBe('ไพโรจน์');
      expect(result.lastName).toBe('ทรงดำรงทัศน์');
      expect(result.email).toBe('pairodorz@gmail.com');
      expect(result.phone).toBe('0999999999');
      expect(result.address).toEqual({ line1: '456 Main St' });
      expect(result._deleted).toBe(false);
    });
  });
});
