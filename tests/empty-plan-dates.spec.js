import { expect, test } from '@playwright/test';
import { auditVisibleTextContrast } from './helpers/text-contrast.js';

for (const width of [360, 393, 430]) {
  test(`empty plan clears old dates and returning restores them at ${width}px`, async ({ page, browserName }) => {
    await page.setViewportSize({ width, height: 640 });
    const tripName = '沿海山路旅行与长名称行程概览的日期切换测试';
    const planName = '有安排的长名称方案用于检查窄屏换行和查看入口';
    const snapshot = { name: tripName, items: [], schedule: [], expenses: [], locations: [], routes: [], placeCategories: [], preferences: {} };
    const fixture = {
      activeVersion: 'dated', plans: [{ id: 'dated', name: planName }, { id: 'empty', name: '空白方案' }],
      versions: {
        dated: { ...snapshot, planKey: 'dated', schedule: [{ date: '2026-11-02', start: '12:00', end: '13:00', type: 'food', title: '旧方案午餐' }] },
        empty: { ...snapshot, planKey: 'empty' }
      }, locations: [], routes: [], sharedSchedule: {}
    };
    await page.route('**/api/planner-data', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: fixture }) }));
    await page.goto('/?preview=mobile#schedule');
    await expect(page.locator('.mobile-weekdays [data-date="2026-11-02"]')).toBeVisible();
    await page.locator('.mobile-weekdays [data-date="2026-11-02"]').click();
    await page.locator('.mobile-tabbar [data-mobile-view="plans"]').click();
    const overview = page.locator('.mobile-current-plan');
    await expect(overview.locator('[data-trip-context]')).toHaveText(`所属行程：${tripName}`);
    await expect(overview.locator('[data-plan-title]')).toHaveText(planName);
    await expect(overview.locator('[data-plan-summary]')).toHaveText('当前方案：1 个有安排日期');
    await expect(overview.locator('[data-plan-dates]')).toHaveText('2026-11-02');
    const overviewContrast = await auditVisibleTextContrast(page, '.mobile-current-plan');
    expect(overviewContrast.checked).toBeGreaterThan(4);
    expect(overviewContrast.issues).toEqual([]);
    const overviewLayout = await overview.evaluate(element => ({
      overflow: element.scrollWidth > element.clientWidth,
      touchTargets: [...element.querySelectorAll('a')].every(link => link.getBoundingClientRect().height >= 44)
    }));
    expect(overviewLayout).toEqual({ overflow: false, touchTargets: true });
    await expect(page.locator('[data-plan-count]')).toHaveText('2 个方案');
    await page.screenshot({ path: `design/${browserName}-plan-overview-${width}.png` });
    await overview.locator('a[href="#map"]').click();
    await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'map');
    await expect(page.locator('#mapDayFilter')).toHaveValue('2026-11-02');
    await page.locator('.mobile-tabbar [data-mobile-view="plans"]').click();
    await overview.locator('a[href="#schedule"]').click();
    await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'schedule');
    await expect(page.locator('#dayFilter')).toHaveValue('2026-11-02');
    await page.locator('#planSelect').selectOption('empty');
    await expect(page.locator('#schedule')).not.toContainText('旧方案午餐');
    await expect(page.locator('#dayFilter option[value="2026-11-02"]')).toHaveCount(0);
    await expect(page.locator('#mapDayFilter option[value="2026-11-02"]')).toHaveCount(0);
    await expect(page.locator('.mobile-weekdays [data-date]')).toHaveCount(0);
    await expect(page.locator('[data-week-title]')).toHaveText('暂无行程日期');
    await expect(page.locator('.mobile-timeline-controls')).toHaveCount(0);
    await expect(page.locator('#schedule')).toContainText('当前方案暂无安排');
    await page.locator('.mobile-tabbar [data-mobile-view="plans"]').click();
    await expect(overview.locator('[data-plan-title]')).toHaveText('空白方案');
    await expect(overview.locator('[data-plan-summary]')).toHaveText('当前方案暂无安排');
    await expect(overview.locator('[data-plan-dates]')).toHaveText('尚未添加日期');
    await page.screenshot({ path: `design/${browserName}-plan-overview-empty-${width}.png` });
    await overview.locator('a[href="#schedule"]').click();
    await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'schedule');
    const contrast = await auditVisibleTextContrast(page, '#schedule');
    expect(contrast.checked).toBeGreaterThan(0);
    expect(contrast.issues).toEqual([]);
    await page.screenshot({ path: `design/empty-plan-dates-${width}.png` });
    await page.locator('#planSelect').selectOption('dated');
    await expect(page.locator('.mobile-weekdays [data-date="2026-11-02"]')).toBeVisible();
    await expect(page.locator('.mobile-timeline-date option[value="2026-11-02"]')).toHaveCount(1);
    await expect(page.locator('#schedule')).toContainText('旧方案午餐');
  });
}
