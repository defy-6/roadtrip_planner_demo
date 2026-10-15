import { expect, test } from '@playwright/test';

for (const width of [360, 393, 430]) {
  test(`keyboard trip switching replaces trip, dates and review at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 640 });
    await page.addInitScript(() => {
      localStorage.setItem('roadtrip-token', 'isolated-trip-preview');
      if (!localStorage.getItem('roadtrip-active-trip')) localStorage.setItem('roadtrip-active-trip', 't1');
    });
    const trips = [
      { _id: 't1', name: '山间旅行', date: '2026-10-15', title: '山间午餐' },
      { _id: 't2', name: '海边旅行', date: '2026-11-02', title: '海边晚餐' }
    ];
    const writes = [];
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() !== 'GET') writes.push(path);
      let response;
      if (path === '/api/auth/me') response = { user: { _id: 'u1', username: 'preview' } };
      else if (path === '/api/trips') response = { trips: { mine: trips.map(trip => ({ ...trip, role: 'owner', updated_at: '2026-10-13' })), shared: [] } };
      else if (/^\/api\/trips\/t[12]$/.test(path)) {
        const trip = trips.find(item => path.endsWith(item._id));
        const id = `plan-${trip._id}`;
        const data = {
          name: trip.name, activeVersion: id, plans: [{ id, name: `${trip.name}主方案` }],
          versions: { [id]: { name: trip.name, planKey: id, items: [],
            schedule: [{ date: trip.date, start: '12:00', end: '13:00', type: 'food', title: trip.title, note: `${trip.name}的备注` }],
            expenses: [], locations: [], routes: [], placeCategories: [], preferences: {} } },
          locations: [], routes: [], sharedSchedule: {}
        };
        response = { trip: { ...trip, data } };
      } else return route.continue();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
    });
    await page.goto('/?preview=mobile#plans');
    await expect(page.locator('#tripName')).toHaveValue('山间旅行');
    await page.locator('[data-account]').click();
    const dialog = page.locator('#accountDialog');
    await expect(dialog.locator('[aria-current="true"]')).toHaveText('当前行程');
    const opener = dialog.getByRole('button', { name: '打开行程：海边旅行', exact: true });
    expect(await opener.evaluate(button => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    expect(await dialog.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
    await page.screenshot({ path: `design/trip-switch-account-${width}.png` });
    await dialog.locator('.account-trip[data-trip-id="t2"] > div:first-child').click();
    await expect(dialog).toBeVisible();
    await expect(page.locator('#tripName')).toHaveValue('山间旅行');
    await opener.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#tripName')).toHaveValue('海边旅行', { timeout: 30000 });
    await expect(page.locator('#planSelect option:checked')).toHaveText('海边旅行主方案');
    await expect(page.locator('.mobile-current-plan')).toContainText('海边旅行');
    await page.locator('.mobile-tabbar [data-mobile-view="schedule"]').click();
    await expect(page.locator('.mobile-weekdays [data-date="2026-11-02"]')).toBeVisible();
    await expect(page.locator('.mobile-weekdays [data-date="2026-10-15"]')).toHaveCount(0);
    await expect(page.locator('#schedule')).toContainText('海边晚餐');
    await expect(page.locator('#schedule')).not.toContainText('山间午餐');
    await page.locator('.mobile-tabbar [data-mobile-view="plans"]').click();
    await page.locator('[data-review]').click();
    await expect(page.locator('#planReviewDialog')).toContainText('海边旅行');
    await expect(page.locator('#planReviewDialog')).toContainText('海边晚餐');
    await expect(page.locator('#planReviewDialog')).not.toContainText('山间午餐');
    await page.screenshot({ path: `design/trip-switch-review-${width}.png` });
    expect(writes).toEqual([]);
  });
}
