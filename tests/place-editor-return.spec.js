import { expect, test } from '@playwright/test';
import { auditVisibleTextContrast } from './helpers/text-contrast.js';

for (const viewport of [{ width: 360, height: 480 }, { width: 430, height: 640 }]) {
  test(`place editor keeps long details scrollable and returns to rebuilt card at ${viewport.width}px`, async ({ page, browserName }) => {
    await page.setViewportSize(viewport);
    const place = { id: 'place-a', name: '测试地点', type: 'spot', address: '测试地址', note: '长备注内容。'.repeat(100), poiDetails: { intro: '地点介绍。'.repeat(100) } };
    const tripName = '地点编辑测试长名称旅行'.repeat(3);
    const planName = '当前测试长名称行程方案'.repeat(3);
    const snapshot = { name: tripName, items: [], schedule: [], locations: [place], routes: [], expenses: [], placeCategories: [], preferences: {} };
    const fixture = { activeVersion: 'a', plans: [{ id: 'a', name: planName }, { id: 'b', name: '空白备用方案' }], versions: { a: { ...snapshot, planKey: 'a' }, b: { ...snapshot, locations: [], planKey: 'b' } }, locations: [place], routes: [], sharedSchedule: {} };
    await page.route('**/api/planner-data', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: fixture }) }));
    await page.goto('/?preview=mobile#places');
    const opener = page.locator('.locations-panel [data-place-id="place-a"] [data-place-card-action="edit"]');
    const dialog = page.locator('#placeEditor');
    await opener.click();
    await expect(dialog).toHaveAccessibleName('编辑地点');
    await expect(dialog).toHaveAccessibleDescription(`所属行程：${tripName} 当前方案：${planName}`);
    await expect(page.locator('#placeEditorContext')).toBeVisible();
    const contextFits = await page.locator('#placeEditorContext').evaluate(element => {
      const rect = element.getBoundingClientRect();
      const dialogRect = element.closest('dialog').getBoundingClientRect();
      return rect.left >= dialogRect.left && rect.right <= dialogRect.right && rect.top >= dialogRect.top && rect.bottom <= dialogRect.bottom;
    });
    expect(contextFits).toBe(true);
    const contrast = await auditVisibleTextContrast(page, '#placeEditorContext');
    expect(contrast.checked).toBeGreaterThan(0);
    expect(contrast.issues).toEqual([]);
    await page.screenshot({ path: `design/${browserName}-place-editor-context-${viewport.width}.png` });
    await expect(page.locator('#newPlaceName')).toBeFocused();
    await expect(dialog.locator('.place-photo-section')).toHaveCount(1);
    await expect(dialog.locator('.place-details-section')).toHaveCount(1);
    await expect(dialog.locator('.place-photo-upload-name')).toHaveText('未选择图片');
    await dialog.locator('.place-photo-section').evaluate(element => { element.open = true; });
    await dialog.locator('#newPlacePhoto').setInputFiles({
      name: '测试照片.png', mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7s8AAAAASUVORK5CYII=', 'base64')
    });
    await expect(dialog.locator('.place-photo-upload-name')).toHaveText('测试照片.png');
    await page.locator('#placeEditorCancel').click();
    await expect(opener).toBeFocused();
    await opener.click();
    await expect(dialog.locator('.place-photo-upload-name')).toHaveText('未选择图片');
    expect(await dialog.locator('#newPlacePhoto').evaluate(element => element.files.length)).toBe(0);
    expect(await dialog.locator('.place-photo-section').evaluate(element => element.open)).toBe(false);
    expect(await dialog.locator('.place-details-section').evaluate(element => element.open)).toBe(false);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await opener.click();
    const form = dialog.locator('.editor-form');
    await dialog.locator('.place-details-section').evaluate(element => { element.open = true; });
    await form.evaluate(element => { element.scrollTop = element.scrollHeight; });
    const layout = await dialog.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const form = element.querySelector('.editor-form');
      const action = element.querySelector('[type="submit"]').getBoundingClientRect();
      const title = element.querySelector('h3').getBoundingClientRect();
      return { headerAligned: Math.abs(title.top - form.getBoundingClientRect().top) <= 1, overflowing: form.scrollHeight > form.clientHeight, horizontal: form.scrollWidth > form.clientWidth, visible: action.top >= rect.top && action.bottom <= rect.bottom, opaque: getComputedStyle(element.querySelector('.editor-actions')).backgroundColor === 'rgb(255, 255, 255)' };
    });
    expect(layout).toEqual({ headerAligned: true, overflowing: true, horizontal: false, visible: true, opaque: true });
    await page.screenshot({ path: `design/${browserName}-place-editor-return-${viewport.width}.png` });
    await page.locator('#newPlaceName').fill('修改后的地点');
    await dialog.locator('[type="submit"]').click();
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(opener.locator('xpath=ancestor::article')).toContainText('修改后的地点');
    await page.locator('#planSelect').selectOption('b');
    await expect(page.locator('#planSelect')).toHaveValue('b');
    await page.locator('#addPlaceBtn').click();
    await expect(dialog).toHaveAccessibleName('新增地点');
    await expect(dialog).toHaveAccessibleDescription(`所属行程：${tripName} 当前方案：空白备用方案`);
    await page.locator('#placeEditorCancel').click();
    await expect(page.locator('#addPlaceBtn')).toBeFocused();
  });
}
