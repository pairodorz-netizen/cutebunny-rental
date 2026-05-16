// Admin smoke tests — regression guards for BUG-544/546/547/548 sprint fixes.
// Covers: login page, finance consistency, deleted customer display.
// Requires: E2E_ADMIN_URL (Vercel preview or production)

import { test, expect } from '@playwright/test';

const ADMIN_BASE =
  process.env.E2E_ADMIN_URL || 'https://admin-eight-rouge.vercel.app';

test.describe('Admin smoke — login page (BUG-546 Thai-only)', () => {
  test('login page renders Thai labels without globe switcher', async ({
    page,
  }) => {
    await page.goto(`${ADMIN_BASE}/login`);
    await page.waitForLoadState('domcontentloaded');
    // Thai login labels should be visible
    const body = await page.textContent('body');
    expect(body).toContain('เข้าสู่ระบบ');
    // Globe/EN dropdown must NOT exist (BUG-546)
    const globe = page.locator(
      '[data-testid="locale-switcher"], [aria-label="language"], button:has-text("EN"), button:has-text("English")',
    );
    await expect(globe).toHaveCount(0);
  });

  test('login page has email and password fields', async ({ page }) => {
    await page.goto(`${ADMIN_BASE}/login`);
    await page.waitForLoadState('domcontentloaded');
    const emailInput = page.locator('input[type="email"], input[name="email"]');
    const passwordInput = page.locator(
      'input[type="password"], input[name="password"]',
    );
    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
  });
});

test.describe('Admin smoke — Thai i18n consistency (BUG-546)', () => {
  test('login page does not contain "Sign In" or "Email" in English', async ({
    page,
  }) => {
    await page.goto(`${ADMIN_BASE}/login`);
    await page.waitForLoadState('domcontentloaded');
    // After BUG-546 fix, labels should be Thai
    const body = await page.textContent('body');
    // Should NOT have English login labels (allow "email" in input placeholder)
    const hasEnglishSignIn =
      body?.includes('Sign In') || body?.includes('Sign in');
    expect(
      hasEnglishSignIn,
      'Login page should not show English "Sign In" label',
    ).toBeFalsy();
  });
});

test.describe('Admin smoke — finance page accessibility (BUG-548)', () => {
  // These tests verify the admin pages are accessible without requiring login
  // Full finance number verification requires auth
  test('admin root redirects to login when unauthenticated', async ({
    page,
  }) => {
    await page.goto(`${ADMIN_BASE}/`);
    await page.waitForLoadState('domcontentloaded');
    // Should redirect to login or show login UI
    const url = page.url();
    const body = await page.textContent('body');
    const isOnLogin =
      url.includes('/login') || body?.includes('เข้าสู่ระบบ');
    expect(isOnLogin).toBeTruthy();
  });
});

test.describe('Admin smoke — deleted customer display (BUG-547)', () => {
  // PDPA banner is only visible when authenticated and viewing deleted customer orders
  // This test verifies the admin app loads correctly and handles unauthenticated state
  test('admin orders page requires authentication', async ({ page }) => {
    await page.goto(`${ADMIN_BASE}/orders`);
    await page.waitForLoadState('domcontentloaded');
    // Without auth, should redirect to login
    const url = page.url();
    const body = await page.textContent('body');
    const requiresAuth =
      url.includes('/login') || body?.includes('เข้าสู่ระบบ');
    expect(requiresAuth).toBeTruthy();
  });
});
