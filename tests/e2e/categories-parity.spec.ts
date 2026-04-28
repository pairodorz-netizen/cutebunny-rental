// BUG-504-A05 — customer ↔ API categories parity guard.
// BUG-504-A07 — admin-side parity + A06.5 DriftBanner surface check.
//
// This is the Playwright diff check that locks in the A04 invariant:
// the customer filter UI is a thin projection of the A02 public
// `/api/v1/categories` endpoint. Any future regression (capitalized
// slug, hardcoded array drift, hidden-row leak, sort-order flip)
// fails one of the gates below.
//
// Gates 7 + 8 assert admin-side parity. They require a read-capable
// admin JWT in `ADMIN_JWT_PROD` (see `.env.example` + the CI secret
// of the same name). When the env var is missing the gates skip
// gracefully so local contributors can still run the public gates.

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const API_BASE =
  process.env.E2E_API_URL ||
  'https://cutebunny-api.cutebunny-rental.workers.dev';
const ADMIN_BASE =
  process.env.E2E_ADMIN_URL ||
  'https://admin-eight-rouge.vercel.app';
const ADMIN_JWT = process.env.ADMIN_JWT_PROD ?? '';

interface ApiCategory {
  id: string;
  slug: string;
  name_th: string;
  name_en: string;
  sort_order: number;
  visible_frontend: boolean;
  visible_backend: boolean;
}

async function fetchApiCategories(
  request: APIRequestContext,
): Promise<ApiCategory[]> {
  const res = await request.get(`${API_BASE}/api/v1/categories`);
  expect(
    res.status(),
    `A02 GET /api/v1/categories must return 200, got ${res.status()}`,
  ).toBe(200);
  const payload = (await res.json()) as { data: ApiCategory[] };
  expect(
    Array.isArray(payload?.data),
    'A02 envelope must be { data: [] }',
  ).toBe(true);
  return payload.data;
}

async function readRenderedCategoryButtons(
  page: Page,
): Promise<Array<{ slug: string; label: string }>> {
  const locator = page.locator('[data-testid="category-filter-option"]');
  await locator.first().waitFor({ state: 'visible', timeout: 30_000 });
  return locator.evaluateAll((els) =>
    els.map((el) => ({
      slug: (el as HTMLElement).dataset.slug ?? '',
      label: (el.textContent ?? '').trim(),
    })),
  );
}

/** Navigate to a products page and wait for the categories API to respond. */
async function gotoProductsPage(page: Page, path: string): Promise<void> {
  await Promise.all([
    page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/categories') && resp.status() === 200,
      { timeout: 30_000 },
    ),
    page.goto(path, { waitUntil: 'domcontentloaded' }),
  ]);
}

