import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    headless: true,
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  webServer: [
    {
      command: 'node scripts/e2e-server.mjs',
      url: 'http://127.0.0.1:3100/api/preview-mode',
      reuseExistingServer: false,
      timeout: 20_000
    },
    {
      command: 'node scripts/e2e-share-server.mjs',
      url: 'http://127.0.0.1:4174/',
      reuseExistingServer: false,
      timeout: 20_000
    }
  ]
});
