import { expect, test } from '@playwright/test';

for (const width of [360, 430]) {
  test(`accommodation map handoff keeps the saved event date at ${width}px`, async ({ page, browserName }) => {
    await page.setViewportSize({ width, height: 640 });
    const fixture = {
      activeVersion: 'p1', plans: [{ id: 'p1', name: '住宿方案' }],
      versions: { p1: { name: '山海旅行', planKey: 'p1', items: [],
        schedule: [
          { type: 'food', title: '第一天午餐', date: '2026-11-02', start: '12:00', end: '13:00' },
          { type: 'hotel', title: '第二天住宿', date: '2026-11-03', start: '18:00', end: '19:00', locationId: 'hotel' }
        ],
        locations: [{ id: 'hotel', name: '山海客栈', type: 'hotel', address: '测试地址', resolved: { location: '120.1,30.2', name: '山海客栈' } }],
        routes: [], expenses: [], placeCategories: [], preferences: {} } },
      locations: [], routes: [], sharedSchedule: {}
    };
    await page.route('**/api/planner-data', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: fixture }) }));
    await page.goto('/?preview=mobile#schedule');
    await page.locator('.mobile-weekdays [data-date="2026-11-02"]').click();
    await page.locator('.mobile-tabbar [data-mobile-view="plans"]').click();
    await page.locator('[data-review]').click();
    await page.locator('[data-review-edit="1"]').click();
    await expect(page.locator('#eventEditor')).toBeVisible();
    await page.locator('.mobile-editor-map-preview').click();
    await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'map');
    await expect(page.locator('#planReviewDialog')).not.toBeVisible();
    await expect(page.locator('.mobile-map-summary [data-map-summary-title]')).toHaveText('山海客栈');
    await expect(page.locator('#mapDayFilter')).toHaveValue('2026-11-03');
    await page.screenshot({ path: `design/${browserName}-accommodation-map-${width}.png` });
    await page.locator('.mobile-tabbar [data-mobile-view="schedule"]').click();
    await expect(page.locator('#dayFilter')).toHaveValue('2026-11-03');
    await expect(page.locator('.mobile-weekdays [data-date="2026-11-03"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.mobile-weekdays [data-date="2026-11-02"]')).toHaveAttribute('aria-pressed', 'false');
    const dateControl = page.locator('.mobile-timeline-date');
    await expect(dateControl).toHaveAccessibleName('选择时间表日期');
    await expect(dateControl).toHaveValue('2026-11-03');
    const dateSurface = await dateControl.evaluate(element => {
      const style = getComputedStyle(element);
      return { appearance: style.appearance, background: style.backgroundColor, border: style.borderTopWidth, arrow: style.backgroundImage !== 'none' };
    });
    expect(dateSurface).toEqual({ appearance: 'none', background: 'rgba(0, 0, 0, 0)', border: '0px', arrow: true });
    await expect(page.locator('#schedule')).toContainText('第二天住宿');
    await expect(page.locator('#schedule')).not.toContainText('第一天午餐');
    await expect.poll(() => page.locator('.calendar-block[data-schedule-index="1"]').evaluate(element => {
      const rect = element.getBoundingClientRect();
      const scroll = document.querySelector('.schedule-scroll').getBoundingClientRect();
      return rect.top >= scroll.top && rect.bottom <= scroll.bottom;
    })).toBe(true);
    await page.screenshot({ path: `design/${browserName}-accommodation-return-${width}.png` });
    await dateControl.selectOption('2026-11-02');
    await expect(page.locator('#dayFilter')).toHaveValue('2026-11-02');
    await expect(page.locator('#schedule')).toContainText('第一天午餐');
    await expect(page.locator('.mobile-weekdays [data-date="2026-11-02"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.mobile-all-dates-btn').click();
    await expect(page.locator('#dayFilter')).toHaveValue('');
    await expect(dateControl).toBeHidden();
    await page.locator('.mobile-all-dates-btn').click();
    await expect(page.locator('.mobile-timeline-date')).toHaveValue('2026-11-02');
    await dateControl.focus();
    await expect(dateControl).toBeFocused();
    if (browserName === 'chromium') {
      await page.emulateMedia({ forcedColors: 'active' });
      await expect(dateControl).toHaveCSS('appearance', 'auto');
      await expect(dateControl).toHaveCSS('background-image', 'none');
      await page.emulateMedia({ forcedColors: 'none' });
    }
  });
}
