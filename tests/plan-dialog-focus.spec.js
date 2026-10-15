import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 360, height: 480 }, { width: 430, height: 640 }, { width: 1440, height: 900 }]) {
  test(`plan dialogs return focus after cancel, create, copy and delete at ${viewport.width}px`, async ({ page, browserName }) => {
    await page.setViewportSize(viewport);
    const mobile = viewport.width < 600;
    const snapshot = { name: '方案焦点测试旅行', items: [], schedule: [], locations: [], routes: [], expenses: [], placeCategories: [], preferences: {} };
    const fixture = { activeVersion: 'a', plans: [{ id: 'a', name: '原方案' }, { id: 'b', name: '备用方案' }], versions: { a: { ...snapshot, planKey: 'a' }, b: { ...snapshot, planKey: 'b' } }, locations: [], routes: [], sharedSchedule: {} };
    await page.route('**/api/planner-data', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: fixture }) }));
    await page.goto(`/?preview=${mobile ? 'mobile#plans' : 'desktop'}`);
    await expect(page.locator('#planSelect option')).toHaveCount(2);
    const dialog = page.locator('#planDialog');
    const opener = selector => page.locator(mobile ? `.mobile-plans-panel [data-command="${selector}"]` : selector);
    for (const [selector, name] of [['#newPlanBtn', '新建行程方案'], ['#copyPlanBtn', '复制行程方案'], ['#deletePlanBtn', '确认删除行程方案']]) {
      await opener(selector).click();
      await expect(dialog).toHaveAccessibleName(name);
      await expect(dialog.locator('#planDialogName')).toBeFocused();
      await dialog.locator('#planDialogCancel').click();
      await expect(opener(selector)).toBeFocused();
      await opener(selector).click();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(opener(selector)).toBeFocused();
    }
    await opener('#deletePlanBtn').click();
    await dialog.locator('#planDialogName').fill('错误名称');
    await dialog.locator('#planDialogSubmit').click();
    await expect(dialog.locator('#planDialogHint')).toHaveText('行程方案名称不匹配，请重新输入。');
    await expect(dialog).toHaveAccessibleDescription('行程方案名称不匹配，请重新输入。');
    const layout = await dialog.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const submit = element.querySelector('#planDialogSubmit').getBoundingClientRect();
      return { overflow: element.scrollWidth > element.clientWidth, fits: rect.top >= 0 && rect.bottom <= innerHeight, submitVisible: submit.top >= rect.top && submit.bottom <= rect.bottom };
    });
    expect(layout).toEqual({ overflow: false, fits: true, submitVisible: true });
    await expect(page.locator('#planSelect option')).toHaveCount(2);
    await page.screenshot({ path: `design/${browserName}-plan-dialog-${viewport.width}.png` });
    await dialog.locator('#planDialogName').fill('原方案');
    await dialog.locator('#planDialogSubmit').click();
    await expect(page.locator('#planSelect option')).toHaveCount(1);
    await expect(page.locator('#planSelect')).toBeFocused();
    await expect(opener('#deletePlanBtn')).toBeDisabled();
    await opener('#newPlanBtn').click();
    await dialog.locator('#planDialogName').fill('新的方案');
    await dialog.locator('#planDialogSubmit').click();
    await expect(dialog).toBeHidden();
    await expect(opener('#newPlanBtn')).toBeFocused();
    await expect(page.locator('#planSelect option')).toHaveCount(2);
    await opener('#copyPlanBtn').click();
    await dialog.locator('#planDialogName').fill('复制的方案');
    await dialog.locator('#planDialogSubmit').click();
    await expect(opener('#copyPlanBtn')).toBeFocused();
    await expect(page.locator('#planSelect option')).toHaveCount(3);
    await opener('#deletePlanBtn').click();
    await dialog.locator('#planDialogName').fill('复制的方案');
    await dialog.locator('#planDialogSubmit').click();
    await expect(page.locator('#planSelect option')).toHaveCount(2);
    await expect(opener('#deletePlanBtn')).toBeFocused();
  });
}
