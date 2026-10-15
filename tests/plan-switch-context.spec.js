import { expect, test } from './helpers/safety-browser.mjs';

for (const viewport of [{ width: 360, height: 640 }, { width: 430, height: 640 }]) {
  test(`plan list switching lands on the new plan context at ${viewport.width}px`, async ({ page, browserName }) => {
    await page.setViewportSize(viewport);
    const snapshot = date => ({ name: '山海旅行', items: [], schedule: [{ type: 'spot', title: '测试景点', date, start: '09:00', end: '10:00' }], locations: [], routes: [], expenses: [], placeCategories: [], preferences: {} });
    const fixture = { activeVersion: 'a', plans: [{ id: 'a', name: '原始方案' }, { id: 'b', name: '备用方案' }], versions: { a: { ...snapshot('2026-11-02'), planKey: 'a' }, b: { ...snapshot('2026-11-03'), planKey: 'b' } }, locations: [], routes: [], sharedSchedule: {} };
    await page.route('**/api/planner-data', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: fixture }) }));
    await page.goto('/?preview=mobile#plans');
    const overview = page.locator('.mobile-current-plan');
    const panel = page.locator('.mobile-plans-panel');
    // Hydration may create options before planner:ready replaces the list.
    // Keyboard focus must target the final, actionable controls, not that transient DOM.
    await expect(overview).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'plans');
    for (const [id, name, date, key] of [['b', '备用方案', '2026-11-03', 'Enter'], ['a', '原始方案', '2026-11-02', 'Space']]) {
      const button = page.locator(`[data-plan-value="${id}"]`);
      await button.focus();
      await expect(button).toBeFocused();
      await page.keyboard.press(key);
      await expect(page.locator('#planSelect')).toHaveValue(id);
      await expect(overview).toBeFocused();
      await expect(overview).toHaveAccessibleName(name);
      await expect(overview).toHaveAccessibleDescription(`所属行程：山海旅行 ${date} 当前方案：1 个有安排日期`);
      await expect(panel).toHaveJSProperty('scrollTop', 0);
      expect(await overview.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const panel = element.closest('.mobile-plans-panel').getBoundingClientRect();
        return rect.top >= panel.top && rect.bottom <= panel.bottom && Number.parseFloat(getComputedStyle(element).outlineOffset) < 0;
      })).toBe(true);
      await expect(page.locator(`[data-plan-value="${id}"]`)).toHaveCount(0);
      await expect(overview.locator('[data-plan-dates]')).toHaveText(date);
      await page.screenshot({ path: `design/${browserName}-plan-switch-context-${viewport.width}.png` });
      const scheduleLink = overview.locator('a[href="#schedule"]');
      if (browserName === 'chromium') {
        await page.keyboard.press('Tab');
      } else {
        // This WebKit runtime skips anchors in its default Tab order (also in an isolated fixture).
        // Verify native Enter activation without changing the app's platform keyboard policy.
        await scheduleLink.focus();
      }
      await expect(scheduleLink).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'schedule');
      await expect(page.locator('#planSelect')).toHaveValue(id);
      await expect(page.locator(`#dayFilter option[value="${date}"]`)).toHaveCount(1);
      await expect(page.locator('#schedule')).toContainText('测试景点');
      await page.locator('.mobile-tabbar [data-mobile-view="plans"]').click();
      await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'plans');
    }
    const select = page.locator('#planSelect');
    await select.focus();
    await select.selectOption('b');
    await expect(select).toBeFocused();
    await expect(overview.locator('[data-plan-title]')).toHaveText('备用方案');
  });
}
