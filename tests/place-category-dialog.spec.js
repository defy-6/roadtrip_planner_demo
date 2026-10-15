import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 360, height: 480 }, { width: 430, height: 640 }]) {
  test(`place category dialog is labelled, compact and restores its entry at ${viewport.width}px`, async ({ page, browserName }) => {
    await page.setViewportSize(viewport);
    const snapshot = { name: '类别测试旅行', items: [], schedule: [], locations: [], routes: [], expenses: [], placeCategories: [], preferences: {} };
    const fixture = { activeVersion: 'a', plans: [{ id: 'a', name: '原方案' }], versions: { a: { ...snapshot, planKey: 'a' } }, locations: [], routes: [], sharedSchedule: {} };
    await page.route('**/api/planner-data', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: fixture }) }));
    await page.goto('/?preview=mobile#places');
    const opener = page.locator('#addPlaceCategoryBtn');
    const dialog = page.locator('#placeCategoryEditor');
    await opener.click();
    await expect(dialog).toHaveAccessibleName('新增地点类别');
    await expect(dialog).toHaveAccessibleDescription('仅当前计划可用；地点库中的地点仍可跨计划复用。');
    await expect(page.locator('#newPlaceCategoryName')).toBeFocused();
    const geometry = await dialog.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const action = element.querySelector('[type="submit"]').getBoundingClientRect();
      return { fits: rect.top >= 0 && rect.bottom <= innerHeight, overflow: element.scrollWidth > element.clientWidth, actionVisible: action.bottom <= rect.bottom, opaque: getComputedStyle(element.querySelector('h3')).backgroundColor === 'rgb(255, 255, 255)' };
    });
    expect(geometry).toEqual({ fits: true, overflow: false, actionVisible: true, opaque: true });
    await page.screenshot({ path: `design/${browserName}-place-category-${viewport.width}.png` });
    await page.locator('#placeCategoryEditorCancel').click();
    await expect(opener).toBeFocused();
    await opener.click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await opener.click();
    await page.locator('#newPlaceCategoryName').fill('露营');
    await dialog.locator('[type="submit"]').click();
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(page.locator('.mobile-category-chips')).toContainText('露营');
  });
}
