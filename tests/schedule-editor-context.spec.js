import { expect, test } from '@playwright/test';
import { auditVisibleTextContrast } from './helpers/text-contrast.js';

for (const width of [360, 430]) for (const kind of ['flight', 'train']) {
  test(`${kind} overnight editor distinguishes departure and arrival at ${width}px`, async ({ page, browserName }) => {
    await page.setViewportSize({ width, height: 640 });
    const transport = kind === 'flight'
      ? { flightInfo: { flightNumber: 'CZ1234', departureAirport: '出发机场', arrivalAirport: '到达机场', arrivalDate: '2026-11-03' } }
      : { transportInfo: { kind: 'train', trainNumber: 'D1234', departureStation: '出发站', arrivalStation: '到达站', arrivalDate: '2026-11-03' } };
    const fixture = {
      activeVersion: 'p1', plans: [{ id: 'p1', name: '跨日方案' }],
      versions: { p1: { name: '跨日旅行', planKey: 'p1', items: [], schedule: [{ ...transport, type: kind === 'flight' ? 'flight' : 'transport', title: '夜间交通', date: '2026-11-02', start: '23:00', end: '02:00' }], locations: [], routes: [], expenses: [], placeCategories: [], preferences: {} } },
      locations: [], routes: [], sharedSchedule: {}
    };
    await page.route('**/api/planner-data', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: fixture }) }));
    await page.goto('/?preview=mobile#schedule');
    await page.locator('.calendar-block').first().dblclick();
    const dialog = page.locator('#eventEditor');
    const context = dialog.locator('#scheduleEditorContext');
    await expect(context).toContainText('安排日期：2026-11-02 → 2026-11-03（到达）');
    await expect(dialog).toHaveAccessibleDescription(/2026-11-02 → 2026-11-03（到达）/);
    const fields = await dialog.evaluate(element => {
      const date = element.querySelector('#editorDate').getBoundingClientRect();
      const start = element.querySelector('#editorStart').getBoundingClientRect();
      const end = element.querySelector('#editorEnd').getBoundingClientRect();
      return { fullDate: date.width > 250, ordered: date.bottom <= start.top, timesAligned: Math.abs(start.top - end.top) <= 1 };
    });
    expect(fields).toEqual({ fullDate: true, ordered: true, timesAligned: true });
    const surfaces = await dialog.evaluate(element => {
      const form = element.querySelector('.editor-form');
      const heading = form.querySelector('h3');
      const actions = form.querySelector('.editor-actions');
      const previous = form.scrollTop;
      const covered = [0, (form.scrollHeight - form.clientHeight) / 2, form.scrollHeight].map(offset => {
        form.scrollTop = offset;
        const rect = heading.getBoundingClientRect();
        const viewport = form.getBoundingClientRect();
        return rect.top <= viewport.top + 1 && rect.bottom >= viewport.top + 40;
      });
      form.scrollTop = previous;
      return {
        covered,
        titleOpaque: /^rgb\(/.test(getComputedStyle(heading).backgroundColor),
        actionsOpaque: /^rgb\(/.test(getComputedStyle(actions).backgroundColor)
      };
    });
    expect(surfaces).toEqual({ covered: [true, true, true], titleOpaque: true, actionsOpaque: true });
    expect(await context.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
    await page.screenshot({ path: `design/${browserName}-${kind}-overnight-context-${width}.png` });
    const arrival = dialog.locator(kind === 'flight' ? '#editorFlightArrivalDate' : '#editorTrainArrivalDate');
    await arrival.evaluate(element => { const section = element.closest('details'); if (section) section.open = true; });
    await arrival.fill('2026-11-02');
    await dialog.locator('button[type="submit"]').click();
    const status = dialog.locator('#editorTransportStatus');
    await expect(status).toContainText('必须晚于');
    await expect(dialog.locator('#editorEnd')).toBeFocused();
    await expect.poll(() => status.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const modal = element.closest('dialog');
      return rect.top >= modal.querySelector('h3').getBoundingClientRect().bottom && rect.bottom <= modal.querySelector('.editor-actions').getBoundingClientRect().top;
    })).toBe(true);
    await page.screenshot({ path: `design/${browserName}-${kind}-validation-visible-${width}.png` });
    await arrival.fill('2026-11-04');
    await expect(status).toBeHidden();
    await expect(context).toContainText('2026-11-04（到达）');
    await arrival.fill('2026-11-02');
    await expect(context).not.toContainText('（到达）');
    await arrival.fill('2026-11-04');
    // Hidden transport fields must not leak into an accommodation's summary.
    await dialog.locator('[data-editor-type="hotel"]').click();
    await expect(context).toContainText('安排日期：2026-11-02');
    await expect(context).not.toContainText('（到达）');
    await dialog.locator('#editorCancel').click();
    await page.locator('.calendar-block').first().dblclick();
    await expect(context).toContainText('2026-11-03（到达）');
    await expect(arrival).toHaveValue('2026-11-03');
  });
}

