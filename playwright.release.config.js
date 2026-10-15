import safety from './playwright.safety.config.js';
import { defineConfig } from '@playwright/test';

export default defineConfig({ ...safety,
  testMatch: [...safety.testMatch, '**/release-smoke.spec.js']
});
