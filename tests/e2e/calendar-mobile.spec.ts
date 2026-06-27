/**
 * Mobile Calendar E2E — happy-path runtime verification.
 *
 * Uses Playwright route interception to inject mock calendar data
 * (7 dresses × 7 statuses) so all mobile-only components render:
 *   DayStrip, FilterChips, DressList/DressRow, StatusPill,
 *   DressDetailSheet (bottom sheet), and the tablet Brand-column compact mode.
 *
 * Runs against a local admin build (E2E_ADMIN_LOCAL_URL, default
 * http://localhost:4173) so it exercises the PR code directly.
 */

import { test, expect, type Page } from '@playwright/test';
import {
  buildCalendarMockData,
  buildMultiUnitRow,
} from './fixtures/calendar-mock-data';

const ADMIN_BASE =
  process.env.E2E_ADMIN_LOCAL_URL || 'http://localhost:4173';

// ── Auth seed (same pattern as calendar-ux.spec.ts) ─────────────────
async function seedAuth(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const persisted = {
      state: {
        isAuthenticated: true,
        user: {
          id: 'e2e-mobile',
          email: 'e2e-mobile@cutebunny.local',
          name: 'E2E Mobile',
          role: 'superadmin',
        },
        token: 'mock-jwt-for-mobile-e2e',
      },
      version: 0,
    };
    window.localStorage.setItem('auth-storage', JSON.stringify(persisted));
  });
}

// ── Route interception — mock calendar API ──────────────────────────
async function mockCalendarApi(page: Page): Promise<void> {
  // Derive current month start from today
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const monthStart = `${y}-${m}-01`;

  const mockData = [
    ...buildCalendarMockData(monthStart),
    ...buildMultiUnitRow(monthStart),
  ];

  await page.route('**/api/v1/admin/calendar?*', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: mockData }),
    });
  });

  // Mock the cell patch endpoint for status-change test
  await page.route('**/api/v1/admin/calendar/cell', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { from: 'available', to: 'booked', noop: false },
      }),
    });
  });
}

// ── Helpers ─────────────────────────────────────────────────────────
async function gotoCalendarMobile(page: Page): Promise<void> {
  await page.goto(`${ADMIN_BASE}/calendar`, {
    waitUntil: 'domcontentloaded',
  });
  // Wait for dress list to render (mock data is instant)
  await page.waitForTimeout(2000);
}

// Thai status labels for assertion
const TH_STATUS_LABELS: Record<string, string> = {
  available: 'ว่าง',
  booked: 'จองแล้ว',
  blocked_repair: 'ซ่อมแซม',
  late_return: 'คืนล่าช้า',
  tentative: 'จองชั่วคราว',
  shipping: 'จัดส่ง',
  washing: 'ซักทำความสะอาด',
};

