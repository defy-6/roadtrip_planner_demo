import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 360, height: 640 }, { width: 430, height: 640 }]) {
  test(`place card buttons retain their own keyboard actions at ${viewport.width}px`, async ({ page, browserName }) => {
    await page.setViewportSize(viewport);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const place = { id: 'keyboard-place', name: '键盘测试客栈', type: 'hotel', address: '测试地址', resolved: { name: '键盘测试客栈', location: '120.1,30.2' } };
    const snapshot = { name: '键盘测试旅行', items: [], schedule: [{ type: 'hotel', title: '入住客栈', date: '2026-11-03', start: '18:00', end: '19:00', locationId: place.id }], locations: [place], routes: [], expenses: [], placeCategories: [], preferences: {} };
    const fixture = { activeVersion: 'a', plans: [{ id: 'a', name: '住宿方案' }], versions: { a: { ...snapshot, planKey: 'a' } }, locations: [place], routes: [], sharedSchedule: {} };
    await page.route('**/api/planner-data', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: fixture }) }));
    await page.goto('/?preview=mobile#places');
    const card = page.locator('[data-place-id="keyboard-place"].place-card');
    const map = card.locator('[data-place-card-action="map"]');
    const edit = card.locator('[data-place-card-action="edit"]');
    const dialog = page.locator('#placeEditor');
    for (const key of ['Enter', 'Space']) {
      await map.focus();
      await expect(map).toBeFocused();
      await page.keyboard.press(key);
      await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'map');
      await expect(dialog).toBeHidden();
      await expect(page.locator('.mobile-map-summary [data-map-summary-title]')).toHaveText(place.name);
      await page.screenshot({ path: `design/${browserName}-place-keyboard-map-${viewport.width}.png` });
      await page.locator('.mobile-tabbar [data-mobile-view="places"]').click();
      await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'places');
      await expect(edit).toBeVisible();
      await edit.focus();
      await expect(edit).toBeFocused();
      await page.keyboard.press(key);
      await expect(dialog).toHaveAccessibleName('编辑地点');
      await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'places');
      await expect(page.locator('#newPlaceName')).toHaveValue(place.name);
      await dialog.locator('#placeEditorCancel').click();
      await expect(edit).toBeFocused();
    }
    await card.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(card).toBeFocused();
    expect(errors).toEqual([]);
  });
}
