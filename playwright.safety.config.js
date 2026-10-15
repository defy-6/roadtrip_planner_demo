import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: ['**/plan-load-retry.spec.js', '**/plan-loading.spec.js', '**/plan-switch-context.spec.js', '**/plan-pending-safety.spec.js'],
  timeout: 60_000, workers: 1, reporter: 'line',
  // Native WebKit storage can consume several bounded 2.5s operations during
  // hydration. Assertions must cover that contract rather than a 5s mock pace.
  expect: { timeout: 15_000 },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } }],
  use: { baseURL: 'http://127.0.0.1:3102', headless: true,
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node scripts/e2e-safety-server.mjs',
    url: 'http://127.0.0.1:3102/api/preview-mode', reuseExistingServer: false, timeout: 20_000 }
});
