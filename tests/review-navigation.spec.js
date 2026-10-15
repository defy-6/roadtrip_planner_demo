import { expect, test } from '@playwright/test';

for (const width of [360, 393, 430]) {
  test(`review date navigation keeps the destination below the header at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 640 });
    await page.goto('/?preview=mobile#plans');
    await expect(page.locator('#fileSaveStatus')).toContainText(/已从本地文件载入|已写入本地文件|已同步云端/);
    const originalFilter = await page.locator('#dayFilter').inputValue();
    await page.locator('[data-review]').click();
    const dialog = page.locator('#planReviewDialog');
    const days = dialog.locator('.review-day');
    const count = await days.count();
    const date = await days.last().getAttribute('data-review-date');
    await dialog.locator('select[data-review-date]').selectOption(date);
    await expect(days.last().locator('h4')).toBeFocused();
    await expect(days).toHaveCount(count);
    await expect(page.locator('#dayFilter')).toHaveValue(originalFilter);
    const geometry = await dialog.evaluate(element => {
      const form = element.querySelector('.editor-form');
      const header = element.querySelector('.review-header').getBoundingClientRect();
      const select = element.querySelector('select[data-review-date]').getBoundingClientRect();
      const heading = element.querySelector('.review-day:last-child h4').getBoundingClientRect();
      return { headingVisible: heading.top >= header.bottom && heading.bottom < element.querySelector('.editor-actions').getBoundingClientRect().top, controlVisible: select.top >= form.getBoundingClientRect().top && select.right <= form.getBoundingClientRect().right, headerCoversTop: header.top <= form.getBoundingClientRect().top + 1, controlHeight: select.height, overflow: form.scrollWidth > form.clientWidth };
    });
    expect(geometry.headingVisible).toBe(true);
    expect(geometry.controlVisible).toBe(true);
    expect(geometry.headerCoversTop).toBe(true);
    expect(geometry.controlHeight).toBeGreaterThanOrEqual(44);
    expect(geometry.overflow).toBe(false);
    await page.screenshot({ path: `design/review-date-navigation-${width}.png` });
    const firstDate = await days.first().getAttribute('data-review-date');
    await dialog.locator('select[data-review-date]').selectOption(firstDate);
    await expect(days.first().locator('h4')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-review]')).toBeFocused();
    await page.locator('[data-review]').click();
    await expect(dialog.locator('select[data-review-date]')).toHaveValue('');
    expect(await dialog.locator('.editor-form').evaluate(element => element.scrollTop)).toBe(0);
  });
}

test('review date navigation supports undated and expense-only days in read-only mode', async ({ page }) => {
  const payload = await page.request.get('/api/planner-data').then(response => response.json());
  const plan = payload.data.versions[payload.data.activeVersion];
  plan.schedule = [{ title: '未定日期安排', type: 'spot', detail: '稍后确定', date: '' }];
  plan.expenses = [{ id: 'review-fixture', date: '2026-09-04', amount: 15, category: '其他', title: '停车', item: '停车' }];
  await page.addInitScript(data => { window.__ROADTRIP_SHARE_MODE__ = true; window.__ROADTRIP_SHARE_DATA__ = data; }, payload.data);
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/?preview=mobile#plans');
  await expect(page.locator('#fileSaveStatus')).toContainText('共享只读版');
  await page.locator('[data-review]').click();
  const select = page.locator('select[data-review-date]');
  await expect(select.locator('option')).toContainText(['跳转日期', '2026-09-04', '未设置日期']);
  await select.selectOption('undated');
  await expect(page.locator('.review-day[data-review-date="undated"] h4')).toBeFocused();
  await expect(page.locator('[data-review-edit]')).toHaveCount(0);
});

test('empty read-only review disables date navigation and keeps closing available', async ({ page }) => {
  const payload = await page.request.get('/api/planner-data').then(response => response.json());
  const plan = payload.data.versions[payload.data.activeVersion];
  plan.schedule = [];
  plan.expenses = [];
  await page.addInitScript(data => { window.__ROADTRIP_SHARE_MODE__ = true; window.__ROADTRIP_SHARE_DATA__ = data; }, payload.data);
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/?preview=mobile#plans');
  await expect(page.locator('#fileSaveStatus')).toContainText('共享只读版');
  await page.locator('[data-review]').click();
  await expect(page.locator('select[data-review-date]')).toBeDisabled();
  await expect(page.locator('#planReviewDialog')).toContainText('当前方案暂无安排');
  await page.locator('[data-review-close]').click();
  await expect(page.locator('[data-review]')).toBeFocused();
});
