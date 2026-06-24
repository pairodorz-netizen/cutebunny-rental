// i18n locale tests — multi-locale mode (TH/EN/ZH).
// Verifies locale routing, language switcher, and default locale behavior.
// BUG-544: locale detection disabled so root / always resolves to /th.

import { test, expect } from '@playwright/test';

const CUSTOMER_BASE =
  process.env.E2E_CUSTOMER_URL || 'http://localhost:3000';
const ADMIN_BASE =
  process.env.E2E_ADMIN_URL || 'https://admin-eight-rouge.vercel.app';

test.describe('i18n — customer locale routing', () => {
  test('/en/products serves English locale (200)', async ({ request }) => {
    const res = await request.get(`${CUSTOMER_BASE}/en/products`, {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(200);
  });

  test('/zh/products serves Chinese locale (200)', async ({ request }) => {
    const res = await request.get(`${CUSTOMER_BASE}/zh/products`, {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(200);
  });

  test('/en/products/[id] serves English locale (200)', async ({
    request,
  }) => {
    const res = await request.get(
      `${CUSTOMER_BASE}/en/products/065abd2c-aa4d-455d-a15a-7079f43bfcc8`,
      { maxRedirects: 0 },
    );
    expect(res.status()).toBe(200);
  });

  test('/ root → resolves to /th (default locale)', async ({ page }) => {
    await page.goto(`${CUSTOMER_BASE}/`, { waitUntil: 'domcontentloaded' });
    const url = page.url();
    expect(url).toContain('/th');
  });
});

test.describe('i18n — customer language switcher', () => {
  test('locale switcher is visible on customer header', async ({ page }) => {
    await page.goto(`${CUSTOMER_BASE}/th`, {
      waitUntil: 'domcontentloaded',
    });
    const globe = page.locator(
      'button[aria-label*="language"], button[aria-label*="Language"], button[aria-label*="ภาษา"]',
    );
    await expect(globe.first()).toBeVisible();
  });

  test('customer /th/products displays Thai category labels', async ({
    page,
  }) => {
    await page.goto(`${CUSTOMER_BASE}/th/products`, {
      waitUntil: 'networkidle',
    });
    const body = await page.textContent('body');
    const hasThaiContent = /[\u0E00-\u0E7F]/.test(body || '');
    expect(hasThaiContent, 'Page must contain Thai text').toBeTruthy();
  });
});

test.describe('i18n — admin Thai-only mode (BUG-546)', () => {
  test('admin login page is fully Thai', async ({ page }) => {
    await page.goto(`${ADMIN_BASE}/login`, {
      waitUntil: 'domcontentloaded',
    });
    const body = await page.textContent('body');
    expect(body).toContain('เข้าสู่ระบบ');
    const globe = page.locator(
      '[data-testid="locale-switcher"], button:has-text("EN"), select:has(option[value="en"])',
    );
    await expect(globe).toHaveCount(0);
  });

  test('admin login does not expose EN/ZH language options', async ({
    page,
  }) => {
    await page.goto(`${ADMIN_BASE}/login`, {
      waitUntil: 'domcontentloaded',
    });
    const langOptions = page.locator(
      'button:has-text("English"), button:has-text("中文"), option[value="en"], option[value="zh"]',
    );
    await expect(langOptions).toHaveCount(0);
  });
});
