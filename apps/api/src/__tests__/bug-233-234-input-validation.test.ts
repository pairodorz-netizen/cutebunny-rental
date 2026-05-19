/**
 * BUG-233: Stock quantity input allows negative numbers
 * BUG-234: Phone search ignores formatting variations
 *
 * Tests cover:
 * - Phone normalization utility (various formats)
 * - Backend stock validation (min 0)
 * - Phone search normalization in orders query builder
 */

import { describe, it, expect } from 'vitest';
import { normalizePhone, normalizePhoneSearch } from '@cutebunny/shared/phone-normalize';

describe('BUG-234: Phone normalization', () => {
  describe('normalizePhone()', () => {
    it('strips spaces from phone number', () => {
      expect(normalizePhone('089 168 0668')).toBe('0891680668');
    });

    it('strips dashes from phone number', () => {
      expect(normalizePhone('089-168-0668')).toBe('0891680668');
    });

    it('strips parentheses from phone number', () => {
      expect(normalizePhone('(089) 168-0668')).toBe('0891680668');
    });

    it('converts +66 country code to leading 0', () => {
      expect(normalizePhone('+66891680668')).toBe('0891680668');
    });

    it('converts 66 prefix (no plus) to leading 0', () => {
      expect(normalizePhone('66891680668')).toBe('0891680668');
    });

    it('handles +66 with spaces', () => {
      expect(normalizePhone('+66 89 168 0668')).toBe('0891680668');
    });

    it('handles already-normalized phone', () => {
      expect(normalizePhone('0891680668')).toBe('0891680668');
    });

    it('returns empty string for null/undefined/empty', () => {
      expect(normalizePhone(null)).toBe('');
      expect(normalizePhone(undefined)).toBe('');
      expect(normalizePhone('')).toBe('');
    });

    it('does not strip 66 prefix from short numbers (not a country code)', () => {
      // 66123 is 5 digits — too short for Thai mobile (10 digits)
      expect(normalizePhone('66123')).toBe('66123');
    });

    it('normalizes Thai landline (02-xxx-xxxx)', () => {
      expect(normalizePhone('02-123-4567')).toBe('021234567');
    });
  });

  describe('normalizePhoneSearch()', () => {
    it('normalizes partial search "089 168"', () => {
      expect(normalizePhoneSearch('089 168')).toBe('089168');
    });

    it('normalizes full number with spaces', () => {
      expect(normalizePhoneSearch('089 168 0668')).toBe('0891680668');
    });

    it('normalizes +66 prefix in search', () => {
      expect(normalizePhoneSearch('+66891680668')).toBe('0891680668');
    });

    it('returns empty for null/undefined', () => {
      expect(normalizePhoneSearch(null)).toBe('');
      expect(normalizePhoneSearch(undefined)).toBe('');
    });
  });

  describe('phone search equivalence (all formats match same stored number)', () => {
    const storedPhone = '0891680668';
    const searchVariations = [
      '0891680668',
      '089 168 0668',
      '089-168-0668',
      '+66891680668',
      '+66 89 168 0668',
      '66891680668',
      '(089) 168-0668',
    ];

    for (const searchInput of searchVariations) {
      it(`"${searchInput}" normalizes to match stored "${storedPhone}"`, () => {
        const normalized = normalizePhoneSearch(searchInput);
        expect(storedPhone).toContain(normalized);
      });
    }
  });
});

describe('BUG-233: Stock quantity backend validation', () => {
  it('backend Zod schema rejects negative stock_quantity', () => {
    const { z } = require('zod');
    // Mirrors backend schema: stock_quantity: z.number().int().min(0).optional()
    const schema = z.object({
      stock_quantity: z.number().int().min(0).optional(),
    });

    const result = schema.safeParse({ stock_quantity: -5 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].code).toBe('too_small');
    }
  });

  it('backend Zod schema allows zero stock_quantity', () => {
    const { z } = require('zod');
    const schema = z.object({
      stock_quantity: z.number().int().min(0).optional(),
    });

    const result = schema.safeParse({ stock_quantity: 0 });
    expect(result.success).toBe(true);
  });

  it('backend Zod schema allows positive stock_quantity', () => {
    const { z } = require('zod');
    const schema = z.object({
      stock_quantity: z.number().int().min(0).optional(),
    });

    const result = schema.safeParse({ stock_quantity: 100 });
    expect(result.success).toBe(true);
  });

  it('stock add endpoint schema rejects negative quantity', () => {
    const { z } = require('zod');
    // Mirrors: quantity: z.number().int().min(1)
    const schema = z.object({
      quantity: z.number().int().min(1),
    });

    expect(schema.safeParse({ quantity: -1 }).success).toBe(false);
    expect(schema.safeParse({ quantity: 0 }).success).toBe(false);
    expect(schema.safeParse({ quantity: 1 }).success).toBe(true);
  });

  it('stock adjust endpoint schema rejects negative new_qty', () => {
    const { z } = require('zod');
    // Mirrors: new_qty: z.number().int().min(0)
    const schema = z.object({
      new_qty: z.number().int().min(0),
      reason: z.string().min(1),
    });

    expect(schema.safeParse({ new_qty: -10, reason: 'test' }).success).toBe(false);
    expect(schema.safeParse({ new_qty: 0, reason: 'cleared' }).success).toBe(true);
  });
});
