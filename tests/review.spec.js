import { expect, test } from '@playwright/test';

for (const width of [360, 393, 430]) {
  test(`review editing returns with saved notes and focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 640 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/?preview=mobile#plans');
    await expect(page.locator('#fileSaveStatus')).toContainText(/已从本地文件载入|已写入本地文件|已同步云端/);
    const payload = await page.request.get('/api/planner-data').then(response => response.json());
    const plan = payload.data.versions[payload.data.activeVersion];
    const index = plan.schedule.findIndex(event => event.type === 'spot');
    expect(index).toBeGreaterThanOrEqual(0);
    await page.locator('[data-review]').click();
    const dialog = page.locator('#planReviewDialog');
    const expenses = dialog.locator('.review-expenses').first();
    await expenses.locator('summary').click();
    const edit = dialog.locator(`[data-review-edit="${index}"]`);
    await edit.click();
    await expect(page.locator('#eventEditor')).toBeVisible();
    await expect(page.locator('#editorName')).toHaveValue(plan.schedule[index].title);
    await page.locator('#editorCancel').click();
    await expect(page.locator('#eventEditor')).toBeHidden();
    await expect(edit).toBeFocused();
    await expect(expenses).toHaveAttribute('open', '');
    await dialog.locator('img').evaluateAll(images => Promise.all(images.filter(image => image.getBoundingClientRect().top < window.innerHeight).map(image => image.decode().catch(() => {}))));
    await edit.click();
    const scrollTop = await dialog.locator('.editor-form').evaluate(element => element.scrollTop);
    const note = `回顾备注验证 ${width}px`;
    await page.locator('#editorNote').fill(note);
    await page.locator('#editorAddress').fill('');
    await page.locator('#editorForm button[type="submit"]').click();
    await expect(page.locator('#eventEditor')).toBeHidden();
    await expect(edit.locator('..')).toContainText(note);
    await expect(edit).toBeFocused();
    const geometry = await dialog.locator('.editor-form').evaluate(element => ({ scroll: element.scrollTop, overflow: element.scrollWidth > element.clientWidth }));
    expect(Math.abs(geometry.scroll - scrollTop)).toBeLessThanOrEqual(2);
    expect(geometry.overflow).toBe(false);
    await expect(expenses).toHaveAttribute('open', '');
    await page.screenshot({ path: `design/review-edit-verified-${width}.png` });
    await dialog.locator('[data-review-close]').click();
    await expect(page.locator('[data-review]')).toBeFocused();
    expect(errors).toEqual([]);
  });
}

test('current source review remains read-only in share mode', async ({ page }) => {
  const payload = await page.request.get('/api/planner-data').then(response => response.json());
  await page.addInitScript(data => {
    window.__ROADTRIP_SHARE_MODE__ = true;
    window.__ROADTRIP_SHARE_DATA__ = data;
  }, payload.data);
  await page.setViewportSize({ width: 393, height: 640 });
  await page.goto('/?preview=mobile#plans');
  await expect(page.locator('#fileSaveStatus')).toContainText('共享只读版');
  await page.locator('[data-review]').click();
  await expect(page.locator('#planReviewDialog .review-event')).not.toHaveCount(0);
  await expect(page.locator('[data-review-edit]')).toHaveCount(0);
  await expect(page.locator('#eventEditor')).toBeHidden();
});

for (const width of [360, 393, 430]) {
  test(`review date change keeps the edited event visible with long notes at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 640 });
    await page.goto('/?preview=mobile#plans');
    await expect(page.locator('#fileSaveStatus')).toContainText(/已从本地文件载入|已写入本地文件|已同步云端/);
    const payload = await page.request.get('/api/planner-data').then(response => response.json());
    const index = payload.data.versions[payload.data.activeVersion].schedule.findIndex(event => event.type === 'spot');
    await page.locator('[data-review]').click();
    const dialog = page.locator('#planReviewDialog');
    const edit = dialog.locator(`[data-review-edit="${index}"]`);
    await edit.click();
    await page.locator('#editorDate').fill('2026-09-02');
    const note = `第一行备注\n${'LongTravelNote'.repeat(18)}\n第三行备注`;
    await page.locator('#editorNote').fill(note);
    await page.locator('#editorAddress').fill('');
    await page.locator('#editorForm button[type="submit"]').click();
    await expect(page.locator('#eventEditor')).toBeHidden();
    await expect(edit.locator('..')).toBeFocused();
    await expect(edit.locator('..')).toContainText(note);
    await expect(edit.locator('..').locator('..').locator('h4')).toHaveText('2026-09-02');
    const geometry = await edit.evaluate(button => {
      const dayHeading = button.closest('.review-day').querySelector('h4').getBoundingClientRect();
      const rect = button.closest('.review-event').querySelector('b').getBoundingClientRect();
      const form = button.closest('.editor-form');
      const actions = form.querySelector('.editor-actions').getBoundingClientRect();
      return { visible: dayHeading.top >= form.querySelector('.review-header').getBoundingClientRect().bottom && rect.bottom <= actions.top, overflow: form.scrollWidth > form.clientWidth };
    });
    expect(geometry).toEqual({ visible: true, overflow: false });
    await page.screenshot({ path: `design/review-date-long-note-${width}.png` });
  });
}

test('review deletion does not focus the next event occupying the same index', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/?preview=mobile#plans');
  await expect(page.locator('#fileSaveStatus')).toContainText(/已从本地文件载入|已写入本地文件|已同步云端/);
  await page.locator('[data-review]').click();
  const dialog = page.locator('#planReviewDialog');
  const count = await dialog.locator('.review-event').count();
  await dialog.locator('[data-review-edit]').first().click();
  await page.locator('#editorDelete').click();
  await page.locator('.action-confirm-dialog [data-confirm-submit]').click();
  await expect(page.locator('#eventEditor')).toBeHidden();
  await expect(dialog.locator('.review-event')).toHaveCount(count - 1);
  await expect(dialog.locator('[data-review-close]')).toBeFocused();
});
