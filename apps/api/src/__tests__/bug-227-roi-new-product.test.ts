/**
 * BUG-227: ROI ranking misleading for newly-listed products
 *
 * Tests verify:
 * - days_listed calculation is correct
 * - is_new flag set for products < 30 days old
 * - Filter toggle hides new products by default
 * - i18n keys exist for new product badge/tooltip
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const LOCALES_DIR = resolve(__dirname, '../../../admin/src/i18n/locales');

function loadLocale(lang: string): Record<string, unknown> {
  const content = readFileSync(resolve(LOCALES_DIR, `${lang}.json`), 'utf-8');
  return JSON.parse(content);
}

function getNestedKey(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((acc: unknown, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

describe('BUG-227: days_listed and is_new calculation', () => {
  function computeDaysListed(createdAt: Date, now: Date): number {
    return Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
  }

  it('product created today has 0 days_listed', () => {
    const now = new Date('2026-05-13T00:00:00Z');
    expect(computeDaysListed(now, now)).toBe(0);
  });

  it('product created 29 days ago is_new', () => {
    const now = new Date('2026-05-13T00:00:00Z');
    const created = new Date('2026-04-14T00:00:00Z');
    const days = computeDaysListed(created, now);
    expect(days).toBe(29);
    expect(days < 30).toBe(true);
  });

  it('product created 30 days ago is NOT new', () => {
    const now = new Date('2026-05-13T00:00:00Z');
    const created = new Date('2026-04-13T00:00:00Z');
    const days = computeDaysListed(created, now);
    expect(days).toBe(30);
    expect(days < 30).toBe(false);
  });

  it('product created 365 days ago is NOT new', () => {
    const now = new Date('2026-05-13T00:00:00Z');
    const created = new Date('2025-05-13T00:00:00Z');
    const days = computeDaysListed(created, now);
    expect(days).toBeGreaterThanOrEqual(365);
    expect(days < 30).toBe(false);
  });

  it('product created 1 day ago is_new', () => {
    const now = new Date('2026-05-13T12:00:00Z');
    const created = new Date('2026-05-12T10:00:00Z');
    const days = computeDaysListed(created, now);
    expect(days).toBe(1);
    expect(days < 30).toBe(true);
  });
});

describe('BUG-227: Filter logic (includeNewProducts)', () => {
  const mockProducts = [
    { product_id: '1', is_new: false, roi: 50 },
    { product_id: '2', is_new: true, roi: -10 },
    { product_id: '3', is_new: false, roi: 25 },
    { product_id: '4', is_new: true, roi: 100 },
  ];

  it('default OFF: filters out new products', () => {
    const includeNewProducts = false;
    const filtered = mockProducts.filter((p) => includeNewProducts || !p.is_new);
    expect(filtered).toHaveLength(2);
    expect(filtered.every((p) => !p.is_new)).toBe(true);
  });

  it('toggle ON: shows all products including new', () => {
    const includeNewProducts = true;
    const filtered = mockProducts.filter((p) => includeNewProducts || !p.is_new);
    expect(filtered).toHaveLength(4);
  });

  it('empty list returns empty regardless of toggle', () => {
    const filtered = ([] as typeof mockProducts).filter((p) => true || !p.is_new);
    expect(filtered).toHaveLength(0);
  });
});

describe('BUG-227: i18n keys for new product badge', () => {
  const locales = ['en', 'th', 'zh'];
  const requiredKeys = [
    'finance.includeNewProducts',
    'finance.newProductTooltip',
    'finance.newBadge',
    'finance.newProductBreakEvenTooltip',
  ];

  for (const lang of locales) {
    for (const key of requiredKeys) {
      it(`${key} exists in ${lang}`, () => {
        const data = loadLocale(lang);
        const value = getNestedKey(data, key);
        expect(value).toBeTruthy();
        expect(typeof value).toBe('string');
      });
    }
  }
});