for (const width of [360, 430]) for (const kind of ['flight', 'hotel']) {
  test(`${kind} editor shows trip, plan and live draft date at ${width}px`, async ({ page, browserName }) => {
    await page.setViewportSize({ width, height: 640 });
    const tripName = '长名称旅行'.repeat(10);
    const planName = '交通与住宿方案'.repeat(8);
    const entry = kind === 'flight'
      ? { type: 'flight', title: '测试航班', flightInfo: { flightNumber: 'CZ1234', departureAirport: '出发机场', arrivalAirport: '到达机场', arrivalDate: '2026-11-02' } }
      : { type: 'hotel', title: '测试住宿' };
    const fixture = {
      activeVersion: 'p1', plans: [{ id: 'p1', name: planName }],
      versions: { p1: { name: tripName, planKey: 'p1', items: [], schedule: [{ ...entry, date: '2026-11-02', start: '16:00', end: '18:00' }], locations: [], routes: [], expenses: [], placeCategories: [], preferences: {} } },
      locations: [], routes: [], sharedSchedule: {}
    };
    await page.route('**/api/planner-data', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: fixture }) }));
    await page.goto('/?preview=mobile#schedule');
    const card = page.locator('.calendar-block').first();
    await expect(card).toBeVisible();
    await card.dblclick();
    const dialog = page.locator('#eventEditor');
    const context = dialog.locator('#scheduleEditorContext');
    await expect(dialog).toBeVisible();
    await expect(context).toContainText(`所属行程：${tripName}`);
    await expect(context).toContainText(`当前方案：${planName}`);
    await expect(context).toContainText('安排日期：2026-11-02');
    await expect(dialog).toHaveAccessibleDescription(/所属行程：.*当前方案：.*安排日期：2026-11-02/);
    expect(await dialog.evaluate(element => element.querySelector('.editor-form').scrollWidth > element.querySelector('.editor-form').clientWidth)).toBe(false);
    const contrast = await auditVisibleTextContrast(page, '#scheduleEditorContext');
    expect(contrast.checked).toBeGreaterThan(0);
    expect(contrast.issues).toEqual([]);
    await page.screenshot({ path: `design/${browserName}-${kind}-editor-context-${width}.png` });
    await dialog.locator('#editorDate').fill('2026-11-03');
    await expect(context).toContainText('安排日期：2026-11-03');
    await dialog.locator('#editorDate').fill('');
    await expect(context).toContainText('未设置日期');
    await dialog.locator('.editor-form').evaluate(element => { element.scrollTop = element.scrollHeight; });
    const footerVisible = await dialog.locator('.editor-actions').evaluate(element => {
      const rect = element.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= innerHeight;
    });
    expect(footerVisible).toBe(true);
    await dialog.locator('#editorCancel').click();
    await expect(dialog).toBeHidden();
    await card.dblclick();
    await expect(context).toContainText('安排日期：2026-11-02');
    await expect(dialog.locator('#editorDate')).toHaveValue('2026-11-02');
  });
}
