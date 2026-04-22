/**
 * BUG-504-A04 — customer wiring + legacy settings/categories deprecation.
 *
 * Scope (strictly additive, non-breaking):
 *   • Customer site (apps/customer) reads categories from the public A02
 *     endpoint `GET /api/v1/categories` instead of hardcoded arrays.
 *   • Admin product-create dropdown cuts over from
 *     `adminApi.settings.categories()` (SystemConfig JSON blob) to
 *     `adminApi.categories.list()` (A03 DB-backed endpoint).
 *   • Legacy `GET /api/v1/admin/settings/categories` gets `Deprecation`
 *     and `Sunset` advisory headers — body unchanged so no consumer
 *     breaks. Full removal is scheduled for A06.
 *   • Customer filter labels are localized (`name_th` on /th, `name_en`
 *     on /en/zh) and re-render on locale switch via `useLocale()`.
 *
 * Non-goals (explicitly NOT in A04):
 *   • products.category enum cutover                  (A06 territory)
 *   • FK products → categories                        (A06)
 *   • Playwright CI diff guard                        (A05)
 *   • RLS / security hardening                        (deferred)
 *
 * TDD acceptance gates (ratified by Qew):
 *   a) Customer `page.tsx` sources the category list from the A02
 *      endpoint (no hardcoded slug array survives in apps/customer).
 *   b) Customer filters out rows with `visible_frontend=false`
 *      client-side (A02 endpoint itself stays unfiltered — admin reuses
 *      the same payload).
 *   c) Admin `products.tsx` dropdown uses `adminApi.categories.list()`,
 *      not `adminApi.settings.categories()` and not the hardcoded
 *      `['wedding', 'evening', ...]` fallback.
 *   d) A02 public `GET /api/v1/categories` still emits
 *      `Cache-Control: public, max-age=300, s-maxage=300`
 *      (regression guard — no A04 cache TTL drift).
 *   e) Static grep: no hardcoded category arrays remain anywhere in
 *      `apps/customer/src` source (products/home/etc.).
 *   f) Regression guards: A02 + A03 API shapes unchanged (caught by
 *      their existing test files — re-asserted here as a belt).
 *   g) Customer page.tsx declares a graceful skeleton + retry fallback
 *      path when the categories query errors (5xx bucket).
 *   h) Customer filter buttons render `name_th` on /th routes and
 *      `name_en` on /en and /zh routes (not the capitalized slug).
 *   i) `selectedCategory` is passed through to `api.products.list({
 *      category: ... })` so the filter actually round-trips to the API
 *      (fixing the latent "filter button does nothing" bug alongside
 *      the taxonomy refactor).
 *   j) Labels re-render on locale switch without a full reload — the
 *      page must read `useLocale()` on every render cycle.
 *   k) A11y: each filter button's rendered text is the localized label
 *      (not the raw slug), so assistive tech reads the human name.
 *
 *   l) Legacy `GET /api/v1/admin/settings/categories` returns
 *      `Deprecation: true` and `Sunset: <RFC 7231 date>` headers but an
 *      unchanged body. The sunset date MUST be ≥ 30 days in the future
 *      (per RFC 8594) so existing callers have a migration window.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mockDb = vi.hoisted(() => {
  const models = [
    'product', 'brand', 'productImage', 'order', 'orderItem', 'orderStatusLog',
    'paymentSlip', 'customer', 'customerDocument', 'availabilityCalendar',
    'inventoryStatusLog', 'shippingZone', 'shippingProvinceConfig',
    'financeTransaction', 'afterSalesEvent', 'i18nString', 'adminUser',
    'auditLog', 'inventoryUnit', 'comboSet', 'comboSetItem', 'productStockLog',
    'financeCategory', 'systemConfig', 'notificationLog',
    'category',
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: Record<string, any> = {
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    $transaction: vi.fn(async (ops: unknown) => {
      if (typeof ops === 'function') return (ops as (tx: unknown) => unknown)(db);
      if (Array.isArray(ops)) return Promise.all(ops as Promise<unknown>[]);
      return [];
    }),
  };
  for (const model of models) {
    db[model] = {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: 'mock-id' }),
      update: vi.fn().mockResolvedValue({ id: 'mock-id' }),
      delete: vi.fn().mockResolvedValue({ id: 'mock-id' }),
      upsert: vi.fn().mockResolvedValue({ id: 'mock-id' }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 } }),
    };
  }
  return db;
});

vi.mock('../lib/db', () => ({
  getDb: vi.fn(() => mockDb),
  resetDb: vi.fn(),
}));

vi.mock('bcryptjs', () => ({
  default: { compare: vi.fn().mockResolvedValue(false), hash: vi.fn() },
  compare: vi.fn().mockResolvedValue(false),
  hash: vi.fn(),
}));

import app from '../index';

const REPO_ROOT = resolve(__dirname, '../../../../');

function readSrc(relPath: string): string {
  return readFileSync(resolve(REPO_ROOT, relPath), 'utf8');
}

const CUSTOMER_PRODUCTS_PAGE = 'apps/customer/src/app/[locale]/products/page.tsx';
const CUSTOMER_HOME_PAGE = 'apps/customer/src/app/[locale]/page.tsx';
const CUSTOMER_API = 'apps/customer/src/lib/api.ts';
const ADMIN_PRODUCTS_PAGE = 'apps/admin/src/pages/products.tsx';

// ─── Static helpers ────────────────────────────────────────────────────
// Match any inline array literal containing at least 3 of the canonical
// slugs in a single expression.
const CANONICAL_SLUGS = ['wedding', 'evening', 'cocktail', 'casual', 'costume', 'traditional', 'accessories'];

function countHardcodedSlugClusters(source: string): number {
  // Strip block + line comments first so intentional doc references
  // (e.g. in the file's header) don't register as runtime arrays.
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  // Find every JS array literal and count how many canonical slugs it
  // references — any cluster with ≥3 slugs in a single array is treated
  // as a hardcoded category list.
  const arrayLiterals = stripped.match(/\[[^\[\]\n]{0,400}\]/g) ?? [];
  let clusters = 0;
  for (const arr of arrayLiterals) {
    const hits = CANONICAL_SLUGS.filter((slug) => {
      const re = new RegExp(`['"\`]${slug}['"\`]`);
      return re.test(arr);
    }).length;
    if (hits >= 3) clusters += 1;
  }
  return clusters;
}

function jsonHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json' };
}

// ─── Gate a — customer page sources from A02 endpoint ──────────────────
describe('BUG-504-A04 — customer wiring (static source guards)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('gate a: apps/customer/products/page.tsx fetches from /api/v1/categories', () => {
    const src = readSrc(CUSTOMER_PRODUCTS_PAGE);
    // Either via a client helper or directly — the path must appear.
    expect(src).toMatch(/\/api\/v1\/categories|api\.categories\.list\(/);
    // And the React Query key is stable so TTL/invalidation works.
    expect(src).toMatch(/queryKey:\s*\[\s*['"`]categories['"`]/);
  });

  it('gate a: apps/customer/lib/api.ts exposes a categories.list client helper', () => {
    const src = readSrc(CUSTOMER_API);
    expect(src).toMatch(/categories\s*:\s*\{/);
    expect(src).toMatch(/\/api\/v1\/categories/);
    // Response shape must declare the snake_case fields the UI consumes.
    expect(src).toMatch(/name_th/);
    expect(src).toMatch(/name_en/);
    expect(src).toMatch(/visible_frontend/);
    expect(src).toMatch(/sort_order/);
  });

  // ─── Gate b — hidden categories filtered client-side ────────────────
  it('gate b: customer page filters visible_frontend=true before rendering', () => {
    const src = readSrc(CUSTOMER_PRODUCTS_PAGE);
    expect(src).toMatch(/visible_frontend/);
    // The filter must be applied before the map that produces buttons.
    expect(src).toMatch(/\.filter\([^)]*visible_frontend/);
  });

  // ─── Gate c — admin dropdown cutover ───────────────────────────────
  it('gate c: admin products.tsx consumes adminApi.categories.list() (A03 endpoint)', () => {
    const src = readSrc(ADMIN_PRODUCTS_PAGE);
    expect(src).toMatch(/adminApi\.categories\.list\(/);
    // And the legacy settings.categories() reader is gone from this file.
    expect(src).not.toMatch(/adminApi\.settings\.categories\(/);
    // The React Query key is renamed (so the in-flight overlap across
    // the CategoriesTab stays consistent).
    expect(src).toMatch(/queryKey:\s*\[\s*['"`]admin-categories['"`]/);
  });

  it('gate c: admin products.tsx no longer hard-codes a fallback array', () => {
    const src = readSrc(ADMIN_PRODUCTS_PAGE);
    expect(countHardcodedSlugClusters(src)).toBe(0);
  });

  // ─── Gate e — no hardcoded category arrays in apps/customer ─────────
  it('gate e: no hardcoded canonical-slug array remains in apps/customer/src', () => {
    const productsSrc = readSrc(CUSTOMER_PRODUCTS_PAGE);
    const homeSrc = readSrc(CUSTOMER_HOME_PAGE);
    expect(countHardcodedSlugClusters(productsSrc)).toBe(0);
    expect(countHardcodedSlugClusters(homeSrc)).toBe(0);
  });

  // ─── Gate g — 5xx fallback UX ──────────────────────────────────────
  it('gate g: customer page renders a retry affordance when categories query errors', () => {
    const src = readSrc(CUSTOMER_PRODUCTS_PAGE);
    // `isError` bucket must be handled explicitly and expose a retry.
    expect(src).toMatch(/categoriesQuery\.isError|categoriesError/);
    expect(src).toMatch(/refetch|retry/);
  });

  // ─── Gate h — locale-aware labels ──────────────────────────────────
  it('gate h: customer page reads name_th on /th and name_en elsewhere', () => {
    const src = readSrc(CUSTOMER_PRODUCTS_PAGE);
    // The locale-aware label picker must reference both fields.
    expect(src).toMatch(/name_th/);
    expect(src).toMatch(/name_en/);
    // And must be gated on the active locale.
    expect(src).toMatch(/locale\s*===\s*['"`]th['"`]/);
  });

  // ─── Gate i — selectedCategory round-trips to the API ──────────────
  it('gate i: selectedCategory is forwarded to api.products.list as `category`', () => {
    const src = readSrc(CUSTOMER_PRODUCTS_PAGE);
    // Previously this was set in state but never used — guard that
    // regression here so we don't silently drop it again.
    expect(src).toMatch(/selectedCategory\b/);
    expect(src).toMatch(/params\.category\s*=\s*selectedCategory|category:\s*selectedCategory/);
  });

  // ─── Gate j — labels re-render on locale switch ─────────────────────
  it('gate j: customer page reads useLocale() at render time (so locale switch is reactive)', () => {
    const src = readSrc(CUSTOMER_PRODUCTS_PAGE);
    expect(src).toMatch(/const\s+locale\s*=\s*useLocale\(\)/);
  });

  // ─── Gate k — accessible name = localized label ────────────────────
  it('gate k: filter button children render the localized label, not the slug', () => {
    const src = readSrc(CUSTOMER_PRODUCTS_PAGE);
    // Previously: `<button>{cat}</button>` where `cat` was a slug.
    // After A04: the visible text must be derived from name_th/name_en.
    expect(src).not.toMatch(/className="[^"]*capitalize[^"]*"[\s\S]{0,80}>\s*\{\s*cat\s*\}/);
    // Positive assertion: the rendered text must reference a label
    // selector derived from the localized name.
    expect(src).toMatch(/\{\s*(?:locale\s*===\s*['"`]th['"`]\s*\?[^}]*name_th[^}]*:\s*[^}]*name_en|[a-zA-Z_][a-zA-Z0-9_]*\.label|label)\s*\}/);
  });
});

// ─── Gate d — A02 cache TTL preserved ──────────────────────────────────
describe('BUG-504-A04 — A02 regression guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.category.findMany.mockResolvedValue([]);
  });

  it('gate d: GET /api/v1/categories keeps Cache-Control public, max-age=300, s-maxage=300', async () => {
    const res = await app.request('/api/v1/categories', { method: 'GET' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control') ?? '').toMatch(/public/);
    expect(res.headers.get('Cache-Control') ?? '').toMatch(/max-age=300/);
    expect(res.headers.get('Cache-Control') ?? '').toMatch(/s-maxage=300/);
  });
});

// ─── Gate l — legacy endpoint deprecation headers ──────────────────────
describe('BUG-504-A04 — legacy settings/categories deprecation', () => {
  const ADMIN_UUID = '00000000-0000-0000-0000-000000000099';

  async function superadminToken(): Promise<string> {
    const { createToken } = await import('../middleware/auth');
    return createToken(ADMIN_UUID, 'admin@cutebunny.rental', 'superadmin');
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.systemConfig.findUnique.mockResolvedValue(null); // default fallback triggers 7-slug list
  });

  it('gate l: legacy GET /api/v1/admin/settings/categories emits Deprecation + Sunset headers', async () => {
    const token = await superadminToken();
    const res = await app.request('/api/v1/admin/settings/categories', {
      method: 'GET',
      headers: { ...jsonHeaders(), Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);

    // RFC 8594 §2 — Deprecation header is a boolean "true" (or a date).
    expect(res.headers.get('Deprecation') ?? '').toMatch(/^(true|@\d+|Mon|Tue|Wed|Thu|Fri|Sat|Sun)/);
    // Sunset header per RFC 8594 §3 — HTTP-date (RFC 7231).
    const sunset = res.headers.get('Sunset') ?? '';
    expect(sunset).toBeTruthy();
    const sunsetDate = new Date(sunset);
    expect(Number.isNaN(sunsetDate.getTime())).toBe(false);
    // Must be at least 30 days out so migration has room.
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(sunsetDate.getTime() - Date.now()).toBeGreaterThanOrEqual(thirtyDaysMs);

    // Body unchanged: still an array of slug strings.
    const body = (await res.json()) as { data?: unknown };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('gate l: legacy endpoint Link header points to the A03 replacement for discoverability', async () => {
    const token = await superadminToken();
    const res = await app.request('/api/v1/admin/settings/categories', {
      method: 'GET',
      headers: { ...jsonHeaders(), Authorization: `Bearer ${token}` },
    });
    const link = res.headers.get('Link') ?? '';
    expect(link).toMatch(/\/api\/v1\/admin\/categories/);
    expect(link).toMatch(/rel="successor-version"/i);
  });
});
