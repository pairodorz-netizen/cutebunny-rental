// BUG-COMBO-DELETE-02 — admin combo-set delete UX regression guard.
//
// Asserts the end-to-end trash → confirm → optimistic remove → toast
// flow wired in `apps/admin/src/pages/products.tsx`. Skips gracefully
// when ADMIN_JWT_PROD is unset (same BUG-504-A07.5 resume gate) so
// fork / local runs that can't mint a prod JWT still exit 0.
//
// Gates asserted:
//   1. trash button (`combo-set-delete-<sku>`) opens a confirm dialog
//      with a visible confirm button (`combo-set-delete-confirm`)
//   2. cancel closes the dialog; row is still present
//   3. clicking confirm fires DELETE /api/v1/admin/combo-sets/:id and
//      the row disappears from the table (optimistic removal)
//   4. after the response, the SPA renders a visible toast (success or
//      error banner via role=status)
//
// Note on DELETE interception: the spec intercepts the network call via
// page.route() and short-circuits with 200 — we are testing UI wiring,
// not backend semantics (covered by ATOM 01 vitest gates). A follow-on
// test also verifies 409 rollback: a re-added row + error toast with
// the rental count copy.

import { test, expect, type Page } from '@playwright/test';

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

async function gotoComboSetsTab(page: Page): Promise<void> {
  await page.goto(`${ADMIN_BASE}/products`, { waitUntil: 'networkidle' });
  // Switch to Combo Sets tab — match by the "addComboSet" CTA or tab role.
  const comboTab = page.getByRole('tab', { name: /combo/i });
  if (await comboTab.count()) {
    await comboTab.first().click();
  }
  // Wait for at least one trash testid to appear.
  await page
    .locator('[data-testid^="combo-set-delete-"]')
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 });
}

test.describe('BUG-COMBO-DELETE-02 — admin combo set delete UX', () => {
  test.skip(
    !ADMIN_JWT,
    'ADMIN_JWT_PROD not set; skipping (BUG-504-A07.5 resume unlocks this gate)',
  );

  test.beforeEach(async ({ page }) => {
    await seedAdminAuth(page, ADMIN_JWT);
  });

  test('trash opens confirm dialog; cancel closes without firing DELETE', async ({
    page,
  }) => {
    let deleteFired = false;
    await page.route('**/api/v1/admin/combo-sets/*', (route) => {
      if (route.request().method() === 'DELETE') {
        deleteFired = true;
      }
      return route.continue();
    });

    await gotoComboSetsTab(page);

    // Pick the first visible trash.
    const trash = page.locator('[data-testid^="combo-set-delete-"]').first();
    const testid = await trash.getAttribute('data-testid');
    expect(testid).toMatch(/^combo-set-delete-/);
    await trash.click();

    const confirmBtn = page.locator(
      '[data-testid="combo-set-delete-confirm"]',
    );
    await expect(confirmBtn).toBeVisible();

    // Cancel — dialog closes, DELETE not fired.
    await page.getByRole('button', { name: /cancel|ยกเลิก|取消/i }).click();
    await expect(confirmBtn).toHaveCount(0);
    expect(deleteFired).toBe(false);
  });

  test('confirm → optimistic remove + success toast', async ({ page }) => {
    // Intercept DELETE with a stubbed 200 so we don't mutate real data.
    await page.route('**/api/v1/admin/combo-sets/*', async (route) => {
      if (route.request().method() === 'DELETE') {
        const url = new URL(route.request().url());
        const id = url.pathname.split('/').pop() ?? 'unknown';
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: { id, deleted: true, mode: 'hard' },
          }),
        });
      }
      return route.continue();
    });

    await gotoComboSetsTab(page);

    const trash = page.locator('[data-testid^="combo-set-delete-"]').first();
    const testid = await trash.getAttribute('data-testid');
    const sku = testid?.replace(/^combo-set-delete-/, '') ?? '';
    expect(sku.length).toBeGreaterThan(0);

    await trash.click();
    await page.locator('[data-testid="combo-set-delete-confirm"]').click();

    // Optimistic removal: the clicked trash disappears from the DOM.
    await expect(
      page.locator(`[data-testid="combo-set-delete-${sku}"]`),
    ).toHaveCount(0, { timeout: 5_000 });

    // Toast banner appears (role=status, one of the three locale success copies).
    const toast = page.locator('[role="status"]').filter({
      hasText:
        /Combo set deleted successfully|ลบ Combo Set สำเร็จ|组合套装已成功删除/,
    });
    await expect(toast).toBeVisible();
  });

  test('409 ACTIVE_RENTALS → row rolls back + error toast with count', async ({
    page,
  }) => {
    await page.route('**/api/v1/admin/combo-sets/*', async (route) => {
      if (route.request().method() === 'DELETE') {
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'ACTIVE_RENTALS',
              message: 'Cannot delete combo set with 3 active rentals',
              details: { rentalCount: 3 },
            },
          }),
        });
      }
      return route.continue();
    });

    await gotoComboSetsTab(page);

    const trash = page.locator('[data-testid^="combo-set-delete-"]').first();
    const testid = await trash.getAttribute('data-testid');
    const sku = testid?.replace(/^combo-set-delete-/, '') ?? '';
    await trash.click();
    await page.locator('[data-testid="combo-set-delete-confirm"]').click();

    // Rollback: row re-appears (was removed optimistically, restored on 409).
    await expect(
      page.locator(`[data-testid="combo-set-delete-${sku}"]`),
    ).toBeVisible({ timeout: 5_000 });

    // Error toast with the "3" count interpolation somewhere in the copy.
    const errorToast = page
      .locator('[role="status"]')
      .filter({ hasText: /3/ })
      .filter({
        hasText:
          /active rental|ลบไม่ได้|活跃租赁/i,
      });
    await expect(errorToast).toBeVisible();
  });
});
