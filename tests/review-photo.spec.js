import { expect, test } from '@playwright/test';
import { auditVisibleTextContrast } from './helpers/text-contrast.js';

for (const viewport of [{ width: 360, height: 480 }, { width: 430, height: 640 }]) {
  test(`review photo preserves its parent and keeps controls visible at ${viewport.width}px`, async ({ page, browserName }) => {
    await page.setViewportSize(viewport);
    const photo = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1600"><rect width="600" height="1600" fill="#d5e5dc"/><circle cx="300" cy="800" r="200" fill="#003b22"/></svg>')}`;
    const placeName = '山海旅行中的长名称观景地点与住宿照片';
    const tripName = '山海旅行与长名称照片回顾的上下文测试';
    const planName = '沿海风景与住宿照片方案';
    const fixture = { activeVersion: 'p1', plans: [{ id: 'p1', name: planName }], versions: { p1: {
      name: tripName, planKey: 'p1', items: [], schedule: [
        { type: 'spot', title: '观景安排', date: '2026-11-03', start: '10:00', end: '11:00', locationId: 'photo', detail: '旅行备注。'.repeat(150) },
        { type: 'spot', title: '失效照片安排', date: '', start: '12:00', end: '13:00', locationId: 'broken' }
      ], locations: [{ id: 'photo', name: placeName, type: 'spot', photo }, { id: 'broken', name: '失效图片地点', type: 'spot', photo: 'data:image/png;base64,invalid' }], routes: [], expenses: [], placeCategories: [], preferences: {}
    } }, locations: [], routes: [], sharedSchedule: {} };
    const writes = [];
    await page.route('**/api/planner-data', route => {
      if (route.request().method() !== 'GET') writes.push(route.request().method());
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: fixture }) });
    });
    await page.goto('/?preview=mobile#plans');
    await page.locator('[data-review]').click();
    const review = page.locator('#planReviewDialog');
    const opener = review.locator('[data-review-photo]').first();
    await opener.scrollIntoViewIfNeeded();
    const parentScroll = await review.locator('.editor-form').evaluate(element => element.scrollTop);
    await opener.click();
    const viewer = page.locator('.review-photo-dialog');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('#reviewPhotoContext')).toHaveText(`${tripName} · ${planName}\n2026-11-03`);
    await expect(viewer).toHaveAttribute('aria-describedby', 'reviewPhotoContext');
    await expect(viewer.locator('[data-photo-preview]')).toHaveAttribute('alt', new RegExp(placeName));
    await expect(viewer.locator('[data-photo-status]')).toBeHidden();
    await page.evaluate(() => document.fonts.ready);
    const geometry = await viewer.evaluate(element => {
      const form = element.querySelector('.editor-form');
      const header = form.querySelector('h3');
      const actions = form.querySelector('.editor-actions');
      const close = actions.querySelector('button').getBoundingClientRect();
      const context = form.querySelector('#reviewPhotoContext').getBoundingClientRect();
      return { overflow: form.scrollWidth > form.clientWidth, closeVisible: close.top >= 0 && close.bottom <= innerHeight, contextVisible: context.top >= form.getBoundingClientRect().top && context.bottom <= actions.getBoundingClientRect().top, headerSurface: getComputedStyle(header).backgroundColor, footerSurface: getComputedStyle(actions).backgroundColor };
    });
    expect(geometry.overflow).toBe(false);
    expect(geometry.closeVisible).toBe(true);
    expect(geometry.contextVisible).toBe(true);
    const contrast = await auditVisibleTextContrast(page, '#reviewPhotoContext');
    expect(contrast.checked).toBeGreaterThan(0);
    expect(contrast.issues).toEqual([]);
    expect(geometry.headerSurface).toMatch(/^rgb\(/);
    expect(geometry.footerSurface).toMatch(/^rgb\(/);
    await page.screenshot({ path: `design/${browserName}-review-photo-${viewport.width}.png` });
    await expect.poll(() => viewer.locator('[data-photo-close]').evaluate(button => {
      const rect = button.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= innerHeight;
    })).toBe(true);
    await viewer.locator('[data-photo-close]').click();
    await expect(viewer).toBeHidden();
    await expect(opener).toBeFocused();
    expect(Math.abs(await review.locator('.editor-form').evaluate(element => element.scrollTop) - parentScroll)).toBeLessThanOrEqual(2);
    await review.locator('[data-review-photo]').last().click();
    await expect(viewer.locator('[data-photo-status]')).toHaveText('图片加载失败，请返回回顾后重试。');
    await expect(viewer.locator('[data-photo-preview]')).toBeHidden();
    await expect(viewer.locator('#reviewPhotoContext')).toHaveText(`${tripName} · ${planName}\n未设置日期`);
    const errorLayout = await viewer.evaluate(element => {
      const form = element.querySelector('.editor-form').getBoundingClientRect();
      const actions = element.querySelector('.editor-actions').getBoundingClientRect();
      const status = element.querySelector('[data-photo-status]').getBoundingClientRect();
      return { footerGap: form.bottom - actions.bottom, outerGap: element.getBoundingClientRect().bottom - actions.bottom, errorVisible: status.top >= form.top && status.bottom <= actions.top, closeVisible: actions.top >= 0 && actions.bottom <= innerHeight };
    });
    expect(Math.abs(errorLayout.footerGap)).toBeLessThanOrEqual(1);
    expect(Math.abs(errorLayout.outerGap)).toBeLessThanOrEqual(1);
    expect(errorLayout.errorVisible).toBe(true);
    expect(errorLayout.closeVisible).toBe(true);
    await page.screenshot({ path: `design/${browserName}-review-photo-error-${viewport.width}.png` });
    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden();
    await expect(review.locator('[data-review-photo]').last()).toBeFocused();
    await opener.click();
    await expect(viewer.locator('[data-photo-preview]')).toBeVisible();
    await expect(viewer.locator('[data-photo-status]')).toBeHidden();
    await expect(viewer.locator('[data-photo-preview]')).toHaveAttribute('alt', new RegExp(placeName));
    await expect(viewer.locator('#reviewPhotoContext')).toHaveText(`${tripName} · ${planName}\n2026-11-03`);
    await viewer.locator('[data-photo-close]').click();
    await expect(opener).toBeFocused();
    expect(writes).toEqual([]);
  });
}
