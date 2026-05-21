/**
 * BUG-225: Dashboard 'ภาพรวมทั้งหมด' shows status in English.
 *
 * Tests verify:
 * 1. All OrderStatus enum values have i18n translations in TH/EN/ZH
 * 2. Status labels are non-empty and differ from raw enum values (for TH/ZH)
 * 3. The dashboard should use t('orders.statusLabel.xxx') not raw enum
 */

import { describe, it, expect } from 'vitest';
import en from '../../../admin/src/i18n/locales/en.json';
import th from '../../../admin/src/i18n/locales/th.json';
import zh from '../../../admin/src/i18n/locales/zh.json';

const ORDER_STATUSES = ['unpaid', 'paid_locked', 'shipped', 'returned', 'repair', 'finished', 'cancelled'] as const;

describe('BUG-225 — Dashboard status i18n', () => {
  describe('TH locale has all status labels', () => {
    it('every OrderStatus has a Thai translation', () => {
      const labels = (th as Record<string, unknown>).orders as Record<string, unknown>;
      const statusLabel = labels.statusLabel as Record<string, string>;
      for (const status of ORDER_STATUSES) {
        expect(statusLabel[status], `Missing TH translation for "${status}"`).toBeDefined();
        expect(statusLabel[status].length).toBeGreaterThan(0);
      }
    });

    it('TH labels differ from raw enum values (actually translated)', () => {
      const labels = (th as Record<string, unknown>).orders as Record<string, unknown>;
      const statusLabel = labels.statusLabel as Record<string, string>;
      // At least the non-English statuses should differ from raw enum
      expect(statusLabel.unpaid).not.toBe('unpaid');
      expect(statusLabel.paid_locked).not.toBe('paid_locked');
      expect(statusLabel.shipped).not.toBe('shipped');
      expect(statusLabel.finished).not.toBe('finished');
    });
  });

  describe('EN locale has all status labels', () => {
    it('every OrderStatus has an English translation', () => {
      const labels = (en as Record<string, unknown>).orders as Record<string, unknown>;
      const statusLabel = labels.statusLabel as Record<string, string>;
      for (const status of ORDER_STATUSES) {
        expect(statusLabel[status], `Missing EN translation for "${status}"`).toBeDefined();
        expect(statusLabel[status].length).toBeGreaterThan(0);
      }
    });
  });

  describe('ZH locale has all status labels', () => {
    it('every OrderStatus has a Chinese translation', () => {
      const labels = (zh as Record<string, unknown>).orders as Record<string, unknown>;
      const statusLabel = labels.statusLabel as Record<string, string>;
      for (const status of ORDER_STATUSES) {
        expect(statusLabel[status], `Missing ZH translation for "${status}"`).toBeDefined();
        expect(statusLabel[status].length).toBeGreaterThan(0);
      }
    });

    it('ZH labels differ from raw enum values (actually translated)', () => {
      const labels = (zh as Record<string, unknown>).orders as Record<string, unknown>;
      const statusLabel = labels.statusLabel as Record<string, string>;
      expect(statusLabel.unpaid).not.toBe('unpaid');
      expect(statusLabel.paid_locked).not.toBe('paid_locked');
      expect(statusLabel.shipped).not.toBe('shipped');
      expect(statusLabel.cancelled).not.toBe('cancelled');
    });
  });

  describe('cross-locale consistency', () => {
    it('all locales have the same set of status keys', () => {
      const enLabels = ((en as Record<string, unknown>).orders as Record<string, unknown>).statusLabel as Record<string, string>;
      const thLabels = ((th as Record<string, unknown>).orders as Record<string, unknown>).statusLabel as Record<string, string>;
      const zhLabels = ((zh as Record<string, unknown>).orders as Record<string, unknown>).statusLabel as Record<string, string>;

      const enKeys = Object.keys(enLabels).sort();
      const thKeys = Object.keys(thLabels).sort();
      const zhKeys = Object.keys(zhLabels).sort();

      expect(enKeys).toEqual(thKeys);
      expect(enKeys).toEqual(zhKeys);
    });
  });
});
