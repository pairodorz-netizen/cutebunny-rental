import { defineConfig, devices } from '@playwright/test';

// Shared Playwright config for E2E test suites:
// - customer-smoke: landing, product, popup variants, thumbnails (BUG-543/545)
// - admin-smoke: login, finance, deleted customer display (BUG-544/547/548)
// - i18n-locale: Thai-only mode, redirects, no EN/ZH leak (BUG-544/546)
// - categories-parity: BUG-504-A05 category parity guard
//
// Uses Vercel preview URLs or production URLs via env vars.
// Local dev: `pnpm test:e2e` boots customer via webServer hook.

const CUSTOMER_BASE = process.env.E2E_CUSTOMER_URL || 'http://localhost:3000';
const API_BASE =
  process.env.E2E_API_URL ||
  'https://cutebunny-api.cutebunny-rental.workers.dev';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : 'list',
  use: {
    baseURL: CUSTOMER_BASE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: process.env.E2E_CUSTOMER_URL
    ? undefined
    : {
        command: 'pnpm --filter @cutebunny/customer start',
        url: `${CUSTOMER_BASE}/th/products`,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
        env: {
          NEXT_PUBLIC_API_URL: API_BASE,
          PORT: '3000',
        },
      },
});
