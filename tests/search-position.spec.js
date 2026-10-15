import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 360, height: 640 }, { width: 430, height: 852 }]) {
  test(`place search follows scrolling and viewport changes at ${viewport.width}px`, async ({ page, browserName }) => {
    await page.setViewportSize(viewport);
    const locations = Array.from({ length: 12 }, (_, index) => ({ id: `search-${index}`, name: `搜索地点 ${index}`, type: 'spot', address: `测试地址 ${index}` }));
    const snapshot = { name: '搜索测试旅行', items: [], schedule: [], locations, routes: [], expenses: [], placeCategories: [], preferences: {} };
    const fixture = { activeVersion: 'a', plans: [{ id: 'a', name: '原方案' }], versions: { a: { ...snapshot, planKey: 'a' } }, locations, routes: [], sharedSchedule: {} };
    await page.route('**/api/planner-data', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: fixture }) }));
    await page.goto('/?preview=mobile#schedule');
    await expect(page.locator('#planSelect option')).toHaveCount(1);
    await page.locator('#addScheduleBtn').click();
    const input = page.locator('#eventLocationSearch');
    await input.fill('');
    await input.focus();
    const panel = page.locator('.place-search-results[data-search-for="eventLocationSearch"]');
    await expect(panel.locator('.place-search-result')).toHaveCount(12);
    const aligned = () => panel.evaluate(element => {
      if (element.hidden) return false;
      const panel = element.getBoundingClientRect();
      const input = document.querySelector('#eventLocationSearch').getBoundingClientRect();
      const actions = document.querySelector('#eventEditor .editor-actions').getBoundingClientRect();
      const heading = document.querySelector('#eventEditor h3').getBoundingClientRect();
      if (panel.top < heading.bottom + 7) return false;
      return element.dataset.placement === 'above'
        ? panel.bottom <= Math.min(input.top - 4, actions.top - 8) + 1
        : panel.top >= input.bottom + 3 && panel.bottom <= actions.top - 7;
    });
    await expect.poll(aligned).toBe(true);
    await page.locator('#eventEditor .editor-form').evaluate(element => { element.scrollTop = Math.max(0, element.scrollTop - 20); });
    await expect.poll(aligned).toBe(true);
    await page.setViewportSize({ width: viewport.width, height: viewport.height - 80 });
    await expect(input).toBeFocused();
    await expect.poll(() => input.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const dialog = element.closest('dialog');
      return rect.top >= dialog.querySelector('h3').getBoundingClientRect().bottom && rect.bottom <= dialog.querySelector('.editor-actions').getBoundingClientRect().top - 8;
    })).toBe(true);
    await expect.poll(aligned).toBe(true);
    await page.screenshot({ path: `design/${browserName}-search-position-${viewport.width}.png` });
    await panel.locator('.place-search-result').first().click();
    await expect(page.locator('#eventLocation')).not.toHaveValue('');
    await expect(panel).toBeHidden();
    await page.locator('#editorCancel').click();
  });
}
