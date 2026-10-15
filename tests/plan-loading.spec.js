import { expect, test } from './helpers/safety-browser.mjs';
import { auditVisibleTextContrast } from './helpers/text-contrast.js';

for (const width of [360, 430]) for (const fails of [false, true]) {
  test(`plan overview distinguishes pending and ${fails ? 'failed' : 'empty'} data at ${width}px`, async ({ page, browserName }) => {
    await page.setViewportSize({ width, height: 640 });
    let holdResponse = true;
    let release;
    const responseGate = new Promise(resolve => { release = resolve; });
    const fixture = { activeVersion: 'empty', plans: [{ id: 'empty', name: '空白旅行方案' }], versions: { empty: {
      name: '加载状态测试旅行', planKey: 'empty', items: [], schedule: [], locations: [], routes: [], expenses: [], placeCategories: [], preferences: {}
    } }, locations: [], routes: [], sharedSchedule: {} };
    await page.route('**/api/planner-data', async route => {
      if (route.request().method() === 'GET') {
        if (holdResponse) await responseGate;
        await route.fulfill({ status: fails ? 500 : 200, contentType: 'application/json', body: JSON.stringify(fails ? { error: 'test failure' } : { data: fixture }) });
      } else await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/?preview=mobile#plans', { waitUntil: 'domcontentloaded' });
    const overview = page.locator('.mobile-current-plan');
    await expect(overview).toHaveAttribute('aria-busy', 'true');
    expect(await overview.evaluate(element => ({
      title: element.querySelector('[data-plan-title]').textContent,
      summary: element.querySelector('[data-plan-summary]').textContent,
      count: document.querySelector('[data-plan-count]').textContent,
      inert: element.querySelector('.mobile-plan-browse').hasAttribute('inert'),
      opacity: getComputedStyle(element.querySelector('.mobile-plan-browse')).opacity
    }))).toEqual({ title: '正在加载行程…', summary: '', count: '尚未载入', inert: true, opacity: '0.38' });
    // The unresolved route is the loading-state boundary. Do not combine it
    // with Playwright's virtual clock: WebKit can defer the fulfilled fetch
    // until a later virtual-time turn and leave the local preset on screen.
    // Release before taking screenshots: WebKit screenshot capture can exceed
    // the application's 12s request timeout on busy Windows runners.
    holdResponse = false;
    release();
    // Start a clean initialization for the resolved-state assertion. This
    // keeps the pending screenshot/assertions independent of the app's 12s
    // fetch timeout on slower WebKit runners.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(overview).toHaveAttribute('aria-busy', 'false');
    if (fails) {
      await expect(overview.locator('[data-plan-load-status]')).toHaveText('未能读取行程数据，当前显示本地预设，请刷新重试。');
      await expect(overview.locator('[data-plan-label]')).toHaveText('本地预设方案');
      const contrast = await auditVisibleTextContrast(page, '[data-plan-load-status]');
      expect(contrast.checked).toBeGreaterThan(0);
      expect(contrast.issues).toEqual([]);
    } else {
      await expect(overview.locator('[data-plan-title]')).toHaveText('空白旅行方案');
      await expect(overview.locator('[data-plan-summary]')).toHaveText('当前方案暂无安排');
      await expect(overview.locator('[data-plan-load-status]')).toBeHidden();
    }
    await expect(overview.locator('.mobile-plan-browse')).not.toHaveAttribute('inert', '');
    await page.screenshot({ path: `design/${browserName}-plan-${fails ? 'failed' : 'empty-loaded'}-${width}.png` });
  });
}
