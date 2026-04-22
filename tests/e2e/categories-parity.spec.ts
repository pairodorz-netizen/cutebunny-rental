// BUG-504-A05 — customer ↔ API categories parity guard.
//
// This is the Playwright diff check that locks in the A04 invariant:
// the customer filter UI is a thin projection of the A02 public
// `/api/v1/categories` endpoint. Any future regression (capitalized
// slug, hardcoded array drift, hidden-row leak, sort-order flip)
// fails one of the gates below.
//
// Admin-side parity is deliberately NOT asserted here — CI has no
// admin bearer, so the corresponding test is `test.skip`ped with a
// TODO. Re-enable once BUG-504-A06 (or a sibling atom) introduces a
// CI-safe test-mode bearer against /api/v1/admin/categories.

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const API_BASE =
  process.env.E2E_API_URL ||
  'https://cutebunny-api.cutebunny-rental.workers.dev';

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
  await locator.first().waitFor({ state: 'visible', timeout: 15_000 });
  return locator.evaluateAll((els) =>
    els.map((el) => ({
      slug: (el as HTMLElement).dataset.slug ?? '',
      label: (el.textContent ?? '').trim(),
    })),
  );
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
    await page.goto('/th/products');
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
    await page.goto('/th/products');
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
    await page.goto('/th/products');
    const rendered = await readRenderedCategoryButtons(page);
    const expected = visibleApiCategories.map((c) => c.slug);
    const actual = rendered.map((r) => r.slug);
    expect(actual).toEqual(expected);
  });

  test('gate 4 — visible_frontend=false categories do NOT leak to customer', async ({
    page,
  }) => {
    await page.goto('/th/products');
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
    await page.goto('/th/products');
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
    await page.goto('/en/products');
    const rendered = await readRenderedCategoryButtons(page);
    expect(rendered.length).toBeGreaterThan(0);
    for (const entry of rendered) {
      const api = visibleApiCategories.find((c) => c.slug === entry.slug);
      expect(api).toBeDefined();
      expect(entry.label).toBe(api!.name_en);
    }
  });

  // TODO (BUG-504-A07): admin /settings/categories parity.
  // Requires a CI-safe test-mode admin bearer (ADMIN_JWT_PROD,
  // repo-scoped) against /api/v1/admin/categories. Until A07 mints
  // that secret, the public A02 ↔ customer check above is the only
  // Playwright guard on admin-side drift — which covers the primary
  // regression path (customer lagging admin). A06.5 adds a runtime
  // client-side drift banner + audit event that catches admin-side
  // drift in the live SPA without needing a CI bearer.
  test.skip('gate 7 — admin /settings/categories parity (needs ADMIN_JWT_PROD, BUG-504-A07)', async () => {});

  // TODO (BUG-504-A07): assert the A06.5 DriftBanner appears in the
  // admin SPA when the two endpoints disagree. Requires admin login
  // (ADMIN_JWT_PROD) + a staged fixture that forces drift. Deferred
  // to A07 alongside gate 7 above.
  test.skip('gate 8 — A06.5 DriftBanner surfaces on mismatch (needs ADMIN_JWT_PROD, BUG-504-A07)', async () => {});
});
