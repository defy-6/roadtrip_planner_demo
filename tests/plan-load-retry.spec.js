import { expect, test } from './helpers/safety-browser.mjs';
import { plannerSafetyFixture } from './fixtures/planner-safety.mjs';

// 合成行程：仅用于验证“读取失败 → 明确提示 + 安全重试 → 恢复”的界面契约。
const fixture = plannerSafetyFixture;

async function stubPlannerData(page, failCount) {
  let attempts = 0;
  let writes = 0;
  await page.route('**/api/planner-data', async route => {
    // 非读取请求交给隔离测试服务处理，避免伪造响应导致保存时间戳缺失。
    if (route.request().method() !== 'GET') {
      writes++;
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, savedAt: new Date().toISOString() }) });
    }
    attempts += 1;
    if (attempts <= failCount) {
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'synthetic failure' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: fixture }) });
  });
  const readCount = () => attempts;
  readCount.writes = () => writes;
  return readCount;
}

test('mobile read failure shows a clear message and recovers through a safe retry', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 780 });
  const attempts = await stubPlannerData(page, 1);
  await page.goto('/?preview=mobile#plans');

  const overview = page.locator('.mobile-current-plan');
  const retry = overview.locator('[data-plan-retry]');
  await expect(retry).toBeVisible();
  await expect(overview.locator('[data-plan-load-status]')).toHaveText('未能读取行程数据，当前显示本地预设，请刷新重试。');

  await retry.click();
  await expect(overview.locator('[data-plan-load-status]')).toBeHidden();
  await expect(retry).toBeHidden();
  await expect(overview.locator('[data-plan-title]')).toHaveText('合成行程方案');
  await expect(overview.locator('[data-plan-summary]')).toHaveText('当前方案：1 个有安排日期');
  expect(attempts()).toBe(2);
});

test('mobile read failure retry stays safe when the retry also fails', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 780 });
  const attempts = await stubPlannerData(page, 99);
  await page.goto('/?preview=mobile#plans');

  const overview = page.locator('.mobile-current-plan');
  const retry = overview.locator('[data-plan-retry]');
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(retry).toBeVisible();
  await expect(overview.locator('[data-plan-load-status]')).toHaveText('未能读取行程数据，当前显示本地预设，请刷新重试。');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  expect(attempts.writes()).toBe(0);
  await page.screenshot({ path: 'design/chromium-plan-retry-failed-430.png' });
});

test('retry with an existing cache and an empty response never writes or destroys the cache', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 780 });
  let mode = 'valid', writes = 0;
  await page.route('**/api/planner-data', route => {
    if (route.request().method() !== 'GET') {
      writes++;
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, savedAt: new Date().toISOString() }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: mode === 'valid' ? fixture : null }) });
  });
  await page.goto('/?preview=mobile#plans');
  await expect(page.locator('[data-plan-title]')).toHaveText('合成行程方案');
  mode = 'empty';
  await page.reload();
  const retry = page.locator('[data-plan-retry]');
  await expect(retry).toBeVisible();
  await expect(page.locator('[data-plan-title]')).toHaveText('合成行程方案');
  const before = writes;
  await retry.click();
  await expect(retry).toBeVisible();
  await expect(page.locator('[data-plan-load-status]')).toContainText('离线缓存');
  expect(writes).toBe(before);
  const cache = await page.evaluate(async () => {
    const { createPlannerCache } = await import('/storage/planner-cache.js');
    return createPlannerCache({ scope: 'local' }).read('local');
  });
  expect(cache.versions.dated.schedule[0].title).toBe('合成午餐');
});

test('unsaved edits survive cancelled retry and export, then require explicit discard', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 780 });
  const attempts = await stubPlannerData(page, 1);
  await page.goto('/?preview=mobile#plans');
  await expect(page.locator('[data-plan-retry]')).toBeVisible();
  await page.locator('[data-triprename]').click();
  await page.locator('#tripRenameName').fill('未保存的本地旅行');
  await page.locator('#tripRenameDialog button[type="submit"]').click();
  await page.locator('[data-plan-retry]').click();
  const confirmation = page.locator('.action-confirm-dialog');
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText('尚未保存的本地修改');
  await page.screenshot({ path: `design/${test.info().project.name}-retry-draft-confirm-430.png` });
  await confirmation.locator('[data-confirm-cancel]').click();
  await expect(page.locator('[data-plan-load-status]')).toContainText('本地修改已保留');
  await expect(page.locator('#tripName')).toHaveValue('未保存的本地旅行');
  expect(attempts()).toBe(1);
  expect(attempts.writes()).toBe(0);
  const download = page.waitForEvent('download');
  await page.locator('[data-command="#exportBtn"]').click();
  expect((await download).suggestedFilename()).toBe('roadtrip-plan.json');
  await page.locator('.mobile-current-plan').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `design/${test.info().project.name}-retry-draft-preserved-430.png` });
  await page.locator('[data-plan-retry]').click();
  await confirmation.locator('[data-confirm-submit]').click();
  await expect(page.locator('[data-plan-retry]')).toBeHidden();
  await expect(page.locator('#tripName')).toHaveValue('合成行程');
  expect(attempts()).toBe(2);
});

test('desktop read failure exposes a header retry that clears after recovery', async ({ page }) => {
  // 桌面路径会等待地图按需初始化，读取失败态出现得比移动端晚，因此放宽等待。
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await stubPlannerData(page, 1);
  await page.goto('/?preview=desktop');

  const status = page.locator('#fileSaveStatus');
  const retry = page.locator('#retryLoadBtn');
  await expect(retry).toBeVisible({ timeout: 25_000 });
  await expect(status).toContainText('读取失败');

  await retry.click();
  // 读取成功后恢复正常保存：状态离开读取失败态并进入保存流程。
  await expect(retry).toBeHidden({ timeout: 25_000 });
  await expect(status).not.toContainText('读取失败');
  await expect(status).toContainText(/本地已保存|已同步云端|网络不可用/);
});
