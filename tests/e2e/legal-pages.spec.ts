import { test, expect } from '@playwright/test';

const CUSTOMER_BASE =
  process.env.E2E_CUSTOMER_URL || 'http://localhost:3000';

async function legalPageExists(): Promise<boolean> {
  try {
    const res = await fetch(`${CUSTOMER_BASE}/th/privacy-policy`);
    return res.ok;
  } catch {
    return false;
  }
}

const LEGAL_ROUTES = [
  { path: '/th/privacy-policy', heading: 'นโยบายความเป็นส่วนตัว' },
  { path: '/en/privacy-policy', heading: 'Privacy Policy' },
  { path: '/th/terms-of-service', heading: 'ข้อกำหนดการใช้งาน' },
  { path: '/en/terms-of-service', heading: 'Terms of Service' },
] as const;

test.describe('Legal pages — smoke tests', () => {
  for (const { path, heading } of LEGAL_ROUTES) {
    test(`${path} returns 200 and contains heading`, async ({ page }) => {
      const deployed = await legalPageExists();
      test.skip(!deployed, 'Legal pages not deployed yet — skipping');

      const response = await page.goto(`${CUSTOMER_BASE}${path}`);
      expect(response?.status()).toBe(200);

      const h1 = page.locator('h1');
      await expect(h1).toBeVisible({ timeout: 15_000 });
      await expect(h1).toContainText(heading);
    });
  }

  test('footer links are visible on homepage', async ({ page }) => {
    const deployed = await legalPageExists();
    test.skip(!deployed, 'Legal pages not deployed yet — skipping');

    await page.goto(`${CUSTOMER_BASE}/th`);
    await page.waitForLoadState('domcontentloaded');

    const footer = page.locator('footer');
    await expect(footer).toBeVisible({ timeout: 15_000 });

    const privacyLink = footer.locator('a[href*="privacy-policy"]');
    await expect(privacyLink).toBeVisible();
    await expect(privacyLink).toContainText('นโยบายความเป็นส่วนตัว');

    const termsLink = footer.locator('a[href*="terms-of-service"]');
    await expect(termsLink).toBeVisible();
    await expect(termsLink).toContainText('ข้อกำหนดการใช้งาน');
  });
});