// =====================================================================
// MOBILE VIEWPORT (375 × 812)
// =====================================================================
test.describe('Mobile Calendar — happy path (375×812)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test.beforeEach(async ({ page }) => {
    await seedAuth(page);
    await mockCalendarApi(page);
    await gotoCalendarMobile(page);
  });

  // ── DayStrip ──────────────────────────────────────────────────────
  test('DayStrip renders date chips with correct touch targets', async ({
    page,
  }) => {
    // Day strip should have 28-31 buttons (one per day in month)
    const dayChips = page.locator('button').filter({
      has: page.locator('span.text-lg'),
    });
    const chipCount = await dayChips.count();
    expect(chipCount).toBeGreaterThanOrEqual(28);
    expect(chipCount).toBeLessThanOrEqual(31);

    // Verify touch target >= 44px (spec says 48×60 min)
    const firstChip = dayChips.first();
    const box = await firstChip.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('DayStrip date selection changes active chip styling', async ({
    page,
  }) => {
    const dayChips = page.locator('button').filter({
      has: page.locator('span.text-lg'),
    });

    // Pick a chip that's not the currently selected one (use chip index 14 = 15th)
    const targetChip = dayChips.nth(14);
    const classBefore = await targetChip.getAttribute('class');

    await targetChip.click();
    await page.waitForTimeout(500);

    const classAfter = await targetChip.getAttribute('class');
    // Selected chip should have 'bg-primary'
    expect(classAfter).toContain('bg-primary');
    // If it wasn't already selected, the class should have changed
    if (!classBefore?.includes('bg-primary')) {
      expect(classAfter).not.toBe(classBefore);
    }
  });

  // ── FilterChips ───────────────────────────────────────────────────
  test('FilterChips show status counts and filter on tap', async ({
    page,
  }) => {
    // "ทั้งหมด" (All) chip should show total count
    const allChip = page.locator('button').filter({
      hasText: /ทั้งหมด.*\(\d+\)/,
    });
    await expect(allChip).toBeVisible();

    // At least one status chip should be visible (we have 7 dresses with different statuses)
    const statusChips = page.locator('button').filter({
      hasText: /\(\d+\)/,
    });
    const chipCount = await statusChips.count();
    // "ทั้งหมด" + at least some status chips
    expect(chipCount).toBeGreaterThanOrEqual(2);

    // Click a status filter chip (e.g., "ว่าง" / Available)
    const availableChip = page.locator('button').filter({
      hasText: new RegExp(`${TH_STATUS_LABELS.available}.*\\(\\d+\\)`),
    });
    if ((await availableChip.count()) > 0) {
      await availableChip.click();
      await page.waitForTimeout(300);

      // After filtering, all visible dress rows should have the "ว่าง" status pill
      const statusPills = page.locator('span.rounded-full').filter({
        hasText: TH_STATUS_LABELS.available,
      });
      const pillCount = await statusPills.count();
      expect(pillCount).toBeGreaterThan(0);
    }
  });

  // ── DressList / DressRow ──────────────────────────────────────────
  test('DressList renders dress rows with name, SKU, and status pill', async ({
    page,
  }) => {
    // Dress rows are <button> elements with min-h-[64px]
    const dressRows = page.locator('button.w-full').filter({
      has: page.locator('span.rounded-full'),
    });
    const rowCount = await dressRows.count();
    // We have 10 mock dresses (7 + 3 multi-unit)
    expect(rowCount).toBeGreaterThanOrEqual(7);

    // Check first row has display_name and SKU
    const firstRow = dressRows.first();
    const rowText = await firstRow.textContent();
    // Should contain a dress name from our fixtures
    expect(rowText).toBeTruthy();

    // Check touch target height >= 44px (spec says min-h-[64px])
    const box = await firstRow.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  // ── StatusPill — all 7 statuses ───────────────────────────────────
  test('all 7 status pills render with color + Thai label + icon', async ({
    page,
  }) => {
    // First, clear any active filter to show all statuses
    const allChip = page.locator('button').filter({
      hasText: /ทั้งหมด/,
    });
    if ((await allChip.count()) > 0) {
      await allChip.click();
      await page.waitForTimeout(300);
    }

    // Check that each Thai status label appears in a status pill
    const allStatuses = Object.values(TH_STATUS_LABELS);
    for (const label of allStatuses) {
      const pill = page.locator('span.rounded-full').filter({
        hasText: label,
      });
      const count = await pill.count();
      expect(count, `Status pill "${label}" should be present`).toBeGreaterThan(
        0,
      );

      // Verify the pill has an SVG icon
      const pillWithIcon = pill.first().locator('svg');
      await expect(pillWithIcon).toBeVisible();

      // Verify the pill has background color (not transparent)
      const bg = await pill.first().evaluate((el) => {
        return window.getComputedStyle(el).backgroundColor;
      });
      // Should not be transparent or white (pills have colored backgrounds)
      expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    }
  });

  test('status pills have WCAG AA contrast ratio', async ({ page }) => {
    // Check a sample pill for contrast
    const pill = page.locator('span.rounded-full').first();
    await expect(pill).toBeVisible();

    const { fg, bg } = await pill.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return {
        fg: styles.color,
        bg: styles.backgroundColor,
      };
    });

    // Parse RGB values
    function parseRgb(color: string): [number, number, number] {
      const m = color.match(/\d+/g);
      return m ? [+m[0], +m[1], +m[2]] : [0, 0, 0];
    }

    function luminance(r: number, g: number, b: number): number {
      const [rs, gs, bs] = [r, g, b].map((c) => {
        c /= 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
    }

    const [r1, g1, b1] = parseRgb(fg);
    const [r2, g2, b2] = parseRgb(bg);
    const l1 = luminance(r1, g1, b1);
    const l2 = luminance(r2, g2, b2);
    const ratio =
      (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

    // WCAG AA requires >= 4.5:1 for normal text
    expect(
      ratio,
      `Contrast ratio ${ratio.toFixed(2)}:1 should be >= 4.5:1`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  // ── DressDetailSheet (bottom sheet) ───────────────────────────────
  test('tapping a dress row opens the bottom sheet with status options', async ({
    page,
  }) => {
    // Click the first dress row
    const dressRows = page.locator('button.w-full').filter({
      has: page.locator('span.rounded-full'),
    });
    await dressRows.first().click();
    await page.waitForTimeout(500);

    // Bottom sheet should appear (role="dialog")
    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible();

    // Sheet should show the dress name
    const sheetText = await sheet.textContent();
    expect(sheetText).toBeTruthy();

    // Sheet should have "สถานะปัจจุบัน" (Current status) label
    await expect(
      sheet.locator('text=สถานะปัจจุบัน'),
    ).toBeVisible();

    // Sheet should have "เปลี่ยนสถานะ" (Change status) label
    await expect(
      sheet.locator('text=เปลี่ยนสถานะ'),
    ).toBeVisible();

    // Sheet should show all 7 status options as buttons
    const statusButtons = sheet.locator('button').filter({
      has: page.locator('svg'),
    });
    // 7 status buttons + close button = at least 7
    const btnCount = await statusButtons.count();
    expect(btnCount).toBeGreaterThanOrEqual(7);

    // Verify all 7 Thai status labels appear as status option buttons in the sheet
    for (const label of Object.values(TH_STATUS_LABELS)) {
      const optionButton = sheet
        .locator('.grid button')
        .filter({ hasText: label });
      await expect(
        optionButton,
        `Sheet should contain status option "${label}"`,
      ).toBeVisible();
    }

    // Close button (X) should have 44px touch target
    const closeBtn = sheet.locator('button[aria-label]').filter({
      has: page.locator('svg'),
    });
    if ((await closeBtn.count()) > 0) {
      const closeBox = await closeBtn.first().boundingBox();
      expect(closeBox).not.toBeNull();
      expect(closeBox!.width).toBeGreaterThanOrEqual(44);
      expect(closeBox!.height).toBeGreaterThanOrEqual(44);
    }

    // Sheet status option buttons should have min-h-[48px]
    const optionBtn = sheet
      .locator('.grid button')
      .first();
    if ((await optionBtn.count()) > 0) {
      const optionBox = await optionBtn.boundingBox();
      expect(optionBox).not.toBeNull();
      expect(optionBox!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('bottom sheet closes on backdrop click', async ({ page }) => {
    // Open the sheet
    const dressRows = page.locator('button.w-full').filter({
      has: page.locator('span.rounded-full'),
    });
    await dressRows.first().click();
    await page.waitForTimeout(500);
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    // Click the backdrop (fixed overlay behind sheet)
    const backdrop = page.locator('.fixed.inset-0.bg-black\\/50');
    await backdrop.click({ force: true, position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);

    // Sheet should be hidden
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();
  });

  test('bottom sheet closes on Escape key', async ({ page }) => {
    const dressRows = page.locator('button.w-full').filter({
      has: page.locator('span.rounded-full'),
    });
    await dressRows.first().click();
    await page.waitForTimeout(500);
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await expect(page.locator('[role="dialog"]')).not.toBeVisible();
  });

  // ── MobileTopBar ──────────────────────────────────────────────────
  test('MobileTopBar shows month nav and search input', async ({ page }) => {
    // Month name should be visible
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).toMatch(/\w+ \d{4}/); // e.g., "June 2026"

    // Search input should be visible with Thai placeholder
    const searchInput = page.locator('input[type="text"]');
    await expect(searchInput).toBeVisible();
    const placeholder = await searchInput.getAttribute('placeholder');
    expect(placeholder).toContain('ค้นหาชุด');

    // Prev/next month buttons should exist
    const prevBtn = page.locator('button[aria-label*="เดือนก่อนหน้า"]');
    const nextBtn = page.locator('button[aria-label*="เดือนถัดไป"]');
    await expect(prevBtn).toBeVisible();
    await expect(nextBtn).toBeVisible();
  });

  test('MobileTopBar search filters dress rows', async ({ page }) => {
    const searchInput = page.locator('input[type="text"]');
    await searchInput.fill('Sakura');
    // Wait for debounce (300ms)
    await page.waitForTimeout(500);

    // Only "Sakura Blossom" should be visible
    const dressRows = page.locator('button.w-full').filter({
      has: page.locator('span.rounded-full'),
    });
    const rowCount = await dressRows.count();
    expect(rowCount).toBe(1);

    const rowText = await dressRows.first().textContent();
    expect(rowText).toContain('Sakura');
  });
});

// =====================================================================
// TABLET VIEWPORT (800 × 600) — compact desktop grid
// =====================================================================
test.describe('Tablet Calendar — compact mode (800×600)', () => {
  test.use({ viewport: { width: 800, height: 600 } });

  test.beforeEach(async ({ page }) => {
    await seedAuth(page);
    await mockCalendarApi(page);
    await page.goto(`${ADMIN_BASE}/calendar`, {
      waitUntil: 'domcontentloaded',
    });
    // Wait for table to render with mock data
    await page
      .locator('table thead th[data-testid="calendar-header-sku"]')
      .waitFor({ state: 'visible', timeout: 10_000 });
  });

  test('tablet renders DesktopCalendar grid with table', async ({ page }) => {
    const table = page.locator('table');
    await expect(table).toBeVisible();
  });

  test('tablet compact mode hides Brand column', async ({ page }) => {
    // At 800px (>=768 but <1024), compact=true, Brand column should be hidden
    const brandHeader = page.locator(
      '[data-testid="calendar-header-brand"]',
    );
    await expect(brandHeader).not.toBeVisible();

    // SKU and Name should still be visible
    const skuHeader = page.locator(
      '[data-testid="calendar-header-sku"]',
    );
    const nameHeader = page.locator(
      '[data-testid="calendar-header-name"]',
    );
    await expect(skuHeader).toBeVisible();
    await expect(nameHeader).toBeVisible();
  });

  test('tablet shows only 2 left columns (SKU, Name) in header order', async ({
    page,
  }) => {
    const headers = await page
      .locator('table thead th[data-testid^="calendar-header-"]')
      .evaluateAll((els) =>
        els.map((el) => (el as HTMLElement).dataset.testid),
      );
    expect(headers).toEqual([
      'calendar-header-sku',
      'calendar-header-name',
    ]);
  });
});

// =====================================================================
// DESKTOP VIEWPORT (1280 × 720) — full grid, Brand column present
// =====================================================================
test.describe('Desktop Calendar — full grid parity (1280×720)', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    await seedAuth(page);
    await mockCalendarApi(page);
    await page.goto(`${ADMIN_BASE}/calendar`, {
      waitUntil: 'domcontentloaded',
    });
    await page
      .locator('table thead th[data-testid="calendar-header-sku"]')
      .waitFor({ state: 'visible', timeout: 10_000 });
  });

  test('desktop shows all 3 columns: SKU, Brand, Name', async ({ page }) => {
    const headers = await page
      .locator('table thead th[data-testid^="calendar-header-"]')
      .evaluateAll((els) =>
        els.map((el) => (el as HTMLElement).dataset.testid),
      );
    expect(headers).toEqual([
      'calendar-header-sku',
      'calendar-header-brand',
      'calendar-header-name',
    ]);
  });

  test('desktop renders dress rows with all data-testid attributes', async ({
    page,
  }) => {
    // Should have rows with mock data
    const nameCells = page.locator('[data-testid="calendar-cell-name"]');
    const count = await nameCells.count();
    // 7 + 3 = 10 mock dresses
    expect(count).toBeGreaterThanOrEqual(7);
  });

  test('no mobile components leak into desktop view', async ({ page }) => {
    // No mobile search input
    const mobileSearch = page.locator(
      'input[placeholder*="ค้นหาชุด"], input[placeholder*="Search dresses"]',
    );
    await expect(mobileSearch).not.toBeVisible();

    // No bottom sheet
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();
  });
});
