/**
 * BUG-AUDIT-UI-A01 — i18n parity gate (gate 8 of 8).
 *
 * Reads the three admin locale files from disk and asserts the new
 * `settings.audit.*` key tree exists in EN, TH, and ZH with identical
 * shape. This is the i18n key snapshot per the user-approved plan and
 * pins the regression: any future locale edit that drops or mistypes
 * one of these keys fails CI here, before the user ever sees a raw
 * key like `settings.audit.filters.dateFrom` rendered in the UI.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LOCALES = ['en', 'th', 'zh'] as const;

function loadLocale(name: string): Record<string, unknown> {
  const p = resolve(
    __dirname,
    '../../../admin/src/i18n/locales',
    `${name}.json`,
  );
  return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
}

// Walk a leaf-only key list. Each entry is a dot-path that must
// resolve to a non-empty string in every locale.
const REQUIRED_KEYS = [
  'settings.audit.filters.dateFrom',
  'settings.audit.filters.dateTo',
  'settings.audit.filters.section',
  'settings.audit.filters.actor',
  'settings.audit.filters.actorAll',
  'settings.audit.filters.search',
  'settings.audit.filters.searchPlaceholder',
  'settings.audit.section.finance',
  'settings.audit.section.calendar',
  'settings.audit.section.shipping',
  'settings.audit.section.customer_ux',
  'settings.audit.section.general',
  'settings.audit.column.section',
  'settings.audit.column.key',
  'settings.audit.action.CREATE',
  'settings.audit.action.UPDATE',
  'settings.audit.action.DELETE',
];

function getPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => {
    if (acc && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[k];
    }
    return undefined;
  }, obj);
}

describe('BUG-AUDIT-UI-A01 — i18n parity (gate 8)', () => {
  const locales = Object.fromEntries(
    LOCALES.map((n) => [n, loadLocale(n)]),
  ) as Record<(typeof LOCALES)[number], Record<string, unknown>>;

  for (const key of REQUIRED_KEYS) {
    it(`every locale defines ${key}`, () => {
      for (const lang of LOCALES) {
        const v = getPath(locales[lang], key);
        expect(
          typeof v === 'string' && v.length > 0,
          `${lang}.json missing ${key}`,
        ).toBe(true);
      }
    });
  }
});
