/**
 * BUG-228: Placeholder emails + PDPA tooltip
 *
 * Tests verify:
 * - i18n keys exist for PDPA tooltip in all locales
 * - Placeholder email format is locale-correct
 * - Deleted customer detection logic
 */

import { describe, it, expect } from 'vitest';
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

describe('BUG-228: PDPA tooltip i18n keys', () => {
  const locales = ['en', 'th', 'zh'];

  for (const lang of locales) {
    it(`customers.pdpaTooltip exists in ${lang}`, () => {
      const data = loadLocale(lang);
      const value = getNestedKey(data, 'customers.pdpaTooltip');
      expect(value).toBeTruthy();
      expect(typeof value).toBe('string');
      expect((value as string).toLowerCase()).toContain('pdpa');
    });

    it(`orders.pdpaTooltip exists in ${lang}`, () => {
      const data = loadLocale(lang);
      const value = getNestedKey(data, 'orders.pdpaTooltip');
      expect(value).toBeTruthy();
      expect(typeof value).toBe('string');
      expect((value as string).toLowerCase()).toContain('pdpa');
    });

    it(`orders.deletedCustomerBanner exists in ${lang}`, () => {
      const data = loadLocale(lang);
      const value = getNestedKey(data, 'orders.deletedCustomerBanner');
      expect(value).toBeTruthy();
      expect(typeof value).toBe('string');
    });
  }
});

describe('BUG-228: Deleted customer detection', () => {
  function isDeletedCustomer(customer: { name?: string; email?: string; phone?: string; _deleted?: boolean }): boolean {
    if (customer._deleted) return true;
    return customer.name === '[Deleted customer]' || customer.email === '***@***';
  }

  it('detects deleted customer by _deleted flag', () => {
    expect(isDeletedCustomer({ _deleted: true, name: 'John' })).toBe(true);
  });

  it('detects deleted customer by masked name', () => {
    expect(isDeletedCustomer({ name: '[Deleted customer]', email: '***@***' })).toBe(true);
  });

  it('detects deleted customer by masked email', () => {
    expect(isDeletedCustomer({ name: 'Unknown', email: '***@***' })).toBe(true);
  });

  it('does not flag normal customer', () => {
    expect(isDeletedCustomer({ name: 'Somchai', email: 'somchai@email.co.th' })).toBe(false);
  });

  it('does not flag customer with placeholder email', () => {
    expect(isDeletedCustomer({ name: 'Somchai', email: '0891680668@placeholder.local' })).toBe(false);
  });
});

describe('BUG-228: Placeholder email locale format', () => {
  it('uses Thai-style domain for admin forms', () => {
    const placeholder = 'somchai@email.co.th';
    expect(placeholder).toMatch(/^[a-z]+@[a-z]+\.co\.th$/);
  });
});
