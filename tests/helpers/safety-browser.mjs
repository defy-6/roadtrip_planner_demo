import { test as base, expect } from '@playwright/test';

// S1 acceptance never sends synthetic trip/credential data to external hosts.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      return ['127.0.0.1', '127.0.0.2', 'localhost'].includes(url.hostname)
        ? route.continue() : route.abort();
    });
    await use(page);
  }
});
export { expect };