test.describe('BUG-504-A05 categories parity (customer ↔ API)', () => {
  let apiCategories: ApiCategory[];
  let visibleApiCategories: ApiCategory[];

  test.beforeAll(async ({ request }) => {
    apiCategories = await fetchApiCategories(request);
    visibleApiCategories = apiCategories
      .filter((c) => c.visible_frontend)
      .sort((a, b) => a.sort_order - b.sort_order);
    expect(
      visibleApiCategories.length,
      'A02 must return ≥1 visible category for the parity guard to be meaningful',
    ).toBeGreaterThan(0);
  });

  test('gate 1 — every visible API slug is rendered on /th/products', async ({
    page,
  }) => {
    await gotoProductsPage(page, '/th/products');
    const rendered = await readRenderedCategoryButtons(page);
    const renderedSlugs = new Set(rendered.map((r) => r.slug));
    const missing = visibleApiCategories
      .map((c) => c.slug)
      .filter((slug) => !renderedSlugs.has(slug));
    expect(
      missing,
      `missing slugs on customer /th/products: ${JSON.stringify(missing)}`,
    ).toEqual([]);
  });

  test('gate 2 — no slug is rendered that is not in the API list', async ({
    page,
  }) => {
    await gotoProductsPage(page, '/th/products');
    const rendered = await readRenderedCategoryButtons(page);
    const apiSlugs = new Set(apiCategories.map((c) => c.slug));
    const extra = rendered
      .map((r) => r.slug)
      .filter((slug) => slug.length > 0 && !apiSlugs.has(slug));
    expect(
      extra,
      `customer /th/products renders slugs not present in API: ${JSON.stringify(extra)}`,
    ).toEqual([]);
  });

  test('gate 3 — filter buttons preserve API sort_order ASC', async ({
    page,
  }) => {
    await gotoProductsPage(page, '/th/products');
    const rendered = await readRenderedCategoryButtons(page);
    const expected = visibleApiCategories.map((c) => c.slug);
    const actual = rendered.map((r) => r.slug);
    expect(actual).toEqual(expected);
  });

  test('gate 4 — visible_frontend=false categories do NOT leak to customer', async ({
    page,
  }) => {
    await gotoProductsPage(page, '/th/products');
    const rendered = await readRenderedCategoryButtons(page);
    const hiddenSlugs = apiCategories
      .filter((c) => !c.visible_frontend)
      .map((c) => c.slug);
    const leaked = rendered
      .map((r) => r.slug)
      .filter((slug) => hiddenSlugs.includes(slug));
    expect(
      leaked,
      `hidden slugs leaked to customer: ${JSON.stringify(leaked)}`,
    ).toEqual([]);
  });

  test('gate 5 — label text equals name_th on /th (no capitalized-slug regression)', async ({
    page,
  }) => {
    await gotoProductsPage(page, '/th/products');
    const rendered = await readRenderedCategoryButtons(page);
    expect(rendered.length).toBeGreaterThan(0);
    for (const entry of rendered) {
      const api = visibleApiCategories.find((c) => c.slug === entry.slug);
      expect(api, `slug ${entry.slug} must exist in API`).toBeDefined();
      expect(
        entry.label,
        `label for ${entry.slug} should be name_th (${api!.name_th})`,
      ).toBe(api!.name_th);
      // Tight capitalized-slug regression guard.
      const titled = entry.slug.charAt(0).toUpperCase() + entry.slug.slice(1);
      expect(
        entry.label,
        `label for ${entry.slug} must not be the raw slug`,
      ).not.toBe(entry.slug);
      expect(
        entry.label,
        `label for ${entry.slug} must not be the capitalized slug "${titled}"`,
      ).not.toBe(titled);
    }
  });

  test('gate 6 — /en/products renders name_en (locale switch keeps parity)', async ({
    page,
  }) => {
    await gotoProductsPage(page, '/en/products');
    const rendered = await readRenderedCategoryButtons(page);
    expect(rendered.length).toBeGreaterThan(0);
    for (const entry of rendered) {
      const api = visibleApiCategories.find((c) => c.slug === entry.slug);
      expect(api).toBeDefined();
      expect(entry.label).toBe(api!.name_en);
    }
  });

  // ─── Gate 7 — admin /api/v1/admin/categories parity ────────────────
  // The admin endpoint is allowed to expose rows with
  // visible_frontend=false (hidden from customers), so the assertion
  // is framed as: every public slug MUST exist in admin, and on the
  // common intersection slugs, `name_th` / `name_en` / `sort_order`
  // must match byte-for-byte. Anything else is drift.
  test('gate 7 — admin /api/v1/admin/categories parity with public (needs ADMIN_JWT_PROD)', async ({
    request,
  }) => {
    test.skip(
      !ADMIN_JWT,
      'ADMIN_JWT_PROD not set; skipping admin-side parity (BUG-504-A07 provisions this in CI)',
    );
    const res = await request.get(`${API_BASE}/api/v1/admin/categories`, {
      headers: { Authorization: `Bearer ${ADMIN_JWT}` },
    });
    expect(
      res.status(),
      `GET /api/v1/admin/categories must return 200 (got ${res.status()}). If 401, ADMIN_JWT_PROD is expired or invalid.`,
    ).toBe(200);
    const payload = (await res.json()) as { data: ApiCategory[] };
    const adminCats = payload.data;
    expect(Array.isArray(adminCats), 'admin envelope must be { data: [] }').toBe(true);

    const adminBySlug = new Map(adminCats.map((c) => [c.slug, c]));
    const missingInAdmin = apiCategories
      .map((c) => c.slug)
      .filter((s) => !adminBySlug.has(s));
    expect(
      missingInAdmin,
      `public slugs missing from admin endpoint: ${JSON.stringify(missingInAdmin)}`,
    ).toEqual([]);

    const labelMismatches: Array<{
      slug: string;
      field: 'name_th' | 'name_en' | 'sort_order';
      admin: unknown;
      public: unknown;
    }> = [];
    for (const pub of apiCategories) {
      const adm = adminBySlug.get(pub.slug)!;
      if (adm.name_th !== pub.name_th) {
        labelMismatches.push({ slug: pub.slug, field: 'name_th', admin: adm.name_th, public: pub.name_th });
      }
      if (adm.name_en !== pub.name_en) {
        labelMismatches.push({ slug: pub.slug, field: 'name_en', admin: adm.name_en, public: pub.name_en });
      }
      if (adm.sort_order !== pub.sort_order) {
        labelMismatches.push({ slug: pub.slug, field: 'sort_order', admin: adm.sort_order, public: pub.sort_order });
      }
    }
    expect(
      labelMismatches,
      `admin vs public category drift: ${JSON.stringify(labelMismatches, null, 2)}`,
    ).toEqual([]);
  });

  // ─── Gate 8 — A06.5 DriftBanner surface check ──────────────────────
  // Boots the deployed admin SPA with a pre-seeded auth-storage entry
  // (the zustand persist key the admin uses) so React Query can fetch
  // with the bearer. When public and admin agree (steady state), the
  // banner MUST be absent. If a later regression reintroduces drift,
  // the A06.5 hook renders the banner — at which point gate 7 above
  // will also fail with the concrete field-level diff.
  test('gate 8 — A06.5 DriftBanner absent on parity (needs ADMIN_JWT_PROD)', async ({
    page,
  }) => {
    test.skip(
      !ADMIN_JWT,
      'ADMIN_JWT_PROD not set; skipping admin SPA banner check (BUG-504-A07 provisions this in CI)',
    );
    // Seed the zustand-persist entry so the SPA thinks we're logged in.
    await page.addInitScript((jwt: string) => {
      const persisted = {
        state: {
          isAuthenticated: true,
          user: {
            id: 'e2e-bearer',
            email: 'e2e@cutebunny.local',
            name: 'E2E Bearer',
            role: 'admin',
          },
          token: jwt,
        },
        version: 0,
      };
      window.localStorage.setItem('auth-storage', JSON.stringify(persisted));
    }, ADMIN_JWT);

    await page.goto(`${ADMIN_BASE}/settings?tab=categories`, {
      waitUntil: 'networkidle',
    });

    // Wait for the categories table to render so the drift hook has fired.
    await page.waitForTimeout(2_000);

    const banner = page.locator('[data-testid="category-drift-banner"]');
    const isVisible = await banner.isVisible().catch(() => false);

    if (isVisible) {
      const bannerText = (await banner.textContent())?.trim() ?? '';
      throw new Error(
        `A06.5 DriftBanner surfaced on /settings?tab=categories — admin/public endpoints disagree. Banner text:\n${bannerText}`,
      );
    }
  });
});
