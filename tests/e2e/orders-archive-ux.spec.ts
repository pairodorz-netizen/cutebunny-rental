// BUG-ORDERS-ARCHIVE-01 — admin /orders default 30-day window regression guard.
//
// Asserts the UX wiring in `apps/admin/src/pages/orders.tsx`:
//   1. default query hits GET /api/v1/admin/orders with from=-30d & include_stale=false
//   2. flipping the include-stale toggle re-fires the list with include_stale=true
//   3. the "all time" preset clears `from` and sets include_stale=true
//   4. pagination next/prev testids exist and respect `has_more`
//
// Skips gracefully when ADMIN_JWT_PROD is unset (shared BUG-504-A07.5
// unblock gate; same shape as BUG-CAL / BUG-COMBO-DELETE).
//
// Network interception: every spec here stubs the admin orders list so
// the seeded admin principal is irrelevant to response payloads — we are
// verifying request-shape + UI reactivity, not live DB contents. Backend
// semantics are covered by the vitest suite in
// `apps/api/src/__tests__/bug-orders-archive-01.test.ts`.

import { test, expect, type Page, type Route } from '@playwright/test';

const ADMIN_BASE =
  process.env.E2E_ADMIN_URL || 'https://admin-eight-rouge.vercel.app';
const ADMIN_JWT = process.env.ADMIN_JWT_PROD ?? '';

async function seedAdminAuth(page: Page, jwt: string): Promise<void> {
  await page.addInitScript((token: string) => {
    const persisted = {
      state: {
        isAuthenticated: true,
        user: {
          id: 'e2e-bearer',
          email: 'e2e@cutebunny.local',
          name: 'E2E Bearer',
          role: 'superadmin',
        },
        token,
      },
      version: 0,
    };
    window.localStorage.setItem('auth-storage', JSON.stringify(persisted));
  }, jwt);
}

interface OrdersListCall {
  url: URL;
  method: string;
}

function fulfillOrdersList(call: OrdersListCall, route: Route): Promise<void> {
  const page = parseInt(call.url.searchParams.get('page') ?? '1', 10);
  const pageSize = parseInt(
    call.url.searchParams.get('page_size') ??
      call.url.searchParams.get('per_page') ??
      '50',
    10,
  );
  // Simulate 3 rows on page 1, nothing on page 2 — lets the prev/next
  // disable logic under test reach both branches.
  const rows =
    page === 1
      ? Array.from({ length: 3 }).map((_, i) => ({
          id: `ord-${i}`,
          order_number: `ORD-${1000 + i}`,
          status: i === 0 ? 'finished' : 'unpaid',
          total: 100,
          customer: { id: 'c1', name: `C${i}`, phone: '0000000000' },
          items: [],
          updated_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        }))
      : [];
  const total = 3;
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      data: rows,
      meta: {
        page,
        per_page: pageSize,
        page_size: pageSize,
        total,
        total_pages: Math.ceil(total / pageSize),
        has_more: page * pageSize < total,
        include_stale: call.url.searchParams.get('include_stale') === 'true',
      },
    }),
  });
}

async function captureOrdersCalls(
  page: Page,
  sink: OrdersListCall[],
): Promise<void> {
  await page.route('**/api/v1/admin/orders*', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/api/v1/admin/orders') return route.continue();
    sink.push({ url, method: route.request().method() });
    return fulfillOrdersList({ url, method: route.request().method() }, route);
  });
}

test.describe('BUG-ORDERS-ARCHIVE-01 — default 30-day archive window UX', () => {
  test.skip(
    !ADMIN_JWT,
    'ADMIN_JWT_PROD not set; skipping (BUG-504-A07.5 resume unlocks this gate)',
  );

  test.beforeEach(async ({ page }) => {
    await seedAdminAuth(page, ADMIN_JWT);
  });

  test('default /orders query uses from=-30d & include_stale=false', async ({
    page,
  }) => {
    const calls: OrdersListCall[] = [];
    await captureOrdersCalls(page, calls);

    await page.goto(`${ADMIN_BASE}/orders`, { waitUntil: 'networkidle' });

    await expect(page.locator('[data-testid="orders-date-range"]')).toBeVisible();

    // At least one list call was fired with the defaults.
    const listCall = calls.find(
      (c) => !c.url.searchParams.has('status'),
    );
    expect(listCall, 'default list call was not observed').toBeTruthy();
    expect(listCall!.url.searchParams.get('include_stale')).toBe('false');
    const from = listCall!.url.searchParams.get('from');
    expect(from, 'from=YYYY-MM-DD should be set').toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const fromMs = Date.parse(from!);
    const now = Date.now();
    // -30d ± 1d tolerance for clock skew between test runner + SPA.
    expect(now - fromMs).toBeGreaterThan(29 * 86_400_000);
    expect(now - fromMs).toBeLessThan(31 * 86_400_000);
  });

  test('toggling include-stale re-fires with include_stale=true', async ({
    page,
  }) => {
    const calls: OrdersListCall[] = [];
    await captureOrdersCalls(page, calls);

    await page.goto(`${ADMIN_BASE}/orders`, { waitUntil: 'networkidle' });

    const before = calls.length;
    await page.locator('[data-testid="orders-include-stale-toggle"]').check();
    await page.waitForFunction(
      (prev) =>
        (window as unknown as { __ordersCalls?: unknown[] }).__ordersCalls
          ?.length !== prev,
      before,
      { timeout: 5_000 },
    ).catch(() => {
      // best-effort: rely on the length check below instead of throwing
    });

    // New list call with include_stale=true should appear.
    const after = calls.find(
      (c) => c.url.searchParams.get('include_stale') === 'true',
    );
    expect(after, 'no list call with include_stale=true was observed').toBeTruthy();
  });

  test('“all time” preset clears from and sets include_stale=true', async ({
    page,
  }) => {
    const calls: OrdersListCall[] = [];
    await captureOrdersCalls(page, calls);

    await page.goto(`${ADMIN_BASE}/orders`, { waitUntil: 'networkidle' });

    await page.locator('[data-testid="orders-date-preset-all"]').click();

    const allTimeCall = calls
      .reverse()
      .find((c) => c.url.searchParams.get('include_stale') === 'true');
    expect(allTimeCall, 'all-time preset did not fire include_stale=true').toBeTruthy();
    expect(allTimeCall!.url.searchParams.get('from') ?? '').toBe('');
  });

  test('pagination prev/next + pagesize testids exist', async ({ page }) => {
    const calls: OrdersListCall[] = [];
    await captureOrdersCalls(page, calls);
    await page.goto(`${ADMIN_BASE}/orders`, { waitUntil: 'networkidle' });

    await expect(
      page.locator('[data-testid="orders-pagination-prev"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="orders-pagination-next"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="orders-pagesize-select"]'),
    ).toBeVisible();
    // At page 1 with total=3 + default pageSize=50 → no more pages.
    await expect(
      page.locator('[data-testid="orders-pagination-prev"]'),
    ).toBeDisabled();
  });
});
