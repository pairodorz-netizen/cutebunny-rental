/**
 * BUG-511 — Admin i18n completeness guard.
 *
 * Scans all admin .tsx/.ts source files for t('key.path') calls,
 * then asserts every referenced key exists in ALL locale files (EN, TH, ZH).
 *
 * This prevents regressions like the `products.size` literal key showing
 * in the order detail table header (BUG-511).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const LOCALES = ['en', 'th', 'zh'] as const;
const ADMIN_SRC = resolve(__dirname, '../../../admin/src');
const LOCALE_DIR = resolve(ADMIN_SRC, 'i18n/locales');

function loadLocale(name: string): Record<string, unknown> {
  const p = resolve(LOCALE_DIR, `${name}.json`);
  return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
}

function walkDir(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkDir(full));
    } else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

function resolveKey(obj: Record<string, unknown>, dotPath: string): unknown {
  const parts = dotPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

describe('BUG-511: Admin i18n completeness guard', () => {
  const locales = Object.fromEntries(
    LOCALES.map((l) => [l, loadLocale(l)]),
  );

  // Extract all t('...') keys from admin source
  const allFiles = walkDir(ADMIN_SRC);
  const keyRegex = /t\('([a-zA-Z][a-zA-Z0-9_.]+)'\)/g;
  const usedKeys = new Set<string>();

  for (const file of allFiles) {
    const content = readFileSync(file, 'utf8');
    let match: RegExpExecArray | null;
    while ((match = keyRegex.exec(content)) !== null) {
      const key = match[1];
      if (key.includes('.')) {
        usedKeys.add(key);
      }
    }
  }

  it('should find at least 50 unique i18n keys in admin source', () => {
    expect(usedKeys.size).toBeGreaterThanOrEqual(50);
  });

  for (const locale of LOCALES) {
    it(`should have all referenced keys in ${locale}.json`, () => {
      const missing: string[] = [];
      for (const key of [...usedKeys].sort()) {
        const value = resolveKey(locales[locale], key);
        if (value === undefined) {
          missing.push(key);
        }
      }
      expect(missing, `Missing keys in ${locale}.json:\n  ${missing.join('\n  ')}`).toEqual([]);
    });
  }

  // Specific regression test for BUG-511
  it('should NOT reference products.size (should be orders.size)', () => {
    const ordersFile = allFiles.find((f) => f.endsWith('orders.tsx'));
    expect(ordersFile).toBeDefined();
    const content = readFileSync(ordersFile!, 'utf8');
    expect(content).not.toContain("t('products.size')");
  });

  // Verify locale parity: all 3 locales have identical key structure
  it('should have matching key structure across EN, TH, ZH', () => {
    function getLeafKeys(obj: unknown, prefix = ''): string[] {
      if (typeof obj !== 'object' || obj === null) return [prefix];
      const keys: string[] = [];
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        keys.push(...getLeafKeys(v, prefix ? `${prefix}.${k}` : k));
      }
      return keys;
    }

    const enKeys = new Set(getLeafKeys(locales.en));
    const thKeys = new Set(getLeafKeys(locales.th));
    const zhKeys = new Set(getLeafKeys(locales.zh));

    const inEnNotTh = [...enKeys].filter((k) => !thKeys.has(k));
    const inEnNotZh = [...enKeys].filter((k) => !zhKeys.has(k));
    const inThNotEn = [...thKeys].filter((k) => !enKeys.has(k));
    const inZhNotEn = [...zhKeys].filter((k) => !enKeys.has(k));

    expect(inEnNotTh, `Keys in EN missing from TH:\n  ${inEnNotTh.join('\n  ')}`).toEqual([]);
    expect(inEnNotZh, `Keys in EN missing from ZH:\n  ${inEnNotZh.join('\n  ')}`).toEqual([]);
    expect(inThNotEn, `Keys in TH missing from EN:\n  ${inThNotEn.join('\n  ')}`).toEqual([]);
    expect(inZhNotEn, `Keys in ZH missing from EN:\n  ${inZhNotEn.join('\n  ')}`).toEqual([]);
  });
});
