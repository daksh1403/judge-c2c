import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  retries: 1,
  use: {
    baseURL: process.env.REVIEW_URL ?? 'http://127.0.0.1:8787',
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium',
    screenshot: 'only-on-failure',
  },
  reporter: 'list',
  webServer: process.env.REVIEW_URL
    ? undefined
    : {
        command: 'npm run dev -- --port 8787',
        url: 'http://127.0.0.1:8787/health',
        reuseExistingServer: !process.env.CI,
      },
});
