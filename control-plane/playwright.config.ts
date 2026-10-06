import { defineConfig } from '@playwright/test';

/** E2E against a running control plane: BASE_URL (default: local wrangler dev). */
export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:8787',
    browserName: 'chromium',
    trace: 'retain-on-failure',
  },
});
