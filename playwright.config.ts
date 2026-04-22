import { defineConfig, devices } from '@playwright/test';

// BUG-504-A05 — shared Playwright config for the categories-parity
// diff guard. The suite boots the customer Next.js app locally via
// the `webServer` hook and asserts that the rendered filter UI matches
// the A02 public /api/v1/categories endpoint (set of slugs, order,
// localized labels, visibility filter).
//
// `E2E_API_URL` / `NEXT_PUBLIC_API_URL` both point at the deployed
// Worker because spinning up the API + DB inside CI is far outside
// A05's scope. Keeping them in sync guarantees that what the customer
// fetches equals what the spec fetches.

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
  ],
  webServer: {
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
