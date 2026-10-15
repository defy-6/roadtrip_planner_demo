import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 360, height: 480 }, { width: 430, height: 640 }]) {
  test(`place deletion cancels safely and returns to add entry at ${viewport.width}px`, async ({ page, browserName }) => {
    await page.setViewportSize(viewport);
    const name = '很长的景点名称与访问提示'.repeat(8);
    const locations = [{ id: 'delete-a', name, type: 'spot', address: '测试地址' }, { id: 'keep-b', name: '保留地点', type: 'spot' }];
    const snapshot = { name: '删除测试旅行', items: [], schedule: [], locations, routes: [], expenses: [], placeCategories: [], preferences: {} };
    const fixture = { activeVersion: 'a', plans: [{ id: 'a', name: '原方案' }], versions: { a: { ...snapshot, planKey: 'a' } }, locations, routes: [], sharedSchedule: {} };
    await page.route('**/api/planner-data', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: fixture }) }));
    await page.goto('/?preview=mobile#places');
    const card = page.locator('.locations-panel [data-place-id="delete-a"]');
    await card.locator('[data-place-card-action="edit"]').click();
    const remove = page.locator('#placeEditorDelete');
    const confirmation = page.locator('.action-confirm-dialog');
    await remove.click();
    await expect(confirmation).toHaveAccessibleName('删除地点');
    await expect(confirmation.locator('#actionConfirmMessage')).toContainText(name);
    await expect(confirmation.locator('[data-confirm-cancel]')).toBeFocused();
    await confirmation.locator('[data-confirm-cancel]').click();
    await expect(remove).toBeFocused();
    await expect(page.locator('#placeEditor')).toBeVisible();
    await expect(card).toHaveCount(1);
    await remove.click();
    await page.keyboard.press('Escape');
    await expect(remove).toBeFocused();
    await expect(card).toHaveCount(1);
    await remove.click();
    const geometry = await confirmation.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const action = element.querySelector('[data-confirm-submit]').getBoundingClientRect();
      return { fits: rect.top >= 0 && rect.bottom <= innerHeight, horizontal: element.scrollWidth > element.clientWidth, actionVisible: action.top >= rect.top && action.bottom <= rect.bottom };
    });
    expect(geometry).toEqual({ fits: true, horizontal: false, actionVisible: true });
    await page.screenshot({ path: `design/${browserName}-place-delete-${viewport.width}.png` });
    await confirmation.locator('[data-confirm-submit]').click();
    await expect(page.locator('#placeEditor')).toBeHidden();
    await expect(card).toHaveCount(0);
    await expect(page.locator('.locations-panel [data-place-id="keep-b"]')).toHaveCount(1);
    await expect(page.locator('#addPlaceBtn')).toBeFocused();
  });
}
