import { expect, test } from '@playwright/test';
import { auditVisibleTextContrast } from './helpers/text-contrast.js';

for (const width of [360, 430]) for (const kind of ['event', 'place', 'review', 'expense', 'transport']) {
  test(`mobile ${kind} dialog solid-background text contrast at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 640 });
    const view = { event: 'schedule', place: 'places', review: 'plans', expense: 'plans', transport: 'plans' }[kind];
    await page.goto(`/?preview=mobile#${view}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#fileSaveStatus')).toContainText(/已从本地文件载入|已写入本地文件|已同步云端/);
    if (kind === 'event') await page.locator('#addScheduleBtn').click();
    if (kind === 'place') await page.locator('.place-card').first().dispatchEvent('dblclick');
    if (kind === 'review') await page.locator('[data-review]').click();
    if (kind === 'expense') await page.locator('[data-accounting]').click();
    if (kind === 'transport') await page.locator('[data-command="#importFlightBtn"]').click();
    const selector = { event: '#eventEditor', place: '#placeEditor', review: '#planReviewDialog', expense: '#expenseLedger', transport: '#flightImporter' }[kind];
    const dialog = page.locator(selector);
    await expect(dialog).toBeVisible();
    const result = await auditVisibleTextContrast(page, selector);
    expect(result.checked).toBeGreaterThan(4);
    expect(result.issues, JSON.stringify(result, null, 2)).toEqual([]);
    await page.screenshot({ path: `design/mobile-dialog-contrast-${kind}-${width}.png` });
    await dialog.locator('.editor-form').evaluate(element => { element.scrollTop = element.scrollHeight; });
    const end = await auditVisibleTextContrast(page, selector);
    expect(end.checked).toBeGreaterThan(4);
    expect(end.issues, JSON.stringify(end, null, 2)).toEqual([]);
    if (kind === 'expense') {
      const add = dialog.locator('[data-ledger-add]');
      await add.click();
      await expect(dialog.locator('[data-expense-note]')).toBeFocused();
      const formResult = await auditVisibleTextContrast(page, selector);
      expect(formResult.issues, JSON.stringify(formResult, null, 2)).toEqual([]);
      await dialog.locator('[data-ledger-cancel]').click();
      await expect(dialog.locator('[data-ledger-form]')).toBeHidden();
      await expect(add).toBeFocused();
    }
  });
}
