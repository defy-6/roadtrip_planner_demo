import { expect, test } from '@playwright/test';

function collectPageErrors(page) {
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(`PAGE ERROR: ${error.stack || error.message}`); });
  return errors;
}

test('desktop planner loads current data and opens primary editors', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/');
  await expect(page.locator('#fileSaveStatus')).toContainText(/已从本地文件载入|已写入本地文件/);
  const plannerData = await page.request.get('/api/planner-data').then(response => response.json());
  expect(plannerData.data.versions[plannerData.data.activeVersion].schedule).toHaveLength(88);
  await expect(page.locator('.calendar-block')).toHaveCount(85);
  await expect(page.locator('.place-card')).toHaveCount(59);
  await expect(page.locator('#map')).toBeVisible();

  await page.locator('.place-card').first().dblclick();
  await expect(page.locator('#placeEditor')).toBeVisible();
  await page.locator('#placeEditorCancel').click();
  await expect(page.locator('#placeEditor')).toBeHidden();

  await page.reload();
  await expect(page.locator('#fileSaveStatus')).toContainText(/已从本地文件载入|已写入本地文件/);
  await page.locator('#addScheduleBtn').press('Enter');
  await expect(page.locator('#eventEditor')).toBeVisible();
  await expect(page.locator('#editorName')).toHaveValue('新安排');
  await page.locator('#editorCancel').click();

  await page.reload();
  await expect(page.locator('#fileSaveStatus')).toContainText(/已从本地文件载入|已写入本地文件/);
  await page.locator('#importFlightBtn').press('Enter');
  await expect(page.locator('#flightImporter')).toBeVisible();
  await page.locator('#flightImportCancel').click();

  await page.reload();
  await expect(page.locator('#fileSaveStatus')).toContainText(/已从本地文件载入|已写入本地文件/);
  await page.locator('#newPlanBtn').press('Enter');
  await expect(page.locator('#planDialog')).toBeVisible();
  await page.locator('#planDialogCancel').click();
  expect(errors).toEqual([]);
});

test('desktop planner filters schedule and exposes route summary', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/');
  await page.locator('#dayFilter').selectOption({ index: 1 });
  await expect(page.locator('.calendar-block')).toHaveCount(8);
  await page.locator('#routeBtn').click();
  await expect(page.locator('#routeSummaryDetail')).toBeVisible();
  expect(errors).toEqual([]);
});

test('generated share page loads latest data in read-only mode', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('http://127.0.0.1:4174/');
  await expect(page.locator('html')).toHaveClass(/share-mode/);
  await expect(page.locator('#fileSaveStatus')).toContainText('共享只读版');
  const sharedScheduleCount = await page.evaluate(() => window.__ROADTRIP_SHARE_DATA__.versions[window.__ROADTRIP_SHARE_DATA__.activeVersion].schedule.length);
  expect(sharedScheduleCount).toBe(88);
  await expect(page.locator('.calendar-block')).toHaveCount(85);
  await expect(page.locator('.place-card')).toHaveCount(59);
  await expect(page.locator('#newPlanBtn')).toBeHidden();
  await expect(page.locator('#addScheduleBtn')).toBeHidden();
  expect(errors).toEqual([]);
});
