import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 360, height: 480 }, { width: 430, height: 640 }]) {
  test(`place photo selection keeps keyboard focus and saves only on confirmation at ${viewport.width}px`, async ({ page, browserName }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(viewport);
    const image = color => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="${color}"/><path d="M0 160 80 60 140 110 190 40 240 160" fill="#315e48"/></svg>`)}`;
    const photos = ['#c9e8ee', '#f5dfaf', '#dce5c9'].map((color, index) => ({ url: image(color), title: `测试山景 ${index + 1}`, poiName: '测试地点' }));
    const place = { id: 'photo-place', name: '测试地点', type: 'spot', address: '测试地址', photo: image('#eee8dc') };
    const snapshot = { name: '图片测试旅行', items: [], schedule: [], locations: [place], routes: [], expenses: [], placeCategories: [], preferences: {} };
    const fixture = { activeVersion: 'a', plans: [{ id: 'a', name: '图片测试方案' }], versions: { a: { ...snapshot, planKey: 'a' } }, locations: [place], routes: [], sharedSchedule: {} };
    await page.route('**/api/planner-data', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: fixture }) }));
    await page.route('**/api/place-photos?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ photos }) }));
    await page.goto('/?preview=mobile#places');
    const opener = page.locator('[data-place-id="photo-place"] [data-place-card-action="edit"]');
    const dialog = page.locator('#placeEditor');
    const current = dialog.locator('#newPlaceCurrentPhotoImage');
    const candidates = dialog.locator('#newPlacePhotoCandidates button');
    const loadPhotos = async () => {
      await dialog.locator('#queryNewPlacePhotos').click();
      await expect(candidates).toHaveCount(3);
      await expect(dialog.locator('#newPlacePhotoCandidates button[aria-pressed="true"]')).toHaveCount(0);
      for (const button of await candidates.all()) await expect(button).toHaveAttribute('aria-pressed', 'false');
    };
    await opener.click();
    await loadPhotos();
    const second = candidates.nth(1);
    await expect(second).toHaveAccessibleName('采用第 2 张高德图片：测试山景 2');
    await second.focus();
    await page.keyboard.press('Space');
    await expect(second).toBeFocused();
    expect(await second.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const dialog = element.closest('dialog');
      const actions = dialog.querySelector('.editor-actions').getBoundingClientRect();
      const heading = dialog.querySelector('h3').getBoundingClientRect();
      return rect.width >= 44 && rect.height >= 44 && rect.top >= heading.bottom && rect.bottom <= actions.top && dialog.scrollWidth <= dialog.clientWidth;
    })).toBe(true);
    await expect(second).toHaveAttribute('aria-pressed', 'true');
    await expect(candidates.nth(0)).toHaveAttribute('aria-pressed', 'false');
    await expect(current).toHaveAttribute('src', place.photo);
    await expect(dialog.locator('#newPlaceAmapStatus')).toContainText('保存地点后生效');
    await page.screenshot({ path: `design/${browserName}-place-photo-selection-${viewport.width}.png` });
    await dialog.locator('#placeEditorCancel').click();
    await expect(opener).toBeFocused();
    await opener.click();
    await expect(current).toHaveAttribute('src', place.photo);
    await expect(candidates).toHaveCount(0);
    await loadPhotos();
    await candidates.nth(1).click();
    await candidates.nth(2).focus();
    await page.keyboard.press('Enter');
    await expect(candidates.nth(2)).toBeFocused();
    await expect(candidates.nth(1)).toHaveAttribute('aria-pressed', 'false');
    await expect(candidates.nth(2)).toHaveAttribute('aria-pressed', 'true');
    await dialog.locator('[type="submit"]').click();
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await opener.click();
    await expect(current).toHaveAttribute('src', photos[2].url);
    await expect(candidates).toHaveCount(0);
    await dialog.locator('#placeEditorCancel').click();
    expect(errors).toEqual([]);
  });
}
