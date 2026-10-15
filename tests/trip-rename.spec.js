import { expect, test } from '@playwright/test';
import { auditVisibleTextContrast } from './helpers/text-contrast.js';

for (const viewport of [{ width: 360, height: 480 }, { width: 430, height: 640 }]) {
  test(`trip rename stays compact and restores its entry at ${viewport.width}px`, async ({ page, browserName }) => {
    await page.setViewportSize(viewport);
    const fixture = { activeVersion: 'p1', plans: [{ id: 'p1', name: '保留的方案名称' }], versions: { p1: {
      name: '原来的旅行名称', planKey: 'p1', items: [], schedule: [{ type: 'food', title: '午餐', date: '2026-11-03', start: '12:00', end: '13:00' }],
      locations: [], routes: [], expenses: [], placeCategories: [], preferences: {}
    } }, locations: [], routes: [], sharedSchedule: {} };
    await page.route('**/api/planner-data', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: fixture }) }));
    await page.addInitScript(() => {
      window.__renameRequests = [];
      window.addEventListener('mobile:triprename', event => window.__renameRequests.push(event.detail.name));
    });
    await page.goto('/?preview=mobile#plans');
    await expect(page.locator('[data-trip-context]')).toContainText('原来的旅行名称');
    const opener = page.locator('[data-triprename]');
    await opener.click();
    const dialog = page.locator('#tripRenameDialog');
    const input = dialog.locator('#tripRenameName');
    await expect(dialog).toHaveAccessibleName('重命名行程');
    await expect(input).toBeFocused();
    await input.fill('   ');
    await dialog.locator('button[type="submit"]').click();
    await expect(dialog.locator('[role="alert"]')).toHaveText('请输入行程名称');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await input.fill('');
    await expect(dialog.locator('[role="alert"]')).toBeHidden();
    await dialog.locator('button[type="submit"]').click();
    await expect(dialog.locator('[role="alert"]')).toHaveText('请输入行程名称');
    const geometry = await dialog.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const error = element.querySelector('[role="alert"]').getBoundingClientRect();
      return { fits: rect.top >= 0 && rect.bottom <= innerHeight, compact: rect.height < innerHeight * .9, overflow: element.scrollWidth > element.clientWidth, errorVisible: error.top >= rect.top && error.bottom <= rect.bottom };
    });
    expect(geometry).toEqual({ fits: true, compact: true, overflow: false, errorVisible: true });
    const contrast = await auditVisibleTextContrast(page, '#tripRenameDialog');
    expect(contrast.checked).toBeGreaterThan(4);
    expect(contrast.issues).toEqual([]);
    await page.screenshot({ path: `design/${browserName}-trip-rename-error-${viewport.width}.png` });
    await dialog.locator('[data-triprename-cancel]').click();
    await expect(opener).toBeFocused();
    await opener.click();
    await expect(input).toHaveValue('原来的旅行名称');
    await expect(dialog.locator('[role="alert"]')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await opener.click();
    await dialog.locator('button[type="submit"]').click();
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => window.__renameRequests)).toEqual([]);
    await opener.click();
    await input.fill('  新的旅行名称  ');
    await dialog.locator('button[type="submit"]').click();
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(page.locator('[data-trip-context]')).toContainText('新的旅行名称');
    await expect(page.locator('[data-plan-title]')).toHaveText('保留的方案名称');
    await expect(page.locator('[data-plan-dates]')).toHaveText('2026-11-03');
    expect(await page.evaluate(() => window.__renameRequests)).toEqual(['新的旅行名称']);
  });
}
