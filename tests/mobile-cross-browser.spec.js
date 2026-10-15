import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 360, height: 640 }, { width: 393, height: 852 }, { width: 430, height: 640 }]) {
  test(`mobile four-page geometry and plans scrolling at ${viewport.width}x${viewport.height}`, async ({ page, browserName }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.goto('/?preview=mobile#schedule', { waitUntil: 'domcontentloaded' });
    // WebKit can finish the module graph after DOMContentLoaded on a cold start.
    // Wait for the actual data-ready status, not an arbitrary sleep.
    await expect(page.locator('#fileSaveStatus')).toContainText(/已从本地文件载入|已写入本地文件|已同步云端/, { timeout: 30000 });
    for (const [view, selector] of Object.entries({ schedule: '.schedule-panel', places: '.locations-panel', map: '.content', plans: '.mobile-plans-panel' })) {
      await page.locator(`.mobile-tabbar [data-mobile-view="${view}"]`).click();
      await expect(page.locator('body')).toHaveAttribute('data-mobile-view', view);
      const panel = page.locator(selector);
      await expect(panel).toBeVisible();
      const geometry = await panel.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const body = document.body.getBoundingClientRect();
        return { left: rect.left - body.left, right: body.right - rect.right, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      expect(geometry.left).toBeCloseTo(16, 0);
      expect(geometry.right).toBeCloseTo(16, 0);
      expect(geometry.overflow).toBe(false);
      const planSurface = await page.locator('#planSelect').evaluate(element => {
        const style = getComputedStyle(element);
        return { appearance: style.appearance, arrow: style.backgroundImage !== 'none' };
      });
      expect(planSurface).toEqual({ appearance: 'none', arrow: true });
      if (view === 'map') {
        const dateSurface = await page.locator('#mapDayFilter').evaluate(element => {
          const style = getComputedStyle(element);
          return { appearance: style.appearance, arrow: style.backgroundImage !== 'none' };
        });
        expect(dateSurface).toEqual({ appearance: 'none', arrow: true });
      }
      await page.screenshot({ path: `design/${browserName}-mobile-${view}-${viewport.width}.png` });
    }
    const panel = page.locator('.mobile-plans-panel');
    const result = await panel.evaluate(element => {
      const unclipped = [...element.querySelectorAll('.mobile-action-card')].every(card => card.scrollHeight <= card.clientHeight + 1);
      element.scrollTop = element.scrollHeight;
      const last = element.querySelector('.mobile-action-card:last-child button:last-of-type').getBoundingClientRect();
      return { scrollable: element.scrollHeight > element.clientHeight, scrolled: element.scrollTop > 0, unclipped, lastVisible: last.bottom <= document.querySelector('.mobile-tabbar').getBoundingClientRect().top && last.top >= element.getBoundingClientRect().top };
    });
    expect(result).toEqual({ scrollable: true, scrolled: true, unclipped: true, lastVisible: true });
    if (browserName === 'chromium') {
      await page.emulateMedia({ forcedColors: 'active' });
      for (const selector of ['#planSelect', '#mapDayFilter']) {
        const surface = await page.locator(selector).evaluate(element => {
          const style = getComputedStyle(element);
          return { appearance: style.appearance, arrow: style.backgroundImage !== 'none' };
        });
        expect(surface).toEqual({ appearance: 'auto', arrow: false });
      }
      await page.emulateMedia({ forcedColors: 'none' });
    }
    expect(errors).toEqual([]);
  });
}

for (const width of [360, 430]) for (const kind of ['expense', 'review']) {
  test(`mobile ${kind} modal stays scrollable and closes back to its entry at ${width}px`, async ({ page, browserName }) => {
    await page.setViewportSize({ width, height: 640 });
    await page.goto('/?preview=mobile#plans', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#fileSaveStatus')).toContainText(/已从本地文件载入|已写入本地文件|已同步云端/, { timeout: 30000 });
    const opener = page.locator(kind === 'expense' ? '[data-accounting]' : '[data-review]');
    await opener.click();
    const dialog = page.locator(kind === 'expense' ? '#expenseLedger' : '#planReviewDialog');
    await expect(dialog).toBeVisible();
    if (kind === 'expense') {
      const coverage = await dialog.evaluate(element => {
        const form = element.querySelector('.editor-form');
        const heading = form.querySelector('h3');
        return [0, (form.scrollHeight - form.clientHeight) / 2, form.scrollHeight].map(offset => {
          form.scrollTop = offset;
          const header = heading.getBoundingClientRect();
          const viewport = form.getBoundingClientRect();
          return header.top <= viewport.top + 1 && header.bottom >= viewport.top + 40;
        });
      });
      expect(coverage, 'The sticky title must cover the top gutter at every scroll position').toEqual([true, true, true]);
    }
    const geometry = await dialog.evaluate(element => {
      const form = element.querySelector('.editor-form');
      form.scrollTop = form.scrollHeight;
      const close = element.querySelector('.editor-actions button').getBoundingClientRect();
      return { scrolling: form.scrollHeight > form.clientHeight && form.scrollTop > 0, overflow: form.scrollWidth > form.clientWidth, closeVisible: close.top >= 0 && close.bottom <= innerHeight };
    });
    expect(geometry).toEqual({ scrolling: true, overflow: false, closeVisible: true });
    await page.screenshot({ path: `design/${browserName}-mobile-${kind}-modal-end-${width}.png` });
    await dialog.locator('.editor-actions button').click();
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await opener.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });
}
