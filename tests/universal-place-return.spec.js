import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 360, height: 480 }, { width: 430, height: 640 }]) {
  test(`personal place library returns focus across import and editing at ${viewport.width}px`, async ({ page, browserName }) => {
    await page.setViewportSize(viewport);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    const locations = Array.from({ length: 12 }, (_, index) => ({ id: `personal-${index}`, name: `个人地点 ${index}`, type: 'spot', address: `测试地址 ${index}` }));
    const snapshot = { name: '个人地点测试旅行', items: [], schedule: [], locations: [], routes: [], expenses: [], placeCategories: [], preferences: {} };
    const fixture = { activeVersion: 'a', plans: [{ id: 'a', name: '原方案' }], versions: { a: { ...snapshot, planKey: 'a' } }, locations, routes: [], sharedSchedule: {} };
    await page.route('**/api/planner-data', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: fixture }) }));
    await page.goto('/?preview=mobile#places');
    const opener = page.locator('[data-place-action="universal"]');
    const library = page.locator('#universalPlaceDialog');
    await opener.click();
    await expect(library).toHaveAccessibleName('我的地点库');
    await expect(library).toHaveAccessibleDescription('账号地点可跨行程复用；协作者看不到这里的私有地点。');
    await library.locator('.editor-form').evaluate(element => { element.scrollTop = element.scrollHeight; });
    const geometry = await library.evaluate(element => {
      const form = element.querySelector('.editor-form');
      return { actionsAtBottom: Math.abs(element.querySelector('.editor-actions').getBoundingClientRect().bottom - element.getBoundingClientRect().bottom) <= 1, overflowing: form.scrollHeight > form.clientHeight, horizontal: form.scrollWidth > form.clientWidth, titleAligned: Math.abs(element.querySelector('h3').getBoundingClientRect().top - form.getBoundingClientRect().top) <= 1, opaque: getComputedStyle(element.querySelector('h3')).backgroundColor === 'rgb(255, 255, 255)' };
    });
    expect(geometry).toEqual({ actionsAtBottom: true, overflowing: true, horizontal: false, titleAligned: true, opaque: true });
    await page.screenshot({ path: `design/${browserName}-personal-place-return-${viewport.width}.png` });
    await page.locator('#closeUniversalPlaceDialog').click();
    await expect(opener).toBeFocused();
    await opener.click();
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
    await opener.click();
    await library.locator('[data-universal-place-id="personal-0"] [data-universal-action="edit"]').click();
    const editor = page.locator('#placeEditor');
    await expect(library).toBeHidden();
    await expect(editor).toHaveAccessibleName('编辑地点');
    await expect(page.locator('#newPlaceName')).toHaveValue('个人地点 0');
    await expect(page.locator('#newPlaceName')).toBeFocused();
    await page.locator('#placeEditorCancel').click();
    expect(pageErrors).toEqual([]);
    const importedId = await page.locator('.locations-panel .place-card', { hasText: '个人地点 0' }).getAttribute('data-place-id');
    expect(importedId).not.toBe('personal-0');
    const currentEdit = page.locator(`.locations-panel [data-place-id="${importedId}"] [data-place-card-action="edit"]`);
    await expect(currentEdit).toBeFocused();
    await currentEdit.click();
    await page.locator('#newPlaceName').fill('修改后的个人地点');
    await editor.locator('[type="submit"]').click();
    await expect(currentEdit).toBeFocused();
    await expect(currentEdit.locator('xpath=ancestor::article')).toContainText('修改后的个人地点');
    expect(pageErrors).toEqual([]);
  });
}
