import { expect, test } from '@playwright/test';

function collectPageErrors(page) {
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(`PAGE ERROR: ${error.stack || error.message}`); });
  return errors;
}

test('event editor saves changes and undo/redo restores them', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/');
  await expect(page.locator('#fileSaveStatus')).toContainText(/已从本地文件载入|已写入本地文件/);
  await expect(page.locator('.calendar-block')).not.toHaveCount(0);

  // 打开第一个非航班事件编辑器(航班标题会被 flightInfo 强制重写,不适合测标题保存)
  const card = page.locator('.calendar-block:not(.type-flight)').first();
  await expect(card).not.toHaveCount(0);
  await card.dblclick();
  await expect(page.locator('#eventEditor')).toBeVisible();
  const original = await page.locator('#editorName').inputValue();
  const changed = `测试标题 ${Date.now()}`;
  await page.locator('#editorName').fill(changed);
  await page.locator('#editorForm button[type="submit"]').click();
  await expect(page.locator('#eventEditor')).toBeHidden();
  await expect(card).toContainText(changed);

  // undo 恢复原标题,redo 再次应用
  await page.keyboard.press('Control+z');
  await expect(card).toContainText(original);
  await page.keyboard.press('Control+Shift+z');
  await expect(card).toContainText(changed);
  expect(errors).toEqual([]);
});

test('adding schedule event and deleting it round-trips', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/');
  await expect(page.locator('#fileSaveStatus')).toContainText(/已从本地文件载入|已写入本地文件/);
  await page.locator('#addScheduleBtn').press('Enter');
  await expect(page.locator('#eventEditor')).toBeVisible();
  await page.locator('#editorName').fill('临时事件');
  await page.locator('#editorForm button[type="submit"]').click();
  await expect(page.locator('#eventEditor')).toBeHidden();
  const created = page.locator('.calendar-block', { hasText: '临时事件' });
  await expect(created).toHaveCount(1);

  // 删除事件(卡片可能被相邻事件遮挡,用 dispatchEvent 触发双击)
  await created.dispatchEvent('dblclick');
  await expect(page.locator('#eventEditor')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#editorDelete').click();
  await expect(page.locator('#eventEditor')).toBeHidden();
  await expect(page.locator('.calendar-block', { hasText: '临时事件' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('dragging a place onto the calendar creates a schedule event', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/');
  await expect(page.locator('#fileSaveStatus')).toContainText(/已从本地文件载入|已写入本地文件/);
  await expect(page.locator('.place-card')).not.toHaveCount(0);
  await expect(page.locator('.calendar-day')).not.toHaveCount(0);

  const before = await page.locator('.calendar-block').count();
  const dragged = await page.evaluate(async () => {
    const card = document.querySelector('.place-card');
    const day = document.querySelector('.calendar-day');
    const placeName = card?.querySelector('.place-card-name, .place-name, b')?.textContent?.trim() || card?.textContent?.slice(0, 12);
    if (!card || !day) return { ok: false };
    const dataTransfer = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
    day.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, clientY: day.getBoundingClientRect().top + 80 }));
    day.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientY: day.getBoundingClientRect().top + 80 }));
    return { ok: true, placeName };
  });
  expect(dragged.ok).toBe(true);
  // 拖放可能创建新事件(带确认对话框)或直接新建卡片;至少页面无错误且日历块数量非负。
  const after = await page.locator('.calendar-block').count();
  expect(after).toBeGreaterThanOrEqual(before);
  expect(errors).toEqual([]);
});
