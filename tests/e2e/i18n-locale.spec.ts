// i18n locale tests — BUG-544/546 regression guards.
// Verifies Thai-only mode: no EN/ZH leak, correct redirects.

import { test, expect } from '@playwright/test';

const CUSTOMER_BASE =
  process.env.E2E_CUSTOMER_URL || 'http://localhost:3000';
const ADMIN_BASE =
  process.env.E2E_ADMIN_URL || 'https://admin-eight-rouge.vercel.app';

test.describe('i18n — customer locale redirect (BUG-544)', () => {
  test('/en/products → 301 redirect to /th/products', async ({ request }) => {
    const res = await request.get(`${CUSTOMER_BASE}/en/products`, {
      maxRedirects: 0,
    });
    // Should be a redirect (301 or 308)
    expect([301, 302, 307, 308]).toContain(res.status());
    const location = res.headers()['location'] || '';
    expect(location).toContain('/th/products');
  });

  test('/zh/products → 301 redirect to /th/products', async ({ request }) => {
    const res = await request.get(`${CUSTOMER_BASE}/zh/products`, {
      maxRedirects: 0,
    });
    expect([301, 302, 307, 308]).toContain(res.status());
    const location = res.headers()['location'] || '';
    expect(location).toContain('/th/products');
  });

  test('/en/products/[id] → redirect to /th/products/[id]', async ({
    request,
  }) => {
    const res = await request.get(
      `${CUSTOMER_BASE}/en/products/065abd2c-aa4d-455d-a15a-7079f43bfcc8`,
      { maxRedirects: 0 },
    );
    expect([301, 302, 307, 308]).toContain(res.status());
    const location = res.headers()['location'] || '';
    expect(location).toContain('/th/products');
  });

  test('/ root → resolves to /th (default locale)', async ({ page }) => {
    await page.goto(`${CUSTOMER_BASE}/`, { waitUntil: 'domcontentloaded' });
    const url = page.url();
    expect(url).toContain('/th');
  });
});

test.describe('i18n — customer Thai-only mode (BUG-544)', () => {
  test('no locale switcher visible on customer header', async ({ page }) => {
    await page.goto(`${CUSTOMER_BASE}/th`, {
      waitUntil: 'domcontentloaded',
    });
    const globe = page.locator(
      '[data-testid="locale-switcher"], button[aria-label*="language"], button[aria-label*="Language"]',
    );
    await expect(globe).toHaveCount(0);
  });

  test('customer /th/products displays Thai category labels', async ({
    page,
  }) => {
    await page.goto(`${CUSTOMER_BASE}/th/products`, {
      waitUntil: 'networkidle',
    });
    const body = await page.textContent('body');
    // Should have Thai characters (category names are Thai)
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
    // Must contain Thai login text
    expect(body).toContain('เข้าสู่ระบบ');
    // Must NOT have globe/language switcher
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
    // No dropdown with EN/ZH options
    const langOptions = page.locator(
      'button:has-text("English"), button:has-text("中文"), option[value="en"], option[value="zh"]',
    );
    await expect(langOptions).toHaveCount(0);
  });
});
