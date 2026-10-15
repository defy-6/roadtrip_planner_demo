import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

// Keep the isolated development server and existing Chromium suite unchanged.
export default defineConfig({
  ...base,
  testMatch: [
    '**/mobile-cross-browser.spec.js',
    '**/trip-switching.spec.js',
    '**/empty-plan-dates.spec.js',
    '**/schedule-editor-context.spec.js',
    '**/accommodation-map-continuity.spec.js',
    '**/review-photo.spec.js',
    '**/plan-loading.spec.js',
    '**/trip-rename.spec.js',
    '**/plan-dialog-focus.spec.js',
    '**/place-category-dialog.spec.js',
    '**/place-editor-return.spec.js',
    '**/place-delete-focus.spec.js',
    '**/universal-place-return.spec.js',
    '**/search-position.spec.js',
    '**/place-photo-selection.spec.js',
    '**/place-card-keyboard.spec.js',
    '**/plan-switch-context.spec.js'
  ],
  use: { ...base.use, browserName: 'webkit' },
  webServer: base.webServer[0]
});
