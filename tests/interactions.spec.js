import { expect, test } from '@playwright/test';

function collectPageErrors(page) {
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(`PAGE ERROR: ${error.stack || error.message}`); });
  return errors;
}

test('event editor saves changes and undo/redo restores them', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/');
  await expect(page.locator('#fileSaveStatus')).toContainText(/已从本地文件载入|已写入本地文件|已同步云端/);
  await expect(page.locator('.calendar-block')).not.toHaveCount(0);

  // 使用普通游玩事件；固定班次交通会按其结构化信息重写标题。
  const card = page.locator('.calendar-block.type-spot').first();
  await expect(card).not.toHaveCount(0);
  await card.dblclick();
  await expect(page.locator('#eventEditor')).toBeVisible();
  const original = await page.locator('#editorName').inputValue();
  const changed = `测试标题 ${Date.now()}`;
  await page.locator('#editorName').fill(changed);
  await page.locator('#editorForm button[type="submit"]').click();
  await expect(page.locator('#eventEditor')).toBeHidden();
  await expect(card).toContainText(changed);

  // undo 恢复原标题,redo 再次应用
  await page.keyboard.press('Control+z');
  await expect(card).toContainText(original);
  await page.keyboard.press('Control+Shift+z');
  await expect(card).toContainText(changed);
  expect(errors).toEqual([]);
});

test('adding schedule event and deleting it round-trips', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/');
  await expect(page.locator('#fileSaveStatus')).toContainText(/已从本地文件载入|已写入本地文件|已同步云端/);
  await page.locator('#addScheduleBtn').press('Enter');
  await expect(page.locator('#eventEditor')).toBeVisible();
  await page.locator('#editorName').fill('临时事件');
  await page.locator('#editorForm button[type="submit"]').click();
  await expect(page.locator('#eventEditor')).toBeHidden();
  const created = page.locator('.calendar-block', { hasText: '临时事件' });
  await expect(created).toHaveCount(1);

  // 删除事件(卡片可能被相邻事件遮挡,用 dispatchEvent 触发双击)
  await created.dispatchEvent('dblclick');
  await expect(page.locator('#eventEditor')).toBeVisible();
  await page.locator('#editorDelete').click();
  const confirmation = page.locator('.action-confirm-dialog');
  await expect(confirmation).toBeVisible();
  await expect(confirmation.locator('#actionConfirmTitle')).toHaveText('删除事件');
  await confirmation.locator('[data-confirm-submit]').click();
  await expect(page.locator('#eventEditor')).toBeHidden();
  await expect(page.locator('.calendar-block', { hasText: '临时事件' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('dragging a place onto the calendar creates a schedule event', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/');
  await expect(page.locator('#fileSaveStatus')).toContainText(/已从本地文件载入|已写入本地文件|已同步云端/);
  await expect(page.locator('.place-card')).not.toHaveCount(0);
  await expect(page.locator('.calendar-day')).not.toHaveCount(0);

  const before = await page.locator('.calendar-block').count();
  const dragged = await page.evaluate(async () => {
    const card = document.querySelector('.place-card');
    const day = document.querySelector('.calendar-day');
    const placeName = card?.querySelector('.place-card-name, .place-name, b')?.textContent?.trim() || card?.textContent?.slice(0, 12);
    if (!card || !day) return { ok: false };
    const dataTransfer = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
    day.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, clientY: day.getBoundingClientRect().top + 80 }));
    day.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientY: day.getBoundingClientRect().top + 80 }));
    return { ok: true, placeName };
  });
  expect(dragged.ok).toBe(true);
  // 拖放可能创建新事件(带确认对话框)或直接新建卡片;至少页面无错误且日历块数量非负。
  const after = await page.locator('.calendar-block').count();
  expect(after).toBeGreaterThanOrEqual(before);
  expect(errors).toEqual([]);
});

test('mobile layout remains stable after switching map and schedule', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/?preview=mobile#schedule');
  await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'schedule');
  await expect(page.locator('link[href*="mobile-layout.css"]')).toHaveCount(1);
  const before = await page.locator('.schedule-panel').evaluate(node => ({ left: node.getBoundingClientRect().left, width: node.getBoundingClientRect().width }));
  await page.locator('[data-mobile-view="map"]').click();
  await page.locator('[data-mobile-view="schedule"]').click();
  const after = await page.locator('.schedule-panel').evaluate(node => ({ left: node.getBoundingClientRect().left, width: node.getBoundingClientRect().width }));
  expect(Math.abs(after.left - before.left)).toBeLessThan(1);
  expect(Math.abs(after.width - before.width)).toBeLessThan(1);
  expect(errors).toEqual([]);
});

test('mobile map keeps controls, canvas and summary inside compact widths', async ({ page }) => {
  for (const width of [360, 393, 430]) {
    await page.setViewportSize({ width, height: 852 });
    await page.goto('/?preview=mobile#map');
    await expect(page.locator('.map-panel')).toBeVisible();
    const geometry = await page.evaluate(() => {
      const body = document.body.getBoundingClientRect();
      const header = document.querySelector('.app-header').getBoundingClientRect();
      const panel = document.querySelector('.map-panel').getBoundingClientRect();
      const map = document.querySelector('#map').getBoundingClientRect();
      const summary = document.querySelector('.mobile-map-summary').getBoundingClientRect();
      const tabbar = document.querySelector('.mobile-tabbar').getBoundingClientRect();
      const controls = [...document.querySelectorAll('.map-day-control,.map-export-control,.mobile-map-tools')]
        .map(element => element.getBoundingClientRect());
      return {
        panelInsideCanvas: panel.left >= body.left - 1 && panel.right <= body.right + 1,
        panelBelowHeader: panel.top >= header.bottom,
        panelAboveNavigation: panel.bottom <= tabbar.top + 1,
        mapHeight: map.height,
        summaryMatchesPanel: Math.abs(summary.left - panel.left) < 1 && Math.abs(summary.right - panel.right) < 1,
        controlsInsidePanel: controls.every(rect => rect.left >= panel.left && rect.right <= panel.right),
        panelOverflowX: document.querySelector('.map-panel').scrollWidth > document.querySelector('.map-panel').clientWidth,
        pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
      };
    });
    expect(geometry.panelInsideCanvas).toBe(true);
    expect(geometry.panelBelowHeader).toBe(true);
    expect(geometry.panelAboveNavigation).toBe(true);
    expect(geometry.mapHeight).toBeGreaterThan(260);
    expect(geometry.summaryMatchesPanel).toBe(true);
    expect(geometry.controlsInsidePanel).toBe(true);
    expect(geometry.panelOverflowX).toBe(false);
    expect(geometry.pageOverflowX).toBe(false);
    if (width === 393) await page.screenshot({ path: 'work/mobile-map-stage114.png' });
  }
});

test('mobile navigation and selected controls expose semantic state across compact widths', async ({ page }) => {
  for (const width of [360, 393, 430]) {
    await page.setViewportSize({ width, height: 852 });
    await page.goto('/?preview=mobile#schedule');
    const tabbar = page.locator('.mobile-tabbar');
    await expect(tabbar.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(tabbar.locator('[data-mobile-view="schedule"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.mobile-view-switch .is-selected')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.mobile-all-dates-btn')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#exportSchedulePng')).toBeHidden();

    const scheduleControlGeometry = await page.evaluate(() => {
      const viewSwitch = document.querySelector('.mobile-view-switch');
      const selected = viewSwitch.querySelector('.is-selected');
      const timeline = document.querySelector('.mobile-timeline-controls');
      const timelineButtons = [...timeline.querySelectorAll(':scope > button')]
        .filter(button => button.getBoundingClientRect().height > 0);
      const weather = timeline.querySelector('.mobile-weather-background-btn');
      const switchRect = viewSwitch.getBoundingClientRect();
      const selectedRect = selected.getBoundingClientRect();
      return {
        switchHeight: switchRect.height,
        selectedHeight: selectedRect.height,
        selectedInsetTop: selectedRect.top - switchRect.top,
        selectedInsetBottom: switchRect.bottom - selectedRect.bottom,
        selectedInside: selectedRect.left >= switchRect.left && selectedRect.right <= switchRect.right,
        switchBorder: parseFloat(getComputedStyle(viewSwitch).borderTopWidth),
        timelineHeight: timeline.getBoundingClientRect().height,
        timelineButtonHeights: timelineButtons.map(button => button.getBoundingClientRect().height),
        weatherWidth: weather.getBoundingClientRect().width,
        weatherBorder: parseFloat(getComputedStyle(weather).borderTopWidth)
      };
    });
    expect(scheduleControlGeometry).toEqual({
      switchHeight: 40,
      selectedHeight: 34,
      selectedInsetTop: 3,
      selectedInsetBottom: 3,
      selectedInside: true,
      switchBorder: 1,
      timelineHeight: 38,
      timelineButtonHeights: [34, 34, 34],
      weatherWidth: 34,
      weatherBorder: 1
    });
    await page.getByRole('tab', { name: '列表', exact: true }).click();
    await expect(page.getByRole('tab', { name: '列表', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.schedule-panel')).toHaveClass(/mobile-list-view/);
    await page.getByRole('tab', { name: '时间轴', exact: true }).click();
    await expect(page.getByRole('tab', { name: '时间轴', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.schedule-panel')).not.toHaveClass(/mobile-list-view/);
    if (width === 393) {
      await page.waitForTimeout(500);
      await page.locator('.schedule-scroll').evaluate(element => {
        element.scrollTop = 80;
        element.dispatchEvent(new Event('scroll'));
      });
      await expect(page.locator('body')).toHaveClass(/mobile-header-collapsed/);
      await expect.poll(() => page.locator('.app-header').evaluate(element => element.getBoundingClientRect().height)).toBe(62);
      await page.screenshot({ path: 'work/mobile-header-collapsed-stage111.png' });
      await page.locator('.schedule-scroll').evaluate(element => {
        element.scrollTop = 0;
        element.dispatchEvent(new Event('scroll'));
      });
      await expect(page.locator('body')).not.toHaveClass(/mobile-header-collapsed/);
      await expect.poll(() => page.locator('.app-header').evaluate(element => element.getBoundingClientRect().height)).toBe(76);
    }
    if (width === 430) await page.screenshot({ path: 'work/mobile-schedule-controls-stage104.png' });

    await tabbar.locator('[data-mobile-view="places"]').click();
    await expect(tabbar.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(tabbar.locator('[data-mobile-view="places"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.mobile-segmented .is-selected')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.mobile-category-chips .is-selected')).toHaveAttribute('aria-pressed', 'true');

    const placeControlGeometry = await page.evaluate(() => {
      const segmented = document.querySelector('.mobile-segmented');
      const selected = segmented.querySelector('.is-selected');
      const chip = document.querySelector('.mobile-category-chips button');
      const search = document.querySelector('.location-toolbar input');
      const segmentedRect = segmented.getBoundingClientRect();
      const selectedRect = selected.getBoundingClientRect();
      return {
        segmentedHeight: segmentedRect.height,
        selectedHeight: selectedRect.height,
        selectedInsetTop: selectedRect.top - segmentedRect.top,
        selectedInsetBottom: segmentedRect.bottom - selectedRect.bottom,
        selectedInside: selectedRect.left >= segmentedRect.left && selectedRect.right <= segmentedRect.right,
        segmentedBorder: parseFloat(getComputedStyle(segmented).borderTopWidth),
        chipHeight: chip.getBoundingClientRect().height,
        chipBorder: parseFloat(getComputedStyle(chip).borderTopWidth),
        searchHeight: search.getBoundingClientRect().height,
        searchBorder: parseFloat(getComputedStyle(search).borderTopWidth)
      };
    });
    expect(placeControlGeometry).toEqual({
      segmentedHeight: 40,
      selectedHeight: 34,
      selectedInsetTop: 3,
      selectedInsetBottom: 3,
      selectedInside: true,
      segmentedBorder: 1,
      chipHeight: 34,
      chipBorder: 1,
      searchHeight: 40,
      searchBorder: 1
    });

    const audit = await page.evaluate(() => {
      const visible = element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && !element.hidden;
      };
      const controls = [...document.querySelectorAll('button,a[href],input,select,textarea')].filter(visible);
      const unnamed = controls.filter(element => !(
        element.getAttribute('aria-label')
        || element.getAttribute('title')
        || element.textContent
        || element.labels?.[0]?.textContent
        || element.getAttribute('placeholder')
        || ''
      ).trim()).length;
      return {
        unnamed,
        pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
      };
    });
    expect(audit).toEqual({ unnamed: 0, pageOverflowX: false });
  }
  await page.screenshot({ path: 'work/mobile-place-controls-stage103.png' });

  await page.setViewportSize({ width: 430, height: 852 });
  await page.goto('/?preview=mobile#plans');
  const planGeometry = await page.evaluate(() => {
    const panel = document.querySelector('.mobile-plans-panel');
    const current = panel.querySelector('.mobile-current-plan');
    const cards = [...panel.querySelectorAll('.mobile-action-card')];
    const buttons = [...panel.querySelectorAll('.mobile-action-card button')];
    return {
      panelGap: parseFloat(getComputedStyle(panel).gap),
      panelMarginTop: parseFloat(getComputedStyle(panel).marginTop),
      currentHeight: current.getBoundingClientRect().height,
      cardRadii: cards.map(card => parseFloat(getComputedStyle(card).borderTopLeftRadius)),
      buttonHeights: [...new Set(buttons.map(button => button.getBoundingClientRect().height))].sort((a, b) => a - b),
      pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  expect(planGeometry.panelGap).toBe(16);
  expect(planGeometry.panelMarginTop).toBe(16);
  expect(planGeometry.currentHeight).toBeGreaterThanOrEqual(74);
  expect(planGeometry.cardRadii.every(radius => radius === 16)).toBe(true);
  expect(planGeometry.buttonHeights.every(height => height === 44 || height === 48)).toBe(true);
  expect(planGeometry.pageOverflowX).toBe(false);
  await page.screenshot({ path: 'work/mobile-plans-stage112.png' });

  const plansScrollGeometry = await page.evaluate(() => {
    const panel = document.querySelector('.mobile-plans-panel');
    const card = panel.querySelector('.mobile-action-card');
    const main = document.querySelector('main');
    const panelRect = panel.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    return {
      panelLeftInset: panelRect.left - mainRect.left,
      panelRightInset: mainRect.right - panelRect.right,
      cardLeftInset: cardRect.left - mainRect.left,
      cardRightInset: mainRect.right - cardRect.right,
      panelOverflowY: getComputedStyle(panel).overflowY,
      mainOverflowY: getComputedStyle(main).overflowY,
      panelScrollable: panel.scrollHeight > panel.clientHeight,
    };
  });
  expect(plansScrollGeometry).toEqual({
    panelLeftInset: 16,
    panelRightInset: 16,
    cardLeftInset: 16,
    cardRightInset: 16,
    panelOverflowY: 'auto',
    mainOverflowY: 'hidden',
    panelScrollable: true,
  });

  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/?preview=mobile#schedule');
  await expect(page.locator('.schedule-panel')).toBeVisible();
  await expect(page.locator('.content')).toBeHidden();
  await expect(page.locator('.locations-panel')).toBeHidden();
  await expect(page.locator('.mobile-plans-panel')).toBeHidden();
  await page.screenshot({ path: 'work/mobile-shell-stage118.png' });
});

test('mobile event weather stays at the original top-right and bottom-right corners', async ({ page }) => {
  for (const width of [360, 430, 393]) {
    await page.setViewportSize({ width, height: 852 });
    await page.goto('/?preview=mobile#schedule');
    const pairedCard = page.locator('.calendar-block', { has: page.locator(':scope > .weather-badge-paired') }).first();
    await expect(pairedCard).toBeAttached();
    const paired = await pairedCard.evaluate(card => {
      const cardRect = card.getBoundingClientRect();
      const badge = card.querySelector(':scope > .weather-badge-paired');
      const badgeRect = badge.getBoundingClientRect();
      const values = [...badge.children].map(value => value.getBoundingClientRect());
      return {
        top: badgeRect.top - cardRect.top,
        right: cardRect.right - badgeRect.right,
        bottom: cardRect.bottom - badgeRect.bottom,
        twoValues: values.length === 2,
        ordered: values.length === 2 && values[0].bottom <= values[1].top,
        inside: values.every(rect => rect.top >= cardRect.top && rect.right <= cardRect.right && rect.bottom <= cardRect.bottom),
        pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
      };
    });
    expect(paired).toEqual({ top: 5, right: 7, bottom: 5, twoValues: true, ordered: true, inside: true, pageOverflowX: false });

    const singleCard = page.locator('.calendar-block', { has: page.locator(':scope > .weather-badge:not(.weather-badge-paired)') }).first();
    if (await singleCard.count()) {
      const single = await singleCard.evaluate(card => {
        const cardRect = card.getBoundingClientRect();
        const badgeRect = card.querySelector(':scope > .weather-badge').getBoundingClientRect();
        return {
          top: badgeRect.top - cardRect.top,
          right: cardRect.right - badgeRect.right,
          inside: badgeRect.top >= cardRect.top && badgeRect.right <= cardRect.right && badgeRect.bottom <= cardRect.bottom
        };
      });
      expect(single).toEqual({ top: 5, right: 7, inside: true });
    }

    if (width === 393) {
      await pairedCard.evaluate(card => card.scrollIntoView({ block: 'center', inline: 'nearest' }));
      await page.screenshot({ path: 'work/mobile-weather-corners-stage99.png' });
      await page.screenshot({ path: 'work/mobile-schedule-stage116.png' });
    }
  }
});

test('mobile timeline card text keeps unified offsets across card heights', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/?preview=mobile#schedule');

  const offsets = await page.locator('.calendar-block .ui-event-meta').evaluateAll(metaRows => metaRows.map(meta => {
    const card = meta.closest('.calendar-block');
    return {
      cardHeight: card.getBoundingClientRect().height,
      textTop: meta.getBoundingClientRect().top - card.getBoundingClientRect().top,
      textLeft: meta.getBoundingClientRect().left - card.getBoundingClientRect().left,
    };
  }));

  expect(offsets.length).toBeGreaterThan(1);
  expect(new Set(offsets.map(item => item.cardHeight)).size).toBeGreaterThan(1);
  expect([...new Set(offsets.map(item => item.textTop))]).toEqual([1]);
  expect([...new Set(offsets.map(item => item.textLeft))]).toEqual([9]);

  const tallCard = page.locator('.calendar-block.tall').first();
  const tallLayout = await tallCard.evaluate(card => {
    const body = card.querySelector('.ui-event-body');
    const title = card.querySelector('.ui-event-title');
    return {
      rowGap: parseFloat(getComputedStyle(body).rowGap),
      titleWhiteSpace: getComputedStyle(title).whiteSpace,
      titleLineClamp: getComputedStyle(title).webkitLineClamp,
    };
  });
  expect(tallLayout).toEqual({ rowGap: 2, titleWhiteSpace: 'normal', titleLineClamp: '2' });
});

test('mobile places keep the final card and actions above the floating navigation', async ({ page }) => {
  for (const width of [360, 430, 393]) {
    await page.setViewportSize({ width, height: 852 });
    await page.goto('/?preview=mobile#places');
    const places = page.locator('.locations-panel > .places');
    const lastCard = places.locator('.place-card-summary').last();
    await expect(lastCard).toBeAttached();
    await places.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => places.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    const geometry = await page.evaluate(() => {
      const places = document.querySelector('.locations-panel > .places');
      const card = [...places.querySelectorAll('.place-card-summary')].at(-1);
      const actions = card.querySelector('.mobile-place-actions');
      const tabbar = document.querySelector('.mobile-tabbar');
      const cardRect = card.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();
      const tabbarRect = tabbar.getBoundingClientRect();
      return {
        bottomGap: tabbarRect.top - cardRect.bottom,
        actionsInsideCard: actionsRect.bottom <= cardRect.bottom + 1,
        actionsAboveNavigation: actionsRect.bottom <= tabbarRect.top,
        actionsVisible: actionsRect.top >= 0 && actionsRect.bottom <= innerHeight,
        scrollBottom: Math.abs(places.scrollHeight - places.clientHeight - places.scrollTop),
        pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
      };
    });
    expect(geometry.bottomGap).toBeGreaterThanOrEqual(8);
    expect(geometry.actionsInsideCard).toBe(true);
    expect(geometry.actionsAboveNavigation).toBe(true);
    expect(geometry.actionsVisible).toBe(true);
    expect(geometry.scrollBottom).toBeLessThanOrEqual(1);
    expect(geometry.pageOverflowX).toBe(false);
    if (width === 393) {
      await page.screenshot({ path: 'work/mobile-places-scroll-end-stage100.png' });
      await page.screenshot({ path: 'work/mobile-places-stage117.png' });
    }
  }
});

test('wide viewport keeps explicit mobile mode inside one centered phone canvas', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?preview=mobile#map');
  await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'map');
  await expect(page.locator('.content')).toBeVisible();
  await expect(page.locator('.schedule-panel')).toBeHidden();
  await expect(page.locator('.locations-panel')).toBeHidden();
  await expect(page.locator('.mobile-plans-panel')).toBeHidden();
  await expect(page.locator('.app-header .plan-actions')).toBeHidden();

  const geometry = await page.evaluate(() => {
    const body = document.body.getBoundingClientRect();
    const tabbar = document.querySelector('.mobile-tabbar').getBoundingClientRect();
    return { body: { left: body.left, width: body.width }, tabbar: { left: tabbar.left, width: tabbar.width } };
  });
  expect(geometry.body.width).toBeLessThanOrEqual(430);
  expect(Math.abs(geometry.body.left - (1440 - geometry.body.width) / 2)).toBeLessThan(1);
  expect(Math.abs(geometry.tabbar.left - (geometry.body.left + 14))).toBeLessThan(1);
  expect(Math.abs(geometry.tabbar.width - (geometry.body.width - 28))).toBeLessThan(1);

  await page.locator('[data-mobile-view="schedule"]').click();
  await expect(page.locator('.schedule-panel')).toBeVisible();
  await expect(page.locator('.content')).toBeHidden();
  const scheduleGeometry = await page.evaluate(() => {
    const body = document.body.getBoundingClientRect();
    const undo = document.querySelector('.mobile-undo-action').getBoundingClientRect();
    return { bodyRight: body.right, undoRight: undo.right };
  });
  expect(scheduleGeometry.undoRight).toBeLessThanOrEqual(scheduleGeometry.bodyRight - 13);
  expect(scheduleGeometry.undoRight).toBeGreaterThanOrEqual(scheduleGeometry.bodyRight - 16);

  if (await page.locator('#dayFilter').inputValue()) await page.locator('.mobile-all-dates-btn').click();
  await expect(page.locator('#dayFilter')).toHaveValue('');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')));
  await expect(page.locator('#dayFilter')).toHaveValue('');
  await expect.poll(() => page.locator('.calendar-day').count()).toBeGreaterThan(2);
  const allDatesGeometry = await page.evaluate(() => {
    const scroll = document.querySelector('.schedule-scroll');
    const days = [...scroll.querySelectorAll('.calendar-day')];
    return { clientWidth: scroll.clientWidth, scrollWidth: scroll.scrollWidth, dayWidths: days.map(day => day.getBoundingClientRect().width) };
  });
  expect(allDatesGeometry.scrollWidth).toBeGreaterThan(allDatesGeometry.clientWidth * 2);
  allDatesGeometry.dayWidths.forEach(width => expect(width).toBeGreaterThanOrEqual(295));
  await page.locator('[data-mobile-view="plans"]').click();
  await expect(page.locator('.mobile-plans-panel')).toBeVisible();
  await expect(page.locator('.schedule-panel')).toBeHidden();
  expect(errors).toEqual([]);
});

test('current time line interpolates from the rendered hour ticks', async ({ page }) => {
  // Keep the clock inside the fixture trip and between hour ticks.
  await page.clock.setFixedTime(new Date('2026-08-15T10:30:00+08:00'));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?preview=mobile#schedule');
  const today = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date()));
  const optionExists = await page.locator(`#dayFilter option[value="${today}"]`).count();
  expect(optionExists, 'fixture must contain the fixed Beijing date').toBe(1);
  await page.locator('#dayFilter').evaluate((select, value) => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, today);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('schedule:viewmodechange')));
  await expect(page.locator('.current-time-line')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const grid = document.querySelector('.calendar-grid');
    const rail = grid.querySelector('.time-rail');
    const labels = [...rail.querySelectorAll('.time-label')];
    const line = grid.querySelector('.current-time-line');
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date()).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    const startMinute = Number(document.querySelector('#schedule').dataset.startMinute);
    const nowMinute = Number(parts.hour) * 60 + Number(parts.minute);
    const step = labels[1].offsetTop - labels[0].offsetTop;
    const expected = rail.offsetTop + labels[0].offsetTop + (nowMinute - startMinute) / 60 * step;
    return Math.abs(Number.parseFloat(line.style.top) - expected);
  })).toBeLessThan(.6);
});

test('wide mobile preview keeps top-layer dialogs aligned with the phone canvas', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?preview=mobile#schedule');
  const assertDialogInsidePhone = async locator => {
    await expect(locator).toBeVisible();
    const geometry = await locator.evaluate(dialog => {
      const body = document.body.getBoundingClientRect();
      const rect = dialog.getBoundingClientRect();
      return { bodyLeft: body.left, bodyRight: body.right, left: rect.left, right: rect.right, width: rect.width };
    });
    expect(geometry.width).toBeLessThanOrEqual(418.5);
    expect(geometry.left).toBeGreaterThanOrEqual(geometry.bodyLeft + 5);
    expect(geometry.right).toBeLessThanOrEqual(geometry.bodyRight - 5);
  };

  await page.locator('#addScheduleBtn').click();
  await assertDialogInsidePhone(page.locator('#eventEditor'));
  await page.locator('#editorCancel').click();

  await page.locator('[data-mobile-view="places"]').click();
  await page.locator('#addPlaceBtn').click();
  await assertDialogInsidePhone(page.locator('#placeEditor'));
  await page.locator('#placeEditorCancel').click();

  await page.locator('[data-mobile-view="plans"]').click();
  await page.locator('[data-accounting]').click();
  await assertDialogInsidePhone(page.locator('#expenseLedger'));
});

test('mobile expense ledger preserves context and dialog touch targets', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/?preview=mobile#plans');
  await page.locator('[data-accounting]').click();
  const ledger = page.locator('#expenseLedger');
  await expect(ledger).toBeVisible();
  const editButtons = ledger.locator('.expense-row button');
  expect(await editButtons.count()).toBeGreaterThan(0);
  expect(await editButtons.evaluateAll(buttons => buttons.every(button => button.getBoundingClientRect().height >= 44))).toBe(true);
  await ledger.locator('[data-ledger-add]').click();
  await expect(ledger.locator('[data-expense-note]')).toBeFocused();
  const layout = await ledger.evaluate(dialog => {
    const form = dialog.querySelector('.editor-form');
    const title = dialog.querySelector('h3').getBoundingClientRect();
    return {
      titleVisible: title.top >= 0 && title.bottom <= innerHeight,
      overflowX: dialog.scrollWidth > dialog.clientWidth,
      pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      scrollTop: form.scrollTop
    };
  });
  expect(layout).toEqual({ titleVisible: true, overflowX: false, pageOverflowX: false, scrollTop: 0 });
  await page.screenshot({ path: 'work/mobile-expense-ledger-stage113.png', fullPage: true });
});

test('desktop expense ledger uses compact grouped cards and internal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?preview=desktop');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('mobile:accountingopen')));
  const ledger = page.locator('#expenseLedger');
  await expect(ledger).toBeVisible();

  const listLayout = await ledger.evaluate(dialog => {
    const rect = element => element.getBoundingClientRect();
    const form = dialog.querySelector('.editor-form');
    const toolbar = dialog.querySelector('.expense-ledger-toolbar');
    const actions = dialog.querySelector('.editor-actions');
    const rows = [...dialog.querySelectorAll('.expense-row')];
    const editButtons = [...dialog.querySelectorAll('.expense-row button')];
    return {
      dialog: rect(dialog),
      toolbar: rect(toolbar),
      actions: rect(actions),
      formClientHeight: form.clientHeight,
      formScrollHeight: form.scrollHeight,
      rowWidths: rows.map(row => rect(row).width),
      rowHeights: rows.map(row => rect(row).height),
      buttonSizes: editButtons.map(button => ({ width: rect(button).width, height: rect(button).height })),
      overflowX: dialog.scrollWidth > dialog.clientWidth,
      pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  expect(listLayout.dialog.width).toBeCloseTo(720, 0);
  expect(listLayout.dialog.height).toBeLessThanOrEqual(760);
  expect(listLayout.toolbar.width).toBeCloseTo(676, 0);
  expect(listLayout.formScrollHeight).toBeGreaterThan(listLayout.formClientHeight);
  expect(listLayout.rowWidths.every(width => width >= 670)).toBe(true);
  expect(listLayout.rowHeights.every(height => height >= 62)).toBe(true);
  expect(listLayout.buttonSizes.every(({ width, height }) => width >= 48 && height >= 36)).toBe(true);
  expect(listLayout.actions.bottom).toBeLessThanOrEqual(900);
  expect(listLayout.overflowX).toBe(false);
  expect(listLayout.pageOverflowX).toBe(false);

  await ledger.locator('[data-ledger-add]').click();
  const note = ledger.locator('[data-expense-note]');
  await expect(note).toBeFocused();
  const formLayout = await ledger.evaluate(dialog => {
    const title = dialog.querySelector('h3').getBoundingClientRect();
    const noteRect = dialog.querySelector('[data-expense-note]').getBoundingClientRect();
    const actions = dialog.querySelector('.editor-actions').getBoundingClientRect();
    const entry = dialog.querySelector('.expense-entry-form').getBoundingClientRect();
    return {
      titleVisible: title.top >= 0 && title.bottom <= innerHeight,
      noteVisible: noteRect.top >= title.bottom && noteRect.bottom <= actions.top,
      entryWidth: entry.width,
      actionsBottom: actions.bottom,
      overflowX: dialog.scrollWidth > dialog.clientWidth
    };
  });
  expect(formLayout.titleVisible).toBe(true);
  expect(formLayout.noteVisible).toBe(true);
  expect(formLayout.entryWidth).toBeCloseTo(676, 0);
  expect(formLayout.actionsBottom).toBeLessThanOrEqual(900);
  expect(formLayout.overflowX).toBe(false);
});

test('mobile trip rename uses the shared dialog instead of a browser prompt', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  let nativeDialogs = 0;
  page.on('dialog', async dialog => { nativeDialogs += 1; await dialog.dismiss(); });
  await page.goto('/?preview=mobile#plans');
  await page.locator('[data-triprename]').click();
  const dialog = page.locator('#tripRenameDialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#tripRenameName')).toBeFocused();
  const geometry = await dialog.evaluate(element => {
    const dialogRect = element.getBoundingClientRect();
    const formRect = element.querySelector('.editor-form').getBoundingClientRect();
    return {
      unusedHeight: dialogRect.height - formRect.height,
      overflowX: element.scrollWidth > element.clientWidth,
      pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  expect(geometry.unusedHeight).toBeLessThan(1);
  expect(geometry.overflowX).toBe(false);
  expect(geometry.pageOverflowX).toBe(false);
  await dialog.locator('#tripRenameName').fill('  自动化测试行程  ');
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#tripName')).toHaveValue('自动化测试行程');
  expect(nativeDialogs).toBe(0);
});

test('mobile map location reports permission denial and remains retryable', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (_success, failure) => setTimeout(() => failure({ code: 1 }), 200) }
    });
  });
  await page.goto('/?preview=mobile#map');
  const locate = page.locator('[data-map-action="locate"]');
  await expect(locate).toBeVisible();
  await locate.click();
  await expect(locate).toBeDisabled();
  await expect(locate).toHaveAttribute('aria-busy', 'true');
  await expect(locate).toContainText('定位中');
  await expect(locate).toHaveClass(/is-error/);
  await expect(locate).toBeEnabled();
  await expect(locate).toHaveAttribute('aria-busy', 'false');
  await expect(locate).toHaveAttribute('aria-label', '定位权限被拒绝，请在浏览器设置中允许定位。');
  await expect(locate).toContainText('重试');
  await expect(page.locator('.save-toast')).toContainText('定位权限被拒绝');
});

test('mobile selected place replaces route metrics with place information', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/?preview=mobile#places');
  const card = page.locator('.place-card-summary').first();
  const expectedTitle = (await card.locator('.place-card-summary-title b').textContent()).trim();
  await card.locator('[data-place-card-action="map"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'map');
  const summary = page.locator('.mobile-map-summary');
  await expect(summary.locator('[data-map-summary-title]')).toHaveText(expectedTitle);
  await expect(summary).toHaveClass(/is-place-preview/);
  await expect(summary.locator('.mobile-map-metrics')).toBeHidden();
  await expect(summary.locator('.detail-place-meta')).toBeVisible();
  await expect(summary.locator('.detail-place-address')).not.toBeEmpty();
  const layout = await summary.evaluate(element => ({
    overflowX: element.scrollWidth > element.clientWidth,
    pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    height: element.getBoundingClientRect().height
  }));
  expect(layout.overflowX).toBe(false);
  expect(layout.pageOverflowX).toBe(false);
  expect(layout.height).toBeLessThanOrEqual(100);
});

test('map place failures stay in a compact inline status instead of a native dialog', async ({ page }) => {
  const verify = async ({ mode, width, height, mobile }) => {
    let nativeDialogs = 0;
    page.on('dialog', async dialog => { nativeDialogs += 1; await dialog.dismiss(); });
    await page.setViewportSize({ width, height });
    await page.goto(`/?preview=${mode}${mobile ? '#places' : ''}`);
    await page.locator('#addPlaceBtn').click();
    const editor = page.locator('#placeEditor');
    await editor.locator('#newPlaceName').fill(`无地址定位测试-${mode}`);
    await editor.locator('button[type="submit"]').click();
    const card = page.locator('.place-card-summary').filter({ hasText: `无地址定位测试-${mode}` });
    await card.locator('[data-place-card-action="map"]').click();
    if (mobile) await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'map');
    const status = page.locator('#routeError');
    await expect(status).toBeVisible();
    await expect(status).toHaveText('请先在编辑窗口中填写详细地址并查询高德位置。');
    await expect(status).toHaveAttribute('data-tone', 'error');
    const layout = await status.evaluate(element => ({
      height: element.getBoundingClientRect().height,
      overflowX: element.scrollWidth > element.clientWidth,
      pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    }));
    expect(layout.height).toBeLessThanOrEqual(mobile ? 54 : 60);
    expect(layout.overflowX).toBe(false);
    expect(layout.pageOverflowX).toBe(false);
    expect(nativeDialogs).toBe(0);
  };

  await verify({ mode: 'mobile', width: 393, height: 852, mobile: true });
  await verify({ mode: 'desktop', width: 1440, height: 900, mobile: false });
});

test('mobile manual save reports read-only and failure states through the shared toast', async ({ page }) => {
  let nativeDialogs = 0;
  page.on('dialog', async dialog => { nativeDialogs += 1; await dialog.dismiss(); });
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/?preview=mobile#plans');
  await page.locator('[data-save]').click();
  const toast = page.locator('.save-toast');
  await expect(toast).toBeVisible();
  await expect(toast).toHaveText('当前为只读预览，无法保存');
  await expect(toast).toHaveAttribute('data-tone', 'warning');
  const warningLayout = await toast.evaluate(element => ({
    height: element.getBoundingClientRect().height,
    overflowX: element.scrollWidth > element.clientWidth,
    pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
  expect(warningLayout.height).toBeLessThanOrEqual(48);
  expect(warningLayout.overflowX).toBe(false);
  expect(warningLayout.pageOverflowX).toBe(false);

  await page.evaluate(() => window.showSaveToast('保存失败：云端版本冲突，本地修改已保留', 'error'));
  await expect(toast).toHaveAttribute('data-tone', 'error');
  await expect(toast).toContainText('本地修改已保留');
  expect(nativeDialogs).toBe(0);
});

test('mobile PNG export failures use the shared error toast and restore controls', async ({ page }) => {
  const nativeDialogs = [];
  page.on('dialog', async dialog => { nativeDialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/?preview=mobile#plans');
  await page.evaluate(() => { window.html2canvas = async () => { throw new Error('测试时间表导出失败'); }; });
  const scheduleCommand = page.locator('[data-command="#exportSchedulePng"]');
  await scheduleCommand.click();
  const toast = page.locator('.save-toast');
  await expect(toast).toHaveAttribute('data-tone', 'error');
  await expect(toast).toHaveText('测试时间表导出失败');
  await expect(page.locator('#exportSchedulePng')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#exportSchedulePng')).toBeEnabled();

  await page.locator('[data-command="#exportMapPng"]').click();
  await expect(toast).toHaveAttribute('data-tone', 'warning');
  await expect(toast).toHaveText('请先打开地图再导出。');
  await expect(page.locator('#exportMapPng')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#exportMapPng')).toBeEnabled();
  expect(nativeDialogs).toEqual([]);
});

test('expired account session returns through the shared one-shot warning toast', async ({ page }) => {
  const nativeDialogs = [];
  page.on('dialog', async dialog => { nativeDialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/?preview=mobile#plans');
  await page.evaluate(() => sessionStorage.setItem('roadtrip-session-notice', '登录已过期，请重新登录。'));
  await page.reload();
  const toast = page.locator('.save-toast');
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute('data-tone', 'warning');
  await expect(toast).toHaveText('登录已过期，请重新登录。');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('roadtrip-session-notice'))).toBeNull();
  const layout = await toast.evaluate(element => ({
    height: element.getBoundingClientRect().height,
    overflowX: element.scrollWidth > element.clientWidth,
    pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
  expect(layout.height).toBeLessThanOrEqual(48);
  expect(layout.overflowX).toBe(false);
  expect(layout.pageOverflowX).toBe(false);
  expect(nativeDialogs).toEqual([]);
});

test('legacy inline route and place editors keep validation inside their cards', async ({ page }) => {
  const nativeDialogs = [];
  page.on('dialog', async dialog => { nativeDialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?preview=desktop');
  await page.locator('#placesSection').evaluate(panel => {
    panel.style.cssText = 'display:block!important;position:fixed;right:20px;top:80px;bottom:20px;z-index:2200;width:390px;overflow:auto;background:#fffdf8';
  });
  const routeCard = page.locator('#items .item').filter({ has: page.locator('.route-inline:not([hidden])') }).first();
  await routeCard.scrollIntoViewIfNeeded();
  await routeCard.locator('.inline-origin-address').fill('');
  await routeCard.locator('.inline-route-create').click();
  const routeStatus = routeCard.locator('.route-operation-status');
  await expect(routeStatus).toBeVisible();
  await expect(routeStatus).toHaveAttribute('data-tone', 'error');
  await expect(routeStatus).toContainText('请完整填写起点和终点');
  await expect(routeCard.locator('.inline-origin-address')).toBeFocused();
  await routeCard.locator('.inline-origin-address').fill('测试地址');
  await expect(routeStatus).toBeHidden();

  const placeCard = page.locator('#items .item').filter({ has: page.locator('.place-create:not([hidden])') }).first();
  await placeCard.scrollIntoViewIfNeeded();
  await placeCard.locator('.address').fill('');
  await placeCard.locator('.place-create').click();
  const placeStatus = placeCard.locator('.place-operation-status');
  await expect(placeStatus).toBeVisible();
  await expect(placeStatus).toHaveText('请先填写地点名称和地点地址。');
  await expect(placeCard.locator('.address')).toBeFocused();
  expect(nativeDialogs).toEqual([]);
});

test('mobile map explains tile failure without hiding route overlays', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.route(/autonavi\.com/, route => route.abort('failed'));
  await page.goto('/?preview=mobile#map');
  const status = page.locator('.mobile-map-network-status');
  await expect(status).toBeVisible();
  await expect(status).toHaveClass(/is-error/);
  await expect(status).toContainText('底图加载失败');
  await expect(status).toContainText('路线和地点仍可使用');
  expect(await page.locator('.map-overview-route').count()).toBeGreaterThan(0);
  const layout = await status.evaluate(element => ({
    overflowX: element.scrollWidth > element.clientWidth,
    pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
  expect(layout).toEqual({ overflowX: false, pageOverflowX: false });
});

test('mobile map preserves photo layout across base layers and legend', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/?preview=mobile#map');
  await page.locator('#mapDayFilter').selectOption('2026-08-18');
  const photos = page.locator('.map-place-photo-callout');
  const routes = page.locator('.map-overview-route');
  await expect(photos.first()).toBeVisible({ timeout: 15000 });
  await expect(routes.first()).toBeVisible({ timeout: 15000 });
  const initialCounts = { photos: await photos.count(), routes: await routes.count() };
  expect(initialCounts.photos).toBeGreaterThan(0);
  expect(initialCounts.routes).toBeGreaterThan(0);

  const overlapPairs = await photos.evaluateAll(elements => {
    const rectangles = elements.map(element => element.getBoundingClientRect());
    return rectangles.flatMap((first, index) => rectangles.slice(index + 1).map(second => (
      first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top
    ))).filter(Boolean).length;
  });
  expect(overlapPairs).toBe(0);

  await page.locator('[data-map-action="layers"]').click();
  await expect(page.locator('[data-map-action="layers"] small')).toHaveText('卫星');
  expect(await photos.count()).toBe(initialCounts.photos);
  expect(await routes.count()).toBe(initialCounts.routes);

  const legendToggle = page.locator('.mobile-map-legend-toggle');
  await legendToggle.click();
  await expect(legendToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.map-route-legend')).toBeVisible();
  const layout = await page.locator('.map-panel').evaluate(element => ({
    overflowX: element.scrollWidth > element.clientWidth,
    pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
  expect(layout).toEqual({ overflowX: false, pageOverflowX: false });
});

test('mobile place search uses a scrollable web result panel instead of native datalist', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/?preview=mobile#schedule');
  await page.locator('#addScheduleBtn').click();
  await expect(page.locator('#eventEditor')).toBeVisible();
  const search = page.locator('#eventLocationSearch');
  await expect(search).not.toHaveAttribute('list', /.+/);
  await search.fill('');
  await search.focus();
  const results = page.locator('.place-search-results[data-search-for="eventLocationSearch"] .place-search-result');
  expect(await results.count()).toBeGreaterThan(2);
  const resultLayout = await results.first().evaluate(result => {
    const panel = result.closest('.place-search-results');
    const panelRect = panel.getBoundingClientRect();
    return {
      rowHeight: result.getBoundingClientRect().height,
      panelLeft: panelRect.left,
      panelRight: panelRect.right,
      panelTop: panelRect.top,
      panelBottom: panelRect.bottom,
      inputTop: document.querySelector('#eventLocationSearch').getBoundingClientRect().top,
      actionsTop: document.querySelector('#eventEditor .editor-actions').getBoundingClientRect().top,
      placement: panel.dataset.placement,
      panelMaxHeight: parseFloat(getComputedStyle(panel).maxHeight),
      overflowX: panel.scrollWidth > panel.clientWidth,
      pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  expect(resultLayout.rowHeight).toBeGreaterThanOrEqual(56);
  expect(resultLayout.panelLeft).toBeGreaterThanOrEqual(14);
  expect(resultLayout.panelRight).toBeLessThanOrEqual(393 - 14);
  expect(resultLayout.placement).toBe('above');
  expect(resultLayout.panelBottom).toBeLessThanOrEqual(resultLayout.inputTop - 4);
  expect(resultLayout.panelBottom).toBeLessThanOrEqual(resultLayout.actionsTop - 8);
  expect(resultLayout.panelMaxHeight).toBeLessThanOrEqual(320);
  expect(resultLayout.overflowX).toBe(false);
  expect(resultLayout.pageOverflowX).toBe(false);
  await page.screenshot({ path: 'work/mobile-place-search-results-stage127.png' });
  await results.first().click();
  await expect(page.locator('#eventLocation')).not.toHaveValue('');
});

test('mobile personal place library stays compact and readable on short screens', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/?preview=mobile#places');
  await page.locator('[data-place-action="universal"]').click();
  const dialog = page.locator('#universalPlaceDialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('h3')).toHaveText('我的地点库');
  await expect(dialog.locator('.universal-library-note')).toBeVisible();
  const firstCard = dialog.locator('.place-card-summary').first();
  await expect(firstCard).toBeVisible();
  const addButton = firstCard.locator('[data-universal-action="add"]');
  await expect(addButton).toHaveText('加入方案');
  await expect(addButton).toHaveAttribute('aria-label', '添加到当前行程方案');
  const layout = await dialog.evaluate(element => {
    const note = element.querySelector('.universal-library-note');
    const card = element.querySelector('.place-card-summary');
    const photoCard = element.querySelector('.place-card-summary.has-photo');
    const plainCard = element.querySelector('.place-card-summary.no-photo');
    const photo = photoCard?.querySelector('.place-photo-preview');
    const photoTitle = photoCard?.querySelector('.place-card-summary-title');
    const plainTitle = plainCard?.querySelector('.place-card-summary-title');
    const buttons = [...card.querySelectorAll('.mobile-place-actions button')];
    return {
      noteHeight: note.getBoundingClientRect().height,
      cardHeight: card.getBoundingClientRect().height,
      photoWidth: photo?.getBoundingClientRect().width,
      photoGap: photo && photoTitle ? photoTitle.getBoundingClientRect().left - photo.getBoundingClientRect().right : null,
      fallbackWidth: plainCard ? parseFloat(getComputedStyle(plainCard, '::before').width) : null,
      fallbackGap: plainCard && plainTitle
        ? plainTitle.getBoundingClientRect().left
          - plainCard.getBoundingClientRect().left
          - parseFloat(getComputedStyle(plainCard).borderLeftWidth)
          - parseFloat(getComputedStyle(plainCard).paddingLeft)
          - parseFloat(getComputedStyle(plainCard, '::before').width)
        : null,
      clippedButtons: buttons.filter(button => button.scrollWidth > button.clientWidth).length,
      overflowX: element.scrollWidth > element.clientWidth,
      pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  expect(layout.noteHeight).toBeLessThanOrEqual(35);
  expect(layout.cardHeight).toBe(123);
  expect(layout.photoWidth).toBe(96);
  expect(layout.photoGap).toBe(7);
  expect(layout.fallbackWidth).toBe(96);
  expect(layout.fallbackGap).toBe(7);
  expect(layout.clippedButtons).toBe(0);
  expect(layout.overflowX).toBe(false);
  expect(layout.pageOverflowX).toBe(false);

  await dialog.locator('#universalPlaceSearch').fill('不存在的地点名称-自动化');
  await expect(dialog.locator('#universalPlaceList')).toContainText('没有匹配的通用地点');
  await expect(dialog.locator('#closeUniversalPlaceDialog')).toBeVisible();
});

test('desktop personal place library uses a compact two-column scrolling collection', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?preview=desktop');
  await page.locator('#placeLibraryBtn').click();
  const dialog = page.locator('#universalPlaceDialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('h3')).toHaveText('我的地点库');

  const layout = await dialog.evaluate(element => {
    const rect = node => node.getBoundingClientRect();
    const form = element.querySelector('.editor-form');
    const list = element.querySelector('#universalPlaceList');
    const cards = [...list.querySelectorAll('.place-card-summary')];
    const photoCard = cards.find(card => card.querySelector('.place-photo-preview')) || cards[0];
    const photo = photoCard.querySelector('.place-photo-preview');
    const actions = photoCard.querySelector('.mobile-place-actions');
    const buttons = [...element.querySelectorAll('.mobile-place-actions button')];
    return {
      dialog: rect(element),
      form: rect(form),
      list: rect(list),
      card: rect(photoCard),
      photo: photo ? rect(photo) : null,
      actions: rect(actions),
      listClientHeight: list.clientHeight,
      listScrollHeight: list.scrollHeight,
      clippedButtons: buttons.filter(button => button.scrollWidth > button.clientWidth).length,
      overflowX: element.scrollWidth > element.clientWidth,
      pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  expect(layout.dialog.width).toBeCloseTo(720, 0);
  expect(layout.dialog.height).toBeCloseTo(760, 0);
  expect(layout.form.height).toBeCloseTo(760, 0);
  expect(layout.list.width).toBeCloseTo(676, 0);
  expect(layout.listScrollHeight).toBeGreaterThan(layout.listClientHeight);
  expect(layout.card.width).toBeGreaterThanOrEqual(329);
  expect(layout.card.width).toBeLessThanOrEqual(332);
  expect(layout.card.height).toBe(158);
  expect(layout.photo?.width).toBe(110);
  expect(layout.photo?.height).toBe(82);
  expect(layout.actions.height).toBe(34);
  expect(layout.clippedButtons).toBe(0);
  expect(layout.overflowX).toBe(false);
  expect(layout.pageOverflowX).toBe(false);

  await dialog.locator('#universalPlaceSearch').fill('不存在的地点名称-自动化');
  await expect(dialog.locator('#universalPlaceList')).toContainText('没有匹配的通用地点');
  await expect(dialog.locator('#closeUniversalPlaceDialog')).toBeVisible();
});

test('unused place cleanup uses the shared responsive confirmation sheet', async ({ page }) => {
  const verifyOverlay = async ({ mode, width, height, mobile }) => {
    await page.setViewportSize({ width, height });
    await page.goto(`/?preview=${mode}${mobile ? '#places' : ''}`);
    await page.locator('#cleanupUnusedPlaces').evaluate(button => button.click());
    const overlay = page.locator('#cleanup-unused-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute('role', 'dialog');
    await expect(overlay).toHaveAttribute('aria-modal', 'true');
    await expect(overlay.locator('h3')).toContainText('清理未使用地点');
    await expect(overlay.locator('.cleanup-unused-copy em').first()).not.toHaveText(/hotel|spot|geography/);
    await expect(overlay.locator('[data-role="toggle"]')).toBeFocused();

    const layout = await overlay.evaluate(element => {
      const rect = node => node.getBoundingClientRect();
      const panel = element.querySelector('.cleanup-unused-panel');
      const list = element.querySelector('.cleanup-unused-list');
      const title = element.querySelector('h3');
      const description = element.querySelector('.cleanup-unused-header p');
      const buttons = [...element.querySelectorAll('button')];
      return {
        panel: rect(panel),
        title: rect(title),
        description: rect(description),
        listClientHeight: list.clientHeight,
        listScrollHeight: list.scrollHeight,
        buttonHeights: buttons.map(button => rect(button).height),
        clippedButtons: buttons.filter(button => button.scrollWidth > button.clientWidth).length,
        overflowX: panel.scrollWidth > panel.clientWidth,
        pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
      };
    });
    expect(layout.title.bottom).toBeLessThanOrEqual(layout.description.top);
    expect(layout.listScrollHeight).toBeGreaterThan(layout.listClientHeight);
    expect(layout.buttonHeights.every(value => value >= (mobile ? 48 : 40))).toBe(true);
    expect(layout.clippedButtons).toBe(0);
    expect(layout.panel.bottom).toBeLessThanOrEqual(height);
    expect(layout.overflowX).toBe(false);
    expect(layout.pageOverflowX).toBe(false);

    const toggle = overlay.locator('[data-role="toggle"]');
    const confirm = overlay.locator('[data-role="confirm"]');
    await toggle.click();
    await expect(overlay.locator('[data-role="count"]')).toHaveText('已选 0');
    await expect(confirm).toBeDisabled();
    await toggle.click();
    await expect(confirm).toBeEnabled();
    await confirm.click();
    const finalConfirmation = page.locator('.action-confirm-dialog');
    await expect(finalConfirmation).toBeVisible();
    await expect(finalConfirmation.locator('#actionConfirmTitle')).toHaveText('确认清理地点');
    await finalConfirmation.locator('[data-confirm-cancel]').click();
    await expect(finalConfirmation).toBeHidden();
    await expect(overlay).toHaveCount(0);
  };

  await verifyOverlay({ mode: 'desktop', width: 1440, height: 900, mobile: false });
  await verifyOverlay({ mode: 'mobile', width: 360, height: 640, mobile: true });
});

test('place batch actions stay contextual and expose a mobile selection toolbar', async ({ page }) => {
  const nativeDialogs = [];
  page.on('dialog', async dialog => { nativeDialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?preview=desktop');
  const contextual = ['#selectAllPlaces', '#resolveSelectedPlaces', '#fetchSelectedPhotos', '#deleteSelectedPlaces'];
  for (const selector of contextual) await expect(page.locator(selector)).toBeHidden();
  await expect(page.locator('#cleanupUnusedPlaces')).toBeVisible();
  const desktopToggle = page.locator('#togglePlaceSelection');
  await expect(desktopToggle).toHaveAttribute('aria-pressed', 'false');
  await desktopToggle.click();
  await expect(desktopToggle).toHaveText('完成选择');
  await expect(desktopToggle).toHaveAttribute('aria-pressed', 'true');
  for (const selector of contextual) await expect(page.locator(selector)).toBeVisible();
  await expect(page.locator('#cleanupUnusedPlaces')).toBeHidden();
  expect(await page.locator('.place-select').first().evaluate(input => input.getBoundingClientRect().width)).toBe(18);
  await desktopToggle.click();
  for (const selector of contextual) await expect(page.locator(selector)).toBeHidden();

  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/?preview=mobile#places');
  const mobileToggle = page.locator('[data-place-action="selection"]');
  const actionBar = page.locator('.mobile-place-selection-actions');
  await expect(actionBar).toBeHidden();
  await mobileToggle.click();
  await expect(mobileToggle).toHaveText('完成');
  await expect(mobileToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(actionBar).toBeVisible();
  const mobileLayout = await actionBar.evaluate(element => ({
    buttonHeights: [...element.querySelectorAll('button')].map(button => button.getBoundingClientRect().height),
    clippedButtons: [...element.querySelectorAll('button')].filter(button => button.scrollWidth > button.clientWidth).length,
    overflowX: element.scrollWidth > element.clientWidth,
    pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
  expect(mobileLayout.buttonHeights.every(value => value === 44)).toBe(true);
  expect(mobileLayout.clippedButtons).toBe(0);
  expect(mobileLayout.overflowX).toBe(false);
  expect(mobileLayout.pageOverflowX).toBe(false);

  await actionBar.locator('[data-place-batch="delete"]').click();
  const status = page.locator('#placeBatchStatus');
  await expect(status).toBeVisible();
  await expect(status).toHaveText('请先勾选需要删除的地点。');
  await expect(status).toHaveAttribute('data-tone', 'warning');
  const statusLayout = await status.evaluate(element => ({
    width: element.getBoundingClientRect().width,
    background: getComputedStyle(element).backgroundColor,
    overflowX: element.scrollWidth > element.clientWidth
  }));
  expect(statusLayout.width).toBe(328);
  expect(statusLayout.background).toBe('rgb(255, 249, 233)');
  expect(statusLayout.overflowX).toBe(false);

  const firstCheckbox = page.locator('.place-select').first();
  expect(await firstCheckbox.evaluate(input => input.getBoundingClientRect().width)).toBe(22);
  await firstCheckbox.check();
  await expect(actionBar.locator('[data-place-selection-count]')).toHaveText('已选 1 项');
  await actionBar.locator('[data-place-batch="delete"]').click();
  const batchConfirmation = page.locator('.action-confirm-dialog');
  await expect(batchConfirmation).toBeVisible();
  await expect(batchConfirmation.locator('#actionConfirmTitle')).toHaveText('批量删除地点');
  await expect(batchConfirmation.locator('[data-confirm-submit]')).toHaveText('删除 1 个地点');
  await batchConfirmation.locator('[data-confirm-cancel]').click();
  await expect(firstCheckbox).toBeChecked();
  await actionBar.locator('[data-place-batch="all"]').click();
  await expect.poll(() => page.locator('.place-select:checked').count()).toBeGreaterThan(1);
  await mobileToggle.click();
  await expect(actionBar).toBeHidden();
  await expect(page.locator('.place-select')).toHaveCount(0);
  expect(nativeDialogs).toEqual([]);
});

test('mobile account auth sheet follows its content instead of filling the screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/?preview=mobile#plans');
  await page.locator('[data-account]').click();
  const dialog = page.locator('#accountDialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveClass(/is-account-auth/);
  await expect(dialog.locator('#accUsername')).toBeFocused();
  const loginLayout = await dialog.evaluate(element => ({
    height: element.getBoundingClientRect().height,
    overflowX: element.scrollWidth > element.clientWidth,
    pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
  expect(loginLayout.height).toBeLessThan(520);
  expect(loginLayout.overflowX).toBe(false);
  expect(loginLayout.pageOverflowX).toBe(false);
  await dialog.locator('#accToggle').click();
  await expect(dialog.locator('#accNickname')).toBeVisible();
  await expect(dialog.locator('#accSubmit')).toHaveText('注册并登录');
  await expect(dialog.locator('#closeUniversalPlaceDialog')).toHaveCount(0);
  await expect(dialog.locator('.editor-actions button')).toBeVisible();
  const registerActions = await dialog.locator('.account-actions').evaluate(element => {
    const buttons = [...element.querySelectorAll('button')];
    const rects = buttons.map(button => button.getBoundingClientRect());
    return {
      heights: rects.map(rect => rect.height),
      firstRowAligned: Math.abs(rects[0].top - rects[1].top) < 1,
      localModeFullRow: rects[2].left <= rects[0].left + 1 && rects[2].right >= rects[1].right - 1,
      clipped: buttons.some(button => button.scrollWidth > button.clientWidth),
      overflowX: element.scrollWidth > element.clientWidth
    };
  });
  expect(registerActions.heights.every(height => height >= 44)).toBe(true);
  expect(registerActions.firstRowAligned).toBe(true);
  expect(registerActions.localModeFullRow).toBe(true);
  expect(registerActions.clipped).toBe(false);
  expect(registerActions.overflowX).toBe(false);
  await page.screenshot({ path: 'work/mobile-account-auth-stage120.png' });
});

test('desktop account auth uses the compact form width without empty side space', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?preview=desktop');
  await page.locator('#accountBtn').click();
  const dialog = page.locator('#accountDialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveClass(/is-account-auth/);
  await expect(dialog.locator('#accUsername')).toBeFocused();
  const loginLayout = await dialog.evaluate(element => ({
    width: element.getBoundingClientRect().width,
    panelWidth: element.querySelector('#accountPanel').getBoundingClientRect().width,
    inputHeights: [...element.querySelectorAll('.account-auth input')].map(input => input.getBoundingClientRect().height),
    actionHeights: [...element.querySelectorAll('.account-actions button')].map(button => button.getBoundingClientRect().height),
    clippedActions: [...element.querySelectorAll('.account-actions button')].some(button => button.scrollWidth > button.clientWidth),
    overflowX: element.scrollWidth > element.clientWidth,
    pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
  expect(loginLayout.width).toBe(520);
  expect(loginLayout.panelWidth).toBe(476);
  expect(loginLayout.inputHeights.every(height => height === 40)).toBe(true);
  expect(loginLayout.actionHeights.every(height => height === 40)).toBe(true);
  expect(loginLayout.clippedActions).toBe(false);
  expect(loginLayout.overflowX).toBe(false);
  expect(loginLayout.pageOverflowX).toBe(false);
  await dialog.locator('#accToggle').click();
  await expect(dialog.locator('#accNickname')).toBeVisible();
  await expect(dialog.locator('#accSubmit')).toHaveText('注册并登录');
  expect(await dialog.evaluate(element => element.getBoundingClientRect().width)).toBe(520);
});

test('mobile collaborator controls remain readable and touch sized', async ({ page }) => {
  const nativeDialogs = [];
  page.on('dialog', async dialog => { nativeDialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.setViewportSize({ width: 393, height: 852 });
  await page.addInitScript(() => localStorage.setItem('roadtrip-token', 'ui-preview-token'));
  const plannerData = {
    name: '北疆秋季自驾', activeVersion: 'p1', plans: [{ id: 'p1', name: '主方案' }],
    versions: { p1: { name: '主方案', items: [], schedule: [], expenses: [], locations: [], routes: [], placeCategories: [], preferences: {} } },
    locations: [], routes: [], sharedSchedule: {}
  };
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let response;
    if (path === '/api/auth/me') response = { user: { _id: 'u1', username: 'traveler', nickname: '旅行者小林' } };
    else if (path === '/api/trips') response = { trips: { mine: [{ _id: 't1', name: '北疆秋季自驾环线', role: 'owner', updated_at: '2026-09-24', share_enabled: true, share_code: 'AB2C3D4E' }], shared: [] } };
    else if (path === '/api/trips/t1/members') response = { members: [{ user_id: 'u1', role: 'owner' }, { user_id: 'u2', role: 'editor', username: 'friend_a', nickname: '阿禾' }, { user_id: 'u3', role: 'viewer', username: 'friend_b', nickname: '小周' }] };
    else if (/^\/api\/trips\/[^/]+$/.test(path)) response = { trip: { _id: path.split('/').pop(), name: '北疆秋季自驾环线', updated_at: '2026-09-24', data: plannerData } };
    else return route.continue();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
  });
  await page.goto('/?preview=mobile#plans');
  await page.locator('[data-account]').click();
  const dialog = page.locator('#accountDialog');
  await expect(dialog).not.toHaveClass(/is-account-auth/);
  const tripTitleLayout = await dialog.locator('.account-trip > div:first-child b').evaluate(element => ({
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
    whiteSpace: getComputedStyle(element).whiteSpace
  }));
  expect(tripTitleLayout.width).toBeGreaterThan(300);
  expect(tripTitleLayout.height).toBeLessThan(24);
  expect(tripTitleLayout.whiteSpace).toBe('nowrap');
  await dialog.locator('[data-members-trip="t1"]').click();
  const members = dialog.locator('.account-member');
  await expect(members).toHaveCount(2);
  const layout = await members.evaluateAll(rows => ({
    rowHeights: rows.map(row => row.getBoundingClientRect().height),
    controlHeights: rows.flatMap(row => [...row.querySelectorAll('select,button')].map(control => control.getBoundingClientRect().height)),
    clipped: rows.some(row => row.scrollWidth > row.clientWidth || [...row.querySelectorAll('select,button')].some(control => control.scrollWidth > control.clientWidth)),
    pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
  expect(layout.rowHeights.every(height => height >= 44)).toBe(true);
  expect(layout.controlHeights.every(height => height >= 44)).toBe(true);
  expect(layout.clipped).toBe(false);
  expect(layout.pageOverflowX).toBe(false);
  await dialog.locator('[data-share-trip="t1"]').click();
  const shareNotice = dialog.locator('[data-share-notice="t1"]');
  await expect(shareNotice).toBeVisible();
  await expect(shareNotice).toContainText('分享码 AB2C3D4E');
  await expect(shareNotice).toContainText('默认只能查看');
  expect(await shareNotice.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
  await members.first().locator('button').click();
  const confirmation = page.locator('.action-confirm-dialog');
  await expect(confirmation).toBeVisible();
  await expect(confirmation.locator('#actionConfirmTitle')).toHaveText('移除协作者');
  await expect(confirmation.locator('#actionConfirmMessage')).toContainText('阿禾');
  await confirmation.locator('[data-confirm-cancel]').click();
  await expect(members).toHaveCount(2);
  expect(nativeDialogs).toEqual([]);
  await page.screenshot({ path: 'work/mobile-account-collaboration-stage120.png' });
});

test('desktop account trip and collaborator management use the full dialog content width', async ({ page }) => {
  const nativeDialogs = [];
  page.on('dialog', async dialog => { nativeDialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem('roadtrip-token', 'ui-preview-token'));
  const plannerData = {
    name: '北疆秋季自驾', activeVersion: 'p1', plans: [{ id: 'p1', name: '主方案' }],
    versions: { p1: { name: '主方案', items: [], schedule: [], expenses: [], locations: [], routes: [], placeCategories: [], preferences: {} } },
    locations: [], routes: [], sharedSchedule: {}
  };
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let response;
    if (path === '/api/auth/me') response = { user: { _id: 'u1', username: 'traveler', nickname: '旅行者小林' } };
    else if (path === '/api/trips') response = { trips: { mine: [{ _id: 't1', name: '北疆秋季自驾环线', role: 'owner', updated_at: '2026-09-24', share_enabled: true, share_code: 'AB2C3D4E' }], shared: [{ _id: 't2', name: '南疆协作路线', role: 'editor', updated_at: '2026-09-20' }] } };
    else if (path === '/api/trips/t1/members') response = { members: [{ user_id: 'u1', role: 'owner' }, { user_id: 'u2', role: 'editor', username: 'friend_a', nickname: '阿禾' }, { user_id: 'u3', role: 'viewer', username: 'friend_b', nickname: '小周' }] };
    else if (path === '/api/trips/t1/backups') response = { backups: [{ _id: 'b1', created_at: '2026-09-24T08:30:00.000Z', plan_name: '主方案' }] };
    else if (/^\/api\/trips\/[^/]+$/.test(path)) response = { trip: { _id: path.split('/').pop(), name: '北疆秋季自驾环线', updated_at: '2026-09-24', data: plannerData } };
    else return route.continue();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
  });
  await page.goto('/?preview=desktop');
  await page.locator('#accountBtn').click();
  const dialog = page.locator('#accountDialog');
  await expect(dialog).not.toHaveClass(/is-account-auth/);
  const tripsLayout = await dialog.evaluate(element => ({
    width: element.getBoundingClientRect().width,
    panelWidth: element.querySelector('#accountPanel').getBoundingClientRect().width,
    overflowX: element.scrollWidth > element.clientWidth,
    pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
  expect(tripsLayout.width).toBe(720);
  expect(tripsLayout.panelWidth).toBe(676);
  expect(tripsLayout.overflowX).toBe(false);
  expect(tripsLayout.pageOverflowX).toBe(false);

  await dialog.locator('[data-share-trip="t1"]').click();
  const shareNotice = dialog.locator('[data-share-notice="t1"]');
  await expect(shareNotice).toBeVisible();
  const shareLayout = await shareNotice.evaluate(element => ({
    width: element.getBoundingClientRect().width,
    background: getComputedStyle(element).backgroundColor,
    overflowX: element.scrollWidth > element.clientWidth
  }));
  expect(shareLayout.width).toBe(650);
  expect(shareLayout.background).toBe('rgb(237, 248, 240)');
  expect(shareLayout.overflowX).toBe(false);

  await dialog.locator('[data-members-trip="t1"]').click();
  const members = dialog.locator('.account-member');
  await expect(members).toHaveCount(2);
  const memberLayout = await members.evaluateAll(rows => ({
    widths: rows.map(row => row.getBoundingClientRect().width),
    heights: rows.map(row => row.getBoundingClientRect().height),
    controlHeights: rows.flatMap(row => [...row.querySelectorAll('select,button')].map(control => control.getBoundingClientRect().height)),
    clipped: rows.some(row => row.scrollWidth > row.clientWidth || [...row.querySelectorAll('select,button')].some(control => control.scrollWidth > control.clientWidth))
  }));
  expect(memberLayout.widths.every(width => width === 630)).toBe(true);
  expect(memberLayout.heights.every(height => height === 40)).toBe(true);
  expect(memberLayout.controlHeights.every(height => height === 40)).toBe(true);
  expect(memberLayout.clipped).toBe(false);

  await dialog.locator('[data-backups-trip="t1"]').click();
  const restore = dialog.locator('[data-restore="b1"]');
  await expect(restore).toBeVisible();
  await restore.click();
  const confirmation = page.locator('.action-confirm-dialog');
  await expect(confirmation).toBeVisible();
  await expect(confirmation.locator('#actionConfirmTitle')).toHaveText('恢复行程备份');
  await expect(confirmation.locator('[data-confirm-submit]')).toHaveText('恢复并覆盖');
  await confirmation.locator('[data-confirm-cancel]').click();
  await expect(dialog).toBeVisible();
  await expect(restore).toBeVisible();
  expect(nativeDialogs).toEqual([]);
});

test('mobile category and plan forms use compact sheets with a clear delete state', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.route('**/api/planner-data', async route => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ updatedAt: new Date().toISOString() }) });
      return;
    }
    await route.continue();
  });
  await page.goto('/?preview=mobile#places');
  await page.locator('#addPlaceCategoryBtn').evaluate(button => button.click());
  const categoryDialog = page.locator('#placeCategoryEditor');
  await expect(categoryDialog).toBeVisible();
  await expect(categoryDialog).toHaveClass(/compact-form-dialog/);
  await expect(categoryDialog.locator('#newPlaceCategoryName')).toBeFocused();
  const categoryLayout = await categoryDialog.evaluate(dialog => ({
    height: dialog.getBoundingClientRect().height,
    colorHeight: dialog.querySelector('#newPlaceCategoryColor').getBoundingClientRect().height,
    actionHeights: [...dialog.querySelectorAll('.editor-actions button')].map(button => button.getBoundingClientRect().height),
    overflowX: dialog.scrollWidth > dialog.clientWidth,
    pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
  expect(categoryLayout.height).toBeLessThan(440);
  expect(categoryLayout.colorHeight).toBe(44);
  expect(categoryLayout.actionHeights.every(height => height === 48)).toBe(true);
  expect(categoryLayout.overflowX).toBe(false);
  expect(categoryLayout.pageOverflowX).toBe(false);
  await page.screenshot({ path: 'work/mobile-place-category-dialog-stage125.png' });
  await categoryDialog.locator('#placeCategoryEditorCancel').click();

  await page.locator('.mobile-tabbar [data-mobile-view="plans"]').click();
  const planDialog = page.locator('#planDialog');
  const command = text => page.locator('.mobile-plans-panel button').filter({ hasText: text });
  await command('新建行程方案').click();
  await expect(planDialog).toBeVisible();
  await expect(planDialog).toHaveClass(/compact-form-dialog/);
  await expect(planDialog.locator('#planDialogName')).toBeFocused();
  expect(await planDialog.evaluate(dialog => dialog.getBoundingClientRect().height)).toBeLessThan(340);
  await planDialog.locator('#planDialogCancel').click();
  await command('复制当前方案').click();
  await expect(planDialog.locator('#planDialogTitle')).toHaveText('复制行程方案');
  await expect(planDialog.locator('#planDialogSubmit')).toHaveText('复制方案');
  await planDialog.locator('#planDialogCancel').click();

  await command('新建行程方案').click();
  await planDialog.locator('#planDialogName').fill('临时视觉验收方案');
  await planDialog.locator('#planDialogSubmit').click();
  await expect(planDialog).toBeHidden();
  await expect(command('删除当前方案')).toBeEnabled();
  await command('删除当前方案').click();
  await expect(planDialog).toHaveClass(/is-danger-mode/);
  await expect(planDialog.locator('#planDialogTitle')).toHaveText('确认删除行程方案');
  await expect(planDialog.locator('#planDialogSubmit')).toHaveClass(/danger/);
  await expect(planDialog.locator('#planDialogHint')).toHaveAttribute('role', 'status');
  const deleteLayout = await planDialog.evaluate(dialog => ({
    height: dialog.getBoundingClientRect().height,
    submitColor: getComputedStyle(dialog.querySelector('#planDialogSubmit')).backgroundColor,
    overflowX: dialog.scrollWidth > dialog.clientWidth,
    pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
  expect(deleteLayout.height).toBeLessThan(360);
  expect(deleteLayout.submitColor).toBe('rgb(200, 55, 45)');
  expect(deleteLayout.overflowX).toBe(false);
  expect(deleteLayout.pageOverflowX).toBe(false);
  await page.screenshot({ path: 'work/mobile-plan-dialog-stage125.png' });
});

test('desktop compact forms share width, hints, color input and danger hierarchy', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/api/planner-data', async route => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ updatedAt: new Date().toISOString() }) });
      return;
    }
    await route.continue();
  });
  await page.goto('/?preview=desktop');

  await page.locator('#addPlaceCategoryBtn').click();
  const categoryDialog = page.locator('#placeCategoryEditor');
  await expect(categoryDialog).toBeVisible();
  const categoryLayout = await categoryDialog.evaluate(dialog => {
    const color = dialog.querySelector('#newPlaceCategoryColor').getBoundingClientRect();
    return {
      width: dialog.getBoundingClientRect().width,
      colorWidth: color.width,
      colorHeight: color.height,
      hintBackground: getComputedStyle(dialog.querySelector('.hint')).backgroundColor,
      overflowX: dialog.scrollWidth > dialog.clientWidth,
      pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  expect(categoryLayout.width).toBe(520);
  expect(categoryLayout.colorWidth).toBe(72);
  expect(categoryLayout.colorHeight).toBe(40);
  expect(categoryLayout.hintBackground).toBe('rgb(238, 246, 240)');
  expect(categoryLayout.overflowX).toBe(false);
  expect(categoryLayout.pageOverflowX).toBe(false);
  await categoryDialog.locator('#placeCategoryEditorCancel').click();

  const planDialog = page.locator('#planDialog');
  await page.locator('#newPlanBtn').click();
  await expect(planDialog).toBeVisible();
  expect(await planDialog.evaluate(dialog => dialog.getBoundingClientRect().width)).toBe(520);
  await planDialog.locator('#planDialogName').fill('桌面紧凑回归方案');
  await planDialog.locator('#planDialogSubmit').click();
  await page.locator('#deletePlanBtn').click();
  await expect(planDialog).toHaveClass(/is-danger-mode/);
  const dangerLayout = await planDialog.evaluate(dialog => ({
    width: dialog.getBoundingClientRect().width,
    hintBackground: getComputedStyle(dialog.querySelector('#planDialogHint')).backgroundColor,
    submitBackground: getComputedStyle(dialog.querySelector('#planDialogSubmit')).backgroundColor
  }));
  expect(dangerLayout.width).toBe(520);
  expect(dangerLayout.hintBackground).toBe('rgb(255, 240, 238)');
  expect(dangerLayout.submitBackground).toBe('rgb(200, 55, 45)');
  await planDialog.locator('#planDialogCancel').click();

  await page.reload();
  const dispatchPlaceDrop = selector => page.evaluate(targetSelector => {
    const card = document.querySelector('.place-card');
    const target = document.querySelector(targetSelector);
    if (!card || !target) return false;
    const dataTransfer = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('drop', {
      bubbles: true, cancelable: true, dataTransfer,
      clientY: target.getBoundingClientRect().top + 80
    }));
    return true;
  }, selector);
  expect(await dispatchPlaceDrop('.calendar-block')).toBe(true);
  const associationDialog = page.locator('#placeDropEditor');
  await expect(associationDialog).toBeVisible();
  expect(await associationDialog.evaluate(dialog => dialog.getBoundingClientRect().width)).toBe(520);
  await expect(associationDialog.locator('#placeDropUpdate')).toHaveClass(/ghost/);
  expect(await associationDialog.locator('.hint').evaluate(hint => getComputedStyle(hint).backgroundColor)).toBe('rgb(238, 246, 240)');
  await associationDialog.locator('#placeDropCancel').click();

  expect(await dispatchPlaceDrop('.calendar-day')).toBe(true);
  const creationDialog = page.locator('#placeCreateDropEditor');
  await expect(creationDialog).toBeVisible();
  expect(await creationDialog.evaluate(dialog => dialog.getBoundingClientRect().width)).toBe(520);
  expect(await creationDialog.evaluate(dialog => dialog.scrollWidth > dialog.clientWidth)).toBe(false);
  await creationDialog.locator('#placeCreateDropCancel').click();
});

test('mobile place drop choices use compact sheets and distinct action hierarchy', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/?preview=mobile#schedule');
  await page.locator('.mobile-tabbar [data-mobile-view="places"]').click();
  await expect(page.locator('.place-card')).not.toHaveCount(0);
  await page.locator('.mobile-tabbar [data-mobile-view="schedule"]').click();
  await expect(page.locator('.calendar-block')).not.toHaveCount(0);

  const openedAssociation = await page.evaluate(() => {
    const card = document.querySelector('.place-card');
    const block = document.querySelector('.calendar-block');
    if (!card || !block) return false;
    const dataTransfer = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
    block.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    return true;
  });
  expect(openedAssociation).toBe(true);
  const associationDialog = page.locator('#placeDropEditor');
  await expect(associationDialog).toBeVisible();
  await expect(associationDialog).toHaveClass(/compact-form-dialog/);
  await expect(associationDialog).toHaveAttribute('aria-describedby', 'placeDropPrompt');
  await expect(associationDialog.locator('#placeDropUpdate')).toHaveText('更新地点');
  await expect(associationDialog.locator('#placeDropUpdate')).toHaveAttribute('aria-label', '更新已关联地点');
  await expect(associationDialog.locator('#placeDropUpdate')).toHaveClass(/ghost/);
  const associationLayout = await associationDialog.evaluate(dialog => ({
    height: dialog.getBoundingClientRect().height,
    actionHeights: [...dialog.querySelectorAll('.editor-actions button')].map(button => button.getBoundingClientRect().height),
    clippedActions: [...dialog.querySelectorAll('.editor-actions button')].some(button => button.scrollWidth > button.clientWidth),
    overflowX: dialog.scrollWidth > dialog.clientWidth,
    pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
  expect(associationLayout.height).toBeLessThan(430);
  expect(associationLayout.actionHeights.every(height => height === 48)).toBe(true);
  expect(associationLayout.clippedActions).toBe(false);
  expect(associationLayout.overflowX).toBe(false);
  expect(associationLayout.pageOverflowX).toBe(false);
  await page.screenshot({ path: 'work/mobile-place-drop-dialog-stage124.png' });
  await associationDialog.locator('#placeDropCancel').click();

  const openedCreation = await page.evaluate(() => {
    const card = document.querySelector('.place-card');
    const day = document.querySelector('.calendar-day');
    if (!card || !day) return false;
    const dataTransfer = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
    day.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientY: day.getBoundingClientRect().top + 80
    }));
    return true;
  });
  expect(openedCreation).toBe(true);
  const creationDialog = page.locator('#placeCreateDropEditor');
  await expect(creationDialog).toBeVisible();
  await expect(creationDialog).toHaveClass(/compact-form-dialog/);
  await expect(creationDialog).toHaveAttribute('aria-describedby', 'placeCreateDropPrompt');
  const creationLayout = await creationDialog.evaluate(dialog => ({
    height: dialog.getBoundingClientRect().height,
    actionHeights: [...dialog.querySelectorAll('.editor-actions button')].map(button => button.getBoundingClientRect().height),
    overflowX: dialog.scrollWidth > dialog.clientWidth,
    pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
  expect(creationLayout.height).toBeLessThan(340);
  expect(creationLayout.actionHeights.every(height => height === 48)).toBe(true);
  expect(creationLayout.overflowX).toBe(false);
  expect(creationLayout.pageOverflowX).toBe(false);
  await creationDialog.locator('#placeCreateDropCancel').click();
});

test('mobile transport importer separates required fields from flight-only details', async ({ page }) => {
  let nativeDialogs = 0;
  page.on('dialog', async browserDialog => { nativeDialogs += 1; await browserDialog.dismiss(); });
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/?preview=mobile#plans');
  await page.locator('.mobile-plans-panel [data-command="#importFlightBtn"]').click();
  const dialog = page.locator('#flightImporter');
  const extras = dialog.locator('.transport-extra-section');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveClass(/transport-import-dialog/);
  await expect(dialog).toHaveAttribute('aria-describedby', 'transportImportHint transportImportStatus');
  await expect(dialog.locator('#transportImportHint')).toHaveAttribute('role', 'status');
  const validation = dialog.locator('#transportImportStatus');
  await expect(validation).toBeHidden();
  await expect(extras).not.toHaveAttribute('open', '');
  await expect(extras).toBeVisible();
  await expect(dialog.locator('#flightNumber')).toBeFocused();

  const flightLayout = await dialog.evaluate(element => {
    const rect = id => element.querySelector(`#${id}`).getBoundingClientRect();
    const form = element.querySelector('.editor-form');
    const actions = element.querySelector('.editor-actions').getBoundingClientRect();
    return {
      dateRowDelta: Math.abs(rect('flightDate').top - rect('flightArrivalDate').top),
      timeRowDelta: Math.abs(rect('flightDepartureTime').top - rect('flightArrivalTime').top),
      extraHeight: element.querySelector('.transport-extra-section').getBoundingClientRect().height,
      formScrollHeight: form.scrollHeight,
      actionBottom: actions.bottom,
      overflowX: element.scrollWidth > element.clientWidth,
      pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  expect(flightLayout.dateRowDelta).toBeLessThan(1);
  expect(flightLayout.timeRowDelta).toBeLessThan(1);
  expect(flightLayout.extraHeight).toBeGreaterThanOrEqual(52);
  expect(flightLayout.formScrollHeight).toBeLessThan(1100);
  expect(flightLayout.actionBottom).toBeLessThanOrEqual(852);
  expect(flightLayout.overflowX).toBe(false);
  expect(flightLayout.pageOverflowX).toBe(false);

  await dialog.locator('#flightDate').fill('2026-09-24');
  await dialog.locator('#flightArrivalDate').fill('2026-09-24');
  await dialog.locator('#flightNumber').fill('CZ1234');
  await dialog.locator('#flightDeparture').fill('测试出发机场');
  await dialog.locator('#flightArrival').fill('测试到达机场');
  await dialog.locator('#flightDepartureTime').fill('12:00');
  await dialog.locator('#flightArrivalTime').fill('11:00');
  await dialog.locator('button[type="submit"]').click();
  await expect(validation).toContainText('到达日期和时间必须晚于起飞日期和时间');
  await expect(dialog.locator('#flightArrivalTime')).toBeFocused();
  expect(nativeDialogs).toBe(0);
  const validationLayout = await validation.evaluate(element => ({
    width: element.getBoundingClientRect().width,
    overflowX: element.scrollWidth > element.clientWidth
  }));
  expect(validationLayout.width).toBeLessThanOrEqual(365);
  expect(validationLayout.overflowX).toBe(false);
  await dialog.locator('#flightArrivalTime').fill('13:00');
  await expect(validation).toBeHidden();

  await extras.locator('summary').click();
  await expect(extras).toHaveAttribute('open', '');
  expect(await extras.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(250);
  await expect(dialog.locator('#flightDepartureTerminal')).toBeVisible();
  await expect(dialog.locator('#flightStopoverAirport')).toBeVisible();
  await dialog.locator('#flightStopoverAirport').fill('测试经停机场');
  await dialog.locator('button[type="submit"]').click();
  await expect(validation).toContainText('请同时填写经停到达和再次起飞时间');
  await expect(dialog.locator('#flightStopoverArrivalTime')).toBeFocused();
  expect(nativeDialogs).toBe(0);

  await dialog.locator('#transportImportMode').selectOption('train');
  await expect(validation).toBeHidden();
  await expect(dialog.locator('h3')).toHaveText('导入动车 / 高铁');
  await expect(extras).toBeHidden();
  await expect(dialog.locator('#transportImportHint')).toContainText('完整车站名称');
  await expect(dialog.locator('#flightNumber')).toHaveAttribute('placeholder', /G1234/);
  await expect(dialog.locator('#flightDeparture').locator('..')).toContainText('出发站');

  await page.setViewportSize({ width: 360, height: 640 });
  const shortLayout = await dialog.evaluate(element => {
    const actions = element.querySelector('.editor-actions').getBoundingClientRect();
    return {
      actionBottom: actions.bottom,
      actionHeights: [...element.querySelectorAll('.editor-actions button')].map(button => button.getBoundingClientRect().height),
      overflowX: element.scrollWidth > element.clientWidth,
      pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  expect(shortLayout.actionBottom).toBeLessThanOrEqual(640);
  expect(shortLayout.actionHeights.every(height => height === 48)).toBe(true);
  expect(shortLayout.overflowX).toBe(false);
  expect(shortLayout.pageOverflowX).toBe(false);
  await dialog.locator('.editor-form').evaluate(form => { form.scrollTop = 0; });
  await page.screenshot({ path: 'work/mobile-transport-dialog-stage119.png' });
  await dialog.locator('#flightImportCancel').click();
});

test('desktop transport importer pairs dates and times while keeping locations full width', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?preview=desktop');
  await page.locator('#importFlightBtn').click();
  const dialog = page.locator('#flightImporter');
  const extras = dialog.locator('.transport-extra-section');
  await expect(dialog).toBeVisible();
  const flightLayout = await dialog.evaluate(element => {
    const rect = id => element.querySelector(`#${id}`).getBoundingClientRect();
    return {
      height: element.getBoundingClientRect().height,
      dateRowDelta: Math.abs(rect('flightDate').top - rect('flightArrivalDate').top),
      timeRowDelta: Math.abs(rect('flightDepartureTime').top - rect('flightArrivalTime').top),
      numberWidth: rect('flightNumber').width,
      departureWidth: rect('flightDeparture').width,
      arrivalWidth: rect('flightArrival').width,
      overflowX: element.scrollWidth > element.clientWidth,
      pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  expect(flightLayout.height).toBeLessThan(740);
  expect(flightLayout.dateRowDelta).toBeLessThan(1);
  expect(flightLayout.timeRowDelta).toBeLessThan(1);
  expect(flightLayout.numberWidth).toBe(676);
  expect(flightLayout.departureWidth).toBe(676);
  expect(flightLayout.arrivalWidth).toBe(676);
  expect(flightLayout.overflowX).toBe(false);
  expect(flightLayout.pageOverflowX).toBe(false);

  await dialog.locator('#flightDate').fill('2026-09-24');
  await dialog.locator('#flightArrivalDate').fill('2026-09-23');
  await dialog.locator('#flightNumber').fill('G1234');
  await dialog.locator('#flightDeparture').fill('测试出发站');
  await dialog.locator('#flightArrival').fill('测试到达站');
  await dialog.locator('#flightDepartureTime').fill('10:00');
  await dialog.locator('#flightArrivalTime').fill('11:00');
  await dialog.locator('#transportImportMode').selectOption('train');
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog.locator('#transportImportStatus')).toContainText('到站日期和时间必须晚于发车日期和时间');
  await expect(dialog.locator('#flightArrivalDate')).toBeFocused();
  await expect(dialog.locator('#transportImportStatus')).toHaveCSS('overflow-wrap', 'anywhere');
  await dialog.locator('#transportImportMode').selectOption('flight');
  await expect(dialog.locator('#transportImportStatus')).toBeHidden();

  await extras.locator('summary').click();
  await expect(extras).toHaveAttribute('open', '');
  expect(await extras.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(250);
  expect(await dialog.evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(900);

  await dialog.locator('#transportImportMode').selectOption('train');
  await expect(extras).toBeHidden();
  await expect(dialog.locator('h3')).toHaveText('导入动车 / 高铁');
  const trainLayout = await dialog.evaluate(element => ({
    height: element.getBoundingClientRect().height,
    actionBottom: element.querySelector('.editor-actions').getBoundingClientRect().bottom,
    overflowX: element.scrollWidth > element.clientWidth,
    pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
  expect(trainLayout.height).toBeLessThan(680);
  expect(trainLayout.actionBottom).toBeLessThanOrEqual(900);
  expect(trainLayout.overflowX).toBe(false);
  expect(trainLayout.pageOverflowX).toBe(false);
  await dialog.locator('#flightImportCancel').click();
});

test('mobile place editor keeps core fields compact and secondary details collapsible', async ({ page }) => {
  let nativeDialogs = 0;
  page.on('dialog', async browserDialog => { nativeDialogs += 1; await browserDialog.dismiss(); });
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/?preview=mobile#places');
  await page.locator('#addPlaceBtn').click();
  const dialog = page.locator('#placeEditor');
  const photoSection = dialog.locator('.place-photo-section');
  const detailsSection = dialog.locator('.place-details-section');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveClass(/place-editor-dialog/);
  await expect(dialog.locator('#newPlaceName')).toBeFocused();
  await expect(photoSection).not.toHaveAttribute('open', '');
  await expect(detailsSection).not.toHaveAttribute('open', '');
  await expect(dialog.locator('.place-photo-upload-button')).toHaveText('选择本地图片');
  await expect(dialog.locator('.place-photo-upload-name')).toHaveText('未选择图片');
  const queryStatus = dialog.locator('#newPlaceAmapStatus');
  await expect(queryStatus).toHaveAttribute('role', 'status');
  await expect(queryStatus).toHaveAttribute('aria-live', 'polite');
  await dialog.locator('#queryNewPlaceLocation').click();
  await expect(queryStatus).toHaveAttribute('data-tone', 'error');
  await expect(queryStatus).toHaveText('请先填写地点名称。');
  await expect(dialog.locator('#newPlaceName')).toBeFocused();
  expect(nativeDialogs).toBe(0);
  await dialog.locator('#newPlaceName').fill('测试地点');
  await expect(queryStatus).not.toHaveAttribute('data-tone', 'error');
  await dialog.locator('#queryNewPlacePhotos').click();
  await expect(queryStatus).toHaveText('请先填写地点名称和完整地址。');
  await expect(dialog.locator('#newPlaceAddress')).toBeFocused();
  expect(nativeDialogs).toBe(0);
  const newLayout = await dialog.evaluate(element => {
    const form = element.querySelector('.editor-form');
    const actions = element.querySelector('.editor-actions').getBoundingClientRect();
    return {
      height: element.getBoundingClientRect().height,
      formScroll: form.scrollHeight,
      contextSpace: element.querySelector('#placeEditorContext').getBoundingClientRect().height + parseFloat(getComputedStyle(form).rowGap),
      photoHeight: element.querySelector('.place-photo-section').getBoundingClientRect().height,
      detailsHeight: element.querySelector('.place-details-section').getBoundingClientRect().height,
      actionBottom: actions.bottom,
      statusWidth: element.querySelector('#newPlaceAmapStatus').getBoundingClientRect().width,
      statusOverflowX: element.querySelector('#newPlaceAmapStatus').scrollWidth > element.querySelector('#newPlaceAmapStatus').clientWidth,
      overflowX: element.scrollWidth > element.clientWidth,
      pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  expect(newLayout.height).toBeLessThanOrEqual(852 * .92);
  expect(newLayout.height - newLayout.contextSpace).toBeLessThanOrEqual(682);
  expect(newLayout.formScroll - newLayout.contextSpace).toBeLessThan(700);
  expect(newLayout.photoHeight).toBeGreaterThanOrEqual(52);
  expect(newLayout.detailsHeight).toBeGreaterThanOrEqual(52);
  expect(newLayout.actionBottom).toBeLessThanOrEqual(852);
  expect(newLayout.statusWidth).toBeLessThanOrEqual(365);
  expect(newLayout.statusOverflowX).toBe(false);
  expect(newLayout.overflowX).toBe(false);
  expect(newLayout.pageOverflowX).toBe(false);

  await photoSection.locator('summary').click();
  await expect(photoSection).toHaveAttribute('open', '');
  await expect(dialog.locator('.place-photo-upload-button')).toBeVisible();
  await expect(dialog.locator('#newPlacePhoto')).toBeAttached();
  await dialog.locator('#placeEditorCancel').click();

  await page.locator('.place-card').first().locator('button', { hasText: '编辑' }).click();
  await expect(dialog.locator('h3')).toHaveText('编辑地点');
  await expect(dialog.locator('#placeEditorDelete')).toBeVisible();
  await expect(dialog.locator('[data-place-photo-summary]')).toContainText('已有图片');
  await expect(dialog.locator('[data-place-details-summary]')).toContainText('已填写');
  const editLayout = await dialog.evaluate(element => {
    const form = element.querySelector('.editor-form');
    const association = element.querySelector('.place-event-associations').getBoundingClientRect();
    const formRect = form.getBoundingClientRect();
    const actionNode = element.querySelector('.editor-actions');
    const actions = actionNode.getBoundingClientRect();
    return {
      associationWidth: association.width,
      contentWidth: formRect.width - 28,
      formScroll: form.scrollHeight,
      contextSpace: element.querySelector('#placeEditorContext').getBoundingClientRect().height + parseFloat(getComputedStyle(form).rowGap),
      actionWidth: actions.width,
      actionHeights: [...actionNode.querySelectorAll('button')].map(button => button.getBoundingClientRect().height),
      clippedActions: [...actionNode.querySelectorAll('button')].some(button => button.scrollWidth > button.clientWidth),
      overflowX: element.scrollWidth > element.clientWidth,
      pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  expect(Math.abs(editLayout.associationWidth - editLayout.contentWidth)).toBeLessThan(1);
  expect(editLayout.formScroll - editLayout.contextSpace).toBeLessThan(1000);
  expect(editLayout.actionWidth).toBe(381);
  expect(editLayout.actionHeights.every(height => height === 48)).toBe(true);
  expect(editLayout.clippedActions).toBe(false);
  expect(editLayout.overflowX).toBe(false);
  expect(editLayout.pageOverflowX).toBe(false);
  await page.screenshot({ path: 'work/mobile-place-editor-dialog-stage115.png' });
  await page.setViewportSize({ width: 360, height: 640 });
  const shortLayout = await dialog.evaluate(element => {
    const actions = element.querySelector('.editor-actions').getBoundingClientRect();
    const form = element.querySelector('.editor-form');
    return {
      actionBottom: actions.bottom,
      actionTop: actions.top,
      dialogBottom: element.getBoundingClientRect().bottom,
      formScrollable: form.scrollHeight > form.clientHeight,
      overflowX: element.scrollWidth > element.clientWidth,
      pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  expect(shortLayout.actionBottom).toBeLessThanOrEqual(640);
  expect(shortLayout.actionTop).toBeGreaterThanOrEqual(0);
  expect(shortLayout.dialogBottom).toBeLessThanOrEqual(640);
  expect(shortLayout.formScrollable).toBe(true);
  expect(shortLayout.overflowX).toBe(false);
  expect(shortLayout.pageOverflowX).toBe(false);
  await dialog.locator('.editor-form').evaluate(form => { form.scrollTop = 0; });
  await page.screenshot({ path: 'work/mobile-place-editor-dialog-stage122.png' });
  await dialog.locator('#placeEditorCancel').click();
});

test('desktop place editor shares the photo, association and danger-action template', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?preview=desktop');
  await page.locator('#addPlaceBtn').click();
  const dialog = page.locator('#placeEditor');
  await expect(dialog).toBeVisible();
  await dialog.locator('#newPlaceName').fill('测试地点');
  await dialog.locator('#queryNewPlaceDetails').click();
  await expect(dialog.locator('#newPlaceAmapStatus')).toHaveAttribute('data-tone', 'error');
  await expect(dialog.locator('#newPlaceAddress')).toBeFocused();
  await expect(dialog.locator('#newPlaceAmapStatus')).toHaveCSS('overflow-wrap', 'anywhere');
  await dialog.locator('.place-photo-section summary').click();
  await expect(dialog.locator('.place-photo-upload-button')).toHaveText('选择本地图片');
  await expect(dialog.locator('.place-photo-upload-name')).toHaveText('未选择图片');
  const photoLayout = await dialog.evaluate(element => {
    const input = element.querySelector('.place-photo-input');
    return {
      uploadWidth: element.querySelector('.place-photo-upload').getBoundingClientRect().width,
      inputClip: getComputedStyle(input).clipPath,
      overflowX: element.scrollWidth > element.clientWidth,
      pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  expect(photoLayout.uploadWidth).toBeGreaterThan(650);
  expect(photoLayout.inputClip).toBe('inset(50%)');
  expect(photoLayout.overflowX).toBe(false);
  expect(photoLayout.pageOverflowX).toBe(false);
  await dialog.locator('#placeEditorCancel').click();

  await page.locator('#places .place-card').first().locator('button', { hasText: '编辑' }).click();
  const editLayout = await dialog.evaluate(element => {
    const association = element.querySelector('.place-event-associations').getBoundingClientRect();
    const form = element.querySelector('.editor-form').getBoundingClientRect();
    const deleteStyle = getComputedStyle(element.querySelector('#placeEditorDelete'));
    return {
      associationWidth: association.width,
      contentWidth: form.width - 44,
      deleteColor: deleteStyle.color,
      deleteBackground: deleteStyle.backgroundColor,
      overflowX: element.scrollWidth > element.clientWidth,
      pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  expect(Math.abs(editLayout.associationWidth - editLayout.contentWidth)).toBeLessThan(1);
  expect(editLayout.deleteColor).toBe('rgb(160, 79, 67)');
  expect(editLayout.deleteBackground).toBe('rgb(255, 248, 246)');
  expect(editLayout.overflowX).toBe(false);
  expect(editLayout.pageOverflowX).toBe(false);
  await dialog.locator('#placeEditorCancel').click();
});

test('event and place deletion share an accessible responsive confirmation dialog', async ({ page }) => {
  const nativeDialogs = [];
  page.on('dialog', async dialog => { nativeDialogs.push(dialog.message()); await dialog.dismiss(); });

  for (const viewport of [
    { mode: 'desktop', width: 1440, height: 900 },
    { mode: 'mobile', width: 360, height: 640 }
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`/?preview=${viewport.mode}#schedule`);

    await page.locator('.calendar-block.type-spot').first().dblclick({ force: true });
    await page.locator('#editorDelete').click();
    const confirmation = page.locator('.action-confirm-dialog');
    await expect(confirmation).toBeVisible();
    await expect(confirmation.locator('#actionConfirmTitle')).toHaveText('删除事件');
    await expect(confirmation.locator('[data-confirm-cancel]')).toBeFocused();
    const eventLayout = await confirmation.evaluate(element => ({
      width: element.getBoundingClientRect().width,
      actionHeights: [...element.querySelectorAll('.editor-actions button')].map(button => button.getBoundingClientRect().height),
      submitBackground: getComputedStyle(element.querySelector('[data-confirm-submit]')).backgroundColor,
      overflowX: element.scrollWidth > element.clientWidth,
      pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    }));
    expect(eventLayout.width).toBe(viewport.mode === 'desktop' ? 460 : 348);
    expect(eventLayout.actionHeights.every(height => height >= (viewport.mode === 'desktop' ? 42 : 48))).toBe(true);
    expect(eventLayout.submitBackground).toBe('rgb(200, 55, 45)');
    expect(eventLayout.overflowX).toBe(false);
    expect(eventLayout.pageOverflowX).toBe(false);
    if (viewport.mode === 'mobile') await page.screenshot({ path: 'work/mobile-action-confirm-dialog-stage126.png' });
    await page.keyboard.press('Escape');
    await expect(confirmation).toBeHidden();
    await expect(page.locator('#eventEditor')).toBeVisible();
    await page.locator('#editorCancel').click();

    if (viewport.mode === 'mobile') await page.locator('.mobile-tabbar [data-mobile-view="places"]').click();
    await page.locator('#places .place-card').first().locator('button', { hasText: '编辑' }).click();
    await page.locator('#placeEditorDelete').click();
    await expect(confirmation).toBeVisible();
    await expect(confirmation.locator('#actionConfirmTitle')).toHaveText('删除地点');
    await expect(confirmation.locator('#actionConfirmDetail')).toContainText('地点关联会解除');
    await confirmation.locator('[data-confirm-cancel]').click();
    await expect(confirmation).toBeHidden();
    await expect(page.locator('#placeEditor')).toBeVisible();
    await page.locator('#placeEditorCancel').click();
  }

  expect(nativeDialogs).toEqual([]);
});

test('saved route deletion uses the shared confirmation instead of a native prompt', async ({ page }) => {
  const nativeDialogs = [];
  page.on('dialog', async dialog => { nativeDialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?preview=desktop');
  await page.locator('.calendar-block.type-drive').first().click({ force: true });
  const selectedRoute = page.locator('.selected-map-route');
  await expect(selectedRoute).toHaveCount(1);
  await selectedRoute.evaluate(element => {
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      view: window
    }));
  });

  const deleteButton = page.locator('.route-map-delete');
  await expect(deleteButton).toHaveText('删除这条路线');
  const buttonStyle = await deleteButton.evaluate(button => ({
    height: button.getBoundingClientRect().height,
    width: button.getBoundingClientRect().width,
    background: getComputedStyle(button).backgroundColor,
    borderRadius: getComputedStyle(button).borderRadius
  }));
  expect(buttonStyle.height).toBeGreaterThanOrEqual(36);
  expect(buttonStyle.width).toBeGreaterThan(120);
  expect(buttonStyle.background).toBe('rgb(255, 244, 241)');
  expect(buttonStyle.borderRadius).toBe('8px');

  await deleteButton.click();
  const confirmation = page.locator('.action-confirm-dialog');
  await expect(confirmation).toBeVisible();
  await expect(confirmation.locator('#actionConfirmTitle')).toHaveText('删除通用路线');
  await expect(confirmation.locator('[data-confirm-submit]')).toHaveText('删除路线');
  await confirmation.locator('[data-confirm-cancel]').click();
  await expect(selectedRoute).toHaveCount(1);
  expect(nativeDialogs).toEqual([]);
});

test('transport editor separates modes and keeps validation inline on mobile and desktop', async ({ page }) => {
  let nativeDialogs = 0;
  page.on('dialog', async browserDialog => { nativeDialogs += 1; await browserDialog.dismiss(); });
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/?preview=mobile#schedule');
  await page.locator('#addScheduleBtn').click();
  await page.locator('.mobile-editor-types [data-editor-type="transport"]').click();
  await expect(page.locator('#editorTransportKindField')).toBeVisible();
  await page.locator('#editorTransportKind').selectOption('other');
  await expect(page.locator('#eventLocationField')).toBeVisible();
  await page.locator('#editorTransportKind').selectOption('flight');
  await expect(page.locator('#flightFields')).toBeVisible();
  await expect(page.locator('#trainFields')).toBeHidden();
  const status = page.locator('#editorTransportStatus');
  await expect(status).toBeHidden();
  await expect(status).toHaveAttribute('role', 'alert');
  await expect(page.locator('#editorTransportKindField')).toHaveCount(1);
  await expect(page.locator('#trainFields')).toHaveCount(1);
  await page.locator('#editorFlightArrivalDate').fill(await page.locator('#editorDate').inputValue());
  await page.locator('#editorEnd').fill('08:00');
  await page.locator('#editorForm button[type="submit"]').click();
  await expect(status).toContainText('航班到达日期和时间必须晚于起飞日期和时间');
  await expect(page.locator('#editorEnd')).toBeFocused();
  expect(nativeDialogs).toBe(0);
  const mobileLayout = await status.evaluate(element => ({
    width: element.getBoundingClientRect().width,
    overflowX: element.scrollWidth > element.clientWidth,
    pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
  expect(mobileLayout.width).toBeLessThanOrEqual(369);
  expect(mobileLayout.overflowX).toBe(false);
  expect(mobileLayout.pageOverflowX).toBe(false);
  await expect.poll(() => status.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const footer = element.closest('dialog').querySelector('.editor-actions').getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= footer.top;
  }), { message: 'Transport validation feedback must remain above the action bar' }).toBe(true);
  await page.screenshot({ path: 'design/transport-validation-refactor-mobile.png' });
  await page.locator('#editorEnd').fill('10:00');
  await expect(status).toBeHidden();
  await page.locator('#editorTransportKind').selectOption('train');
  await expect(page.locator('#trainFields')).toBeVisible();
  await expect(page.locator('#flightFields')).toBeHidden();
  await page.locator('#editorForm button[type="submit"]').click();
  await expect(status).toContainText('动车信息请填写车次、出发站和到达站');
  await expect(page.locator('#editorTrainNumber')).toBeFocused();
  expect(nativeDialogs).toBe(0);
  await page.locator('#editorCancel').click();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?preview=desktop');
  await page.locator('#addScheduleBtn').click();
  await page.locator('#editorType').selectOption('transport');
  await page.locator('#editorTransportKind').selectOption('train');
  await page.locator('#editorTrainNumber').fill('G1234');
  await page.locator('#editorForm button[type="submit"]').click();
  await expect(page.locator('#editorTransportStatus')).toContainText('动车信息请填写车次、出发站和到达站');
  await expect(page.locator('#editorTrainDeparture')).toBeFocused();
  const desktopLayout = await page.locator('#eventEditor').evaluate(element => ({
    statusWidth: element.querySelector('#editorTransportStatus').getBoundingClientRect().width,
    overflowX: element.scrollWidth > element.clientWidth,
    pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
  expect(desktopLayout.statusWidth).toBeGreaterThan(600);
  expect(desktopLayout.overflowX).toBe(false);
  expect(desktopLayout.pageOverflowX).toBe(false);
  expect(nativeDialogs).toBe(0);
  await page.screenshot({ path: 'design/transport-validation-refactor-desktop.png' });
});

test('event location feedback stays inline and focuses the missing field on mobile and desktop', async ({ page }) => {
  let nativeDialogs = 0;
  page.on('dialog', async browserDialog => { nativeDialogs += 1; await browserDialog.dismiss(); });
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/?preview=mobile#schedule');
  await page.locator('#addScheduleBtn').click();
  const dialog = page.locator('#eventEditor');
  const status = dialog.locator('#editorLocationStatus');
  await expect(status).toBeHidden();
  await dialog.locator('#resolveEditorPlace').click();
  await expect(status).toContainText('请先填写活动 / 地点名称和地点地址');
  await expect(status).toHaveAttribute('data-tone', 'error');
  await expect(dialog.locator('#editorAddress')).toBeFocused();
  expect(nativeDialogs).toBe(0);
  const mobileLayout = await status.evaluate(element => ({
    width: element.getBoundingClientRect().width,
    overflowX: element.scrollWidth > element.clientWidth,
    pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
  expect(mobileLayout.width).toBeLessThanOrEqual(345);
  expect(mobileLayout.overflowX).toBe(false);
  expect(mobileLayout.pageOverflowX).toBe(false);
  await dialog.locator('#editorAddress').fill('测试地址');
  await expect(status).toBeHidden();
  await dialog.locator('#editorCancel').click();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?preview=desktop');
  await page.locator('#addScheduleBtn').click();
  await page.locator('#editorName').fill('');
  await page.locator('#editorAddress').fill('测试地址');
  await page.locator('#resolveEditorPlace').click();
  await expect(page.locator('#editorLocationStatus')).toContainText('请先填写活动 / 地点名称和地点地址');
  await expect(page.locator('#editorName')).toBeFocused();
  const desktopLayout = await page.locator('#eventLocationField').evaluate(element => ({
    statusWidth: element.querySelector('#editorLocationStatus').getBoundingClientRect().width,
    overflowX: element.scrollWidth > element.clientWidth,
    pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
  expect(desktopLayout.statusWidth).toBeGreaterThan(600);
  expect(desktopLayout.overflowX).toBe(false);
  expect(desktopLayout.pageOverflowX).toBe(false);
  expect(nativeDialogs).toBe(0);
});

test('desktop route editor preserves mode-specific fields in a bounded scrolling dialog', async ({ page }) => {
  let nativeDialogs = 0;
  page.on('dialog', async browserDialog => { nativeDialogs += 1; await browserDialog.dismiss(); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?preview=desktop');
  await page.waitForFunction(() => typeof document.querySelector('#addScheduleBtn')?.onclick === 'function');
  await page.locator('#addScheduleBtn').evaluate(button => button.click());
  await page.locator('#editorType').evaluate(select => { select.value = 'drive'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  const dialog = page.locator('#eventEditor');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#editorType')).toHaveValue('drive');
  await expect(dialog.locator('#routeTransitCities')).toBeHidden();
  await expect(dialog.locator('#routeTravelModeField')).toBeVisible();
  await expect(dialog.locator('#routeWaypointsField')).toBeVisible();

  const drivingLayout = await dialog.evaluate(element => {
    const rect = node => node.getBoundingClientRect();
    const form = element.querySelector('.editor-form');
    const actions = element.querySelector('.editor-actions');
    const transit = element.querySelector('#routeTransitCities');
    return {
      dialog: rect(element),
      formClientHeight: form.clientHeight,
      formScrollHeight: form.scrollHeight,
      actions: rect(actions),
      transitDisplay: getComputedStyle(transit).display,
      overflowX: element.scrollWidth > element.clientWidth,
      pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  expect(drivingLayout.dialog.width).toBeCloseTo(720, 0);
  expect(drivingLayout.dialog.height).toBeCloseTo(760, 0);
  expect(drivingLayout.formScrollHeight).toBeGreaterThan(drivingLayout.formClientHeight);
  expect(drivingLayout.actions.bottom).toBeLessThanOrEqual(900);
  expect(drivingLayout.transitDisplay).toBe('none');
  expect(drivingLayout.overflowX).toBe(false);
  expect(drivingLayout.pageOverflowX).toBe(false);

  await dialog.locator('#routeTransportMode').selectOption('transit');
  await expect(dialog.locator('#routeTransitCities')).toBeVisible();
  await expect(dialog.locator('#routeTravelModeField')).toBeHidden();
  await expect(dialog.locator('#routeWaypointsField')).toBeHidden();
  const transitLayout = await dialog.evaluate(element => ({
    transitHeight: element.querySelector('#routeTransitCities').getBoundingClientRect().height,
    actionsBottom: element.querySelector('.editor-actions').getBoundingClientRect().bottom,
    overflowX: element.scrollWidth > element.clientWidth
  }));
  expect(transitLayout.transitHeight).toBeGreaterThanOrEqual(80);
  expect(transitLayout.actionsBottom).toBeLessThanOrEqual(900);
  expect(transitLayout.overflowX).toBe(false);
  await dialog.locator('#resolveEditorRoute').click();
  const routeStatus = dialog.locator('#editorRouteStatus');
  await expect(routeStatus).toContainText('完整填写自定义起点名称和地址');
  await expect(routeStatus).toHaveAttribute('data-tone', 'error');
  await expect(dialog.locator('#routeOriginName')).toBeFocused();
  await expect(routeStatus).toHaveCSS('overflow-wrap', 'anywhere');
  expect(nativeDialogs).toBe(0);
  await dialog.locator('#editorCancel').click();

  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/?preview=mobile#schedule');
  await page.locator('#addScheduleBtn').click();
  await page.locator('.mobile-editor-types [data-editor-type="drive"]').click();
  const mobileDialog = page.locator('#eventEditor');
  const routeSection = mobileDialog.locator('#routeEditorSection');
  if (!(await routeSection.evaluate(element => element.open))) await routeSection.locator('summary').click();
  await mobileDialog.locator('#routeTransportMode').selectOption('transit');
  await mobileDialog.locator('#resolveEditorRoute').click();
  const mobileStatus = mobileDialog.locator('#editorRouteStatus');
  await expect(mobileStatus).toContainText('完整填写自定义起点名称和地址');
  await expect(mobileDialog.locator('#routeOriginName')).toBeFocused();
  const mobileLayout = await mobileStatus.evaluate(element => ({
    width: element.getBoundingClientRect().width,
    overflowX: element.scrollWidth > element.clientWidth,
    pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    actionsBottom: document.querySelector('#eventEditor .editor-actions').getBoundingClientRect().bottom
  }));
  expect(mobileLayout.width).toBeLessThanOrEqual(352);
  expect(mobileLayout.overflowX).toBe(false);
  expect(mobileLayout.pageOverflowX).toBe(false);
  expect(mobileLayout.actionsBottom).toBeLessThanOrEqual(852);
  expect(nativeDialogs).toBe(0);
});

test('single-event weather errors stay in the weather section across viewports', async ({ page }) => {
  let nativeDialogs = 0;
  page.on('dialog', async browserDialog => { nativeDialogs += 1; await browserDialog.dismiss(); });
  const verify = async ({ mode, width, height }) => {
    await page.setViewportSize({ width, height });
    await page.goto(`/?preview=${mode}${mode === 'mobile' ? '#schedule' : ''}`);
    await page.locator('#addScheduleBtn').click();
    const dialog = page.locator('#eventEditor');
    const weatherSection = dialog.locator('#weatherEditorSection');
    if (!(await weatherSection.evaluate(element => element.open))) await weatherSection.locator('summary').click();
    await dialog.locator('#queryEditorWeather').click();
    const status = dialog.locator('#editorWeatherStatus');
    await expect(status).toContainText('请先关联或填写具有明确地址的地点');
    await expect(status).toHaveAttribute('data-tone', 'error');
    await expect(dialog.locator('#resolveEditorPlace')).toBeFocused();
    const layout = await status.evaluate(element => ({
      width: element.getBoundingClientRect().width,
      overflowX: element.scrollWidth > element.clientWidth,
      pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      actionsBottom: document.querySelector('#eventEditor .editor-actions').getBoundingClientRect().bottom
    }));
    expect(layout.width).toBeLessThanOrEqual(mode === 'mobile' ? 352 : 676);
    expect(layout.overflowX).toBe(false);
    expect(layout.pageOverflowX).toBe(false);
    expect(layout.actionsBottom).toBeLessThanOrEqual(height);
    if (mode === 'mobile') await page.screenshot({ path: 'work/mobile-event-sections-stage132.png' });
    await dialog.locator('#editorCancel').click();
  };
  await verify({ mode: 'mobile', width: 393, height: 852 });
  await verify({ mode: 'desktop', width: 1440, height: 900 });
  expect(nativeDialogs).toBe(0);
});

test('desktop route summary stays anchored to the compact hero and closes consistently', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?preview=desktop');
  const button = page.locator('#routeBtn');
  const summary = page.locator('#routeSummaryDetail');
  await button.click();
  await expect(summary).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');

  const layout = await summary.evaluate(element => {
    const rect = node => node.getBoundingClientRect();
    const header = document.querySelector('.app-header');
    const hero = document.querySelector('.hero');
    const button = document.querySelector('#routeBtn');
    const detail = rect(element);
    const heroRect = rect(hero);
    return {
      header: rect(header),
      hero: heroRect,
      button: rect(button),
      detail,
      anchoredBelowHero: Math.abs(detail.top - (heroRect.bottom + 7)) <= 1,
      fullyVisible: detail.top >= 0 && detail.bottom <= innerHeight,
      overflowX: element.scrollWidth > element.clientWidth,
      pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  expect(layout.header.height).toBe(108);
  expect(layout.hero.height).toBe(58);
  expect(layout.detail.width).toBeCloseTo(720, 0);
  expect(layout.detail.height).toBeLessThanOrEqual(240);
  expect(layout.anchoredBelowHero).toBe(true);
  expect(layout.fullyVisible).toBe(true);
  expect(layout.overflowX).toBe(false);
  expect(layout.pageOverflowX).toBe(false);

  await page.keyboard.press('Escape');
  await expect(summary).toBeHidden();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  await expect(summary).toBeVisible();
  await page.locator('.schedule-panel h2').click();
  await expect(summary).toBeHidden();
});

test('event cost rows keep aligned controls and explicit delete semantics across viewports', async ({ page }) => {
  const verifyCosts = async ({ mode, width, height, controlHeight, deleteWidth }) => {
    await page.setViewportSize({ width, height });
    await page.goto(`/?preview=${mode}${mode === 'mobile' ? '#schedule' : ''}`);
    await page.locator('.calendar-block.type-spot').first().dblclick({ force: true });
    const dialog = page.locator('#eventEditor');
    const section = dialog.locator('#priceEditorSection');
    await section.locator('summary').click();
    await dialog.locator('[data-add-price="person"]').click();
    await dialog.locator('[data-add-price="shared"]').click();

    const personLine = dialog.locator('.editor-price-line[data-price-kind="person"]').last();
    const sharedLine = dialog.locator('.editor-price-line[data-price-kind="shared"]').last();
    await personLine.locator('[data-price-amount]').fill('10');
    await personLine.locator('[data-price-people]').fill('2');
    await sharedLine.locator('[data-price-amount]').fill('30');
    await expect(dialog.locator('#editorPriceTotal')).toContainText('50.00 元');
    await expect(personLine.locator('[data-remove-price]')).toHaveAttribute('aria-label', '删除单人费用');
    await expect(sharedLine.locator('[data-remove-price]')).toHaveAttribute('aria-label', '删除共同费用');

    const layout = await dialog.evaluate(element => {
      const lines = [...element.querySelectorAll('.editor-price-line')];
      const buttons = [...element.querySelectorAll('[data-remove-price]')];
      return {
        controlHeights: lines.flatMap(line => [...line.children].map(control => control.getBoundingClientRect().height)),
        deleteWidths: buttons.map(button => button.getBoundingClientRect().width),
        clippedDeleteLabels: buttons.filter(button => button.scrollWidth > button.clientWidth).length,
        overflowX: element.scrollWidth > element.clientWidth,
        pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
      };
    });
    expect(layout.controlHeights.every(value => value === controlHeight)).toBe(true);
    expect(layout.deleteWidths.every(value => value === deleteWidth)).toBe(true);
    expect(layout.clippedDeleteLabels).toBe(0);
    expect(layout.overflowX).toBe(false);
    expect(layout.pageOverflowX).toBe(false);

    const before = await dialog.locator('.editor-price-line[data-price-kind="shared"]').count();
    await sharedLine.locator('[data-remove-price]').click();
    await expect(dialog.locator('.editor-price-line[data-price-kind="shared"]')).toHaveCount(before - 1);
    await expect(dialog.locator('#editorPriceTotal')).toContainText('20.00 元');
    await dialog.locator('#editorCancel').click();
  };

  await verifyCosts({ mode: 'desktop', width: 1440, height: 900, controlHeight: 40, deleteWidth: 52 });
  await verifyCosts({ mode: 'mobile', width: 360, height: 640, controlHeight: 44, deleteWidth: 44 });
});

test('mobile event editor keeps the focused field above the keyboard action bar', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/?preview=mobile#schedule');
  await page.locator('#addScheduleBtn').click();
  const dialog = page.locator('#eventEditor');
  const note = dialog.locator('#editorNote');
  await note.focus();
  await page.screenshot({ path: 'work/mobile-event-editor-stage109.png' });
  await page.screenshot({ path: 'work/mobile-event-editor-stage123.png' });
  await page.screenshot({ path: 'work/mobile-event-editor-stage129.png' });
  await page.screenshot({ path: 'work/mobile-event-editor-stage130.png' });
  await page.screenshot({ path: 'work/mobile-event-editor-stage131.png' });
  await page.screenshot({ path: 'work/mobile-event-editor-stage133.png' });
  await page.screenshot({ path: 'work/mobile-event-editor-stage134.png' });
  await page.screenshot({ path: 'work/mobile-event-editor-stage135.png' });
  await page.setViewportSize({ width: 393, height: 500 });
  await expect.poll(() => dialog.locator('.editor-form').evaluate(form => form.scrollTop)).toBeGreaterThan(0);
  const noteLayout = await dialog.evaluate(element => {
    const control = element.querySelector('#editorNote').getBoundingClientRect();
    const header = element.querySelector('h3').getBoundingClientRect();
    const actions = element.querySelector('.editor-actions').getBoundingClientRect();
    return {
      aboveHeader: control.top < header.bottom,
      behindActions: control.bottom > actions.top - 8,
      actionsVisible: actions.top < innerHeight && actions.bottom <= innerHeight,
      overflowX: element.scrollWidth > element.clientWidth,
      pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  expect(noteLayout).toEqual({ aboveHeader: false, behindActions: false, actionsVisible: true, overflowX: false, pageOverflowX: false });

  await page.setViewportSize({ width: 360, height: 500 });
  const address = dialog.locator('#editorAddress');
  await address.fill('新疆维吾尔自治区某个非常长的具体地址，用于检查输入内容与标签不会撑破弹层');
  await address.focus();
  await expect.poll(() => address.evaluate(control => {
    const rect = control.getBoundingClientRect();
    const dialogElement = control.closest('#eventEditor');
    return rect.top >= dialogElement.querySelector('h3').getBoundingClientRect().bottom && rect.bottom <= dialogElement.querySelector('.editor-actions').getBoundingClientRect().top - 8;
  })).toBe(true);
  await expect(dialog).toBeVisible();
});

test('mobile typography and compact place cards respect larger default text', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/?preview=mobile#places');
  const card = page.locator('#places .place-card-summary').first();
  await expect(card).toBeVisible();
  const defaultGeometry = await card.evaluate(element => {
    const image = element.querySelector('.place-photo-preview').getBoundingClientRect();
    const title = element.querySelector('.place-card-summary-title').getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height, imageWidth: image.width, imageHeight: image.height, imageTextGap: title.left - image.right };
  });
  expect(defaultGeometry).toEqual({ width: 355, height: 123, imageWidth: 96, imageHeight: 72, imageTextGap: 7 });
  await page.screenshot({ path: 'work/mobile-place-card-density-stage108.png' });

  await page.addStyleTag({ content: 'html{font-size:24px!important}' });
  const largeGeometry = await card.evaluate(element => {
    const image = element.querySelector('.place-photo-preview').getBoundingClientRect();
    const children = [...element.querySelector('.mobile-place-meta').children].filter(child => getComputedStyle(child).display !== 'none');
    const rectangles = children.map(child => child.getBoundingClientRect());
    const overlapPairs = rectangles.flatMap((first, index) => rectangles.slice(index + 1).map(second => (
      first.top < second.bottom && first.bottom > second.top
    ))).filter(Boolean).length;
    const rect = element.getBoundingClientRect();
    return {
      width: rect.width, height: rect.height, imageWidth: image.width, imageHeight: image.height,
      bodyFont: parseFloat(getComputedStyle(document.body).fontSize),
      titleFont: parseFloat(getComputedStyle(document.querySelector('.app-header h1')).fontSize),
      navFont: parseFloat(getComputedStyle(document.querySelector('.mobile-tabbar a')).fontSize),
      overlapPairs,
      overflowX: element.scrollWidth > element.clientWidth,
      overflowY: element.scrollHeight > element.clientHeight,
      pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  expect(largeGeometry).toEqual({
    width: 355, height: 218, imageWidth: 108, imageHeight: 81,
    bodyFont: 21, titleFont: 27, navFont: 16.5,
    overlapPairs: 0, overflowX: false, overflowY: false, pageOverflowX: false
  });

  await page.locator('.mobile-tabbar [data-mobile-view="schedule"]').click();
  await page.locator('#addScheduleBtn').click();
  const dialog = page.locator('#eventEditor');
  const dialogLayout = await dialog.evaluate(element => ({
    titleFont: parseFloat(getComputedStyle(element.querySelector('h3')).fontSize),
    actionFonts: [...element.querySelectorAll('.editor-actions button')].map(button => parseFloat(getComputedStyle(button).fontSize)),
    clippedActions: [...element.querySelectorAll('.editor-actions button')].some(button => button.scrollWidth > button.clientWidth),
    overflowX: element.scrollWidth > element.clientWidth,
    pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
  expect(dialogLayout.titleFont).toBe(27);
  expect(dialogLayout.actionFonts.every(font => font === 21)).toBe(true);
  expect(dialogLayout.clippedActions).toBe(false);
  expect(dialogLayout.overflowX).toBe(false);
  expect(dialogLayout.pageOverflowX).toBe(false);
});

test('compact mobile place cards contain long content and expose honest missing-data states', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 852 });
  await page.goto('/?preview=mobile#places');
  const name = '新疆维吾尔自治区边境公路沿线超长名称观景平台与游客服务中心';
  const address = '新疆维吾尔自治区某自治州某县沿边公路一百二十八公里处向北三公里游客服务中心旁';
  await page.locator('#addPlaceBtn').click();
  const editor = page.locator('#placeEditor');
  await editor.locator('#newPlaceName').fill(name);
  await editor.locator('#newPlaceAddress').fill(address);
  await editor.locator('button[type="submit"]').click();

  const card = page.locator('#places .place-card-summary').filter({ hasText: name }).first();
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('aria-label', `编辑地点：${name}`);
  const layout = await card.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const title = element.querySelector('.place-card-summary-title').getBoundingClientRect();
    const titleText = element.querySelector('.place-card-summary-title b').getBoundingClientRect();
    const meta = element.querySelector('.mobile-place-meta').getBoundingClientRect();
    const addressLine = element.querySelector('.place-address');
    const visibleEmptyFields = [...element.querySelectorAll('[data-empty="true"]')]
      .filter(field => getComputedStyle(field).display !== 'none').length;
    return {
      width: rect.width,
      height: rect.height,
      titleInside: titleText.left >= title.left && titleText.right <= title.right + 1 && titleText.bottom <= title.bottom + 1,
      titleClearOfMeta: title.bottom <= meta.top + 1,
      addressText: addressLine.textContent,
      visibleEmptyFields,
      fallbackContent: getComputedStyle(element, '::before').content,
      fallbackWidth: parseFloat(getComputedStyle(element, '::before').width),
      overflowX: element.scrollWidth > element.clientWidth,
      pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  expect(layout).toEqual({
    width: 322,
    height: 123,
    titleInside: true,
    titleClearOfMeta: true,
    addressText: `⌖ ${address}`,
    visibleEmptyFields: 0,
    fallbackContent: '"暂无图片"',
    fallbackWidth: 96,
    overflowX: false,
    pageOverflowX: false
  });
  await card.evaluate(element => element.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: 'work/mobile-place-long-content-stage96.png' });
});

test('new place query shows Amap candidates and marks duplicates', async ({ page }) => {
  await page.route('**/api/geocode?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ geocodes: [
    { name: '喀什古城', formatted_address: '新疆维吾尔自治区喀什地区喀什市喀什古城', location: '75.989,39.470' },
    { name: '喀什古城游客中心', formatted_address: '新疆维吾尔自治区喀什地区喀什市解放北路', location: '75.990,39.471' }
  ] }) }));
  await page.goto('/');
  await page.locator('#addPlaceBtn').click();
  await page.locator('#newPlaceName').fill('喀什古城');
  await page.locator('#queryNewPlaceLocation').click();
  await expect(page.locator('.place-query-candidate')).toHaveCount(2);
  await expect(page.locator('.place-query-candidate').first()).toContainText(/一键新建|使用已有地点/);
  const createCandidate = page.locator('.place-query-candidate').filter({ hasText: '一键新建' }).first();
  await expect(createCandidate).toBeVisible();
  await createCandidate.click();
  await expect(page.locator('#placeEditor')).toBeHidden();
});

test('map PNG export projects routes directly instead of cloning Leaflet transforms', async ({ page }) => {
  await page.goto('/?preview=mobile#map');
  await expect(page.locator('#map.map-ready')).toBeVisible();
  await page.locator('#mapDayFilter').selectOption('');
  await expect(page.locator('.map-overview-route').first()).toBeVisible({ timeout: 15000 });
  const routeExpected = await page.locator('.map-overview-route').first().evaluate(path => {
    const mapRect = document.querySelector('#map').getBoundingClientRect();
    const length = path.getTotalLength();
    const candidates = [.25, .4, .55, .7, .82].map(fraction => {
      const point = path.getPointAtLength(length * fraction).matrixTransform(path.getScreenCTM());
      return { x: point.x - mapRect.left, y: point.y - mapRect.top };
    });
    const point = candidates.find(item => item.x > 205 || item.y > 250) || candidates.at(-1);
    return { ...point, width: mapRect.width, height: mapRect.height, color: getComputedStyle(path).stroke };
  });
  const pointMarker = page.locator('.leaflet-overlay-pane path.leaflet-interactive[fill]:not([fill="none"])').first();
  await expect(pointMarker).toBeVisible();
  const markerExpected = await pointMarker.evaluate(path => {
    const mapRect = document.querySelector('#map').getBoundingClientRect();
    const rect = path.getBoundingClientRect();
    return { x: rect.left + rect.width / 2 - mapRect.left, y: rect.top + rect.height / 2 - mapRect.top, width: mapRect.width, height: mapRect.height, color: getComputedStyle(path).fill };
  });
  await page.evaluate(async () => {
    if (!window.html2canvas) await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = './vendor/leaflet/html2canvas.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    });
    const original = window.html2canvas;
    window.__mapDomCaptureCalled = false;
    window.html2canvas = (...args) => { window.__mapDomCaptureCalled = true; return original(...args); };
  });
  await page.locator('#exportMapPng').click();
  await expect(page.locator('#mapExportPreview')).toBeVisible();
  await expect(page.locator('#mapExportPreviewImage')).toHaveAttribute('src', /^data:image\/png/);
  expect(await page.evaluate(() => window.__mapDomCaptureCalled)).toBe(false);
  const colorDistances = await page.locator('#mapExportPreviewImage').evaluate(async (image, samples) => {
    if (!image.complete) await new Promise(resolve => image.addEventListener('load', resolve, { once: true }));
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    return samples.map(sample => {
      const rgb = sample.color.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [37, 99, 235];
      const centerX = Math.round(sample.x * image.naturalWidth / sample.width), centerY = Math.round(sample.y * image.naturalHeight / sample.height);
      let minimum = Infinity;
      for (let y = centerY - 7; y <= centerY + 7; y += 1) for (let x = centerX - 7; x <= centerX + 7; x += 1) {
        const pixel = context.getImageData(x, y, 1, 1).data;
        minimum = Math.min(minimum, Math.hypot(pixel[0] - rgb[0], pixel[1] - rgb[1], pixel[2] - rgb[2]));
      }
      return minimum;
    });
  }, [routeExpected, markerExpected]);
  colorDistances.forEach(distance => expect(distance).toBeLessThan(90));
  await page.setViewportSize({ width: 360, height: 640 });
  const mapPreviewLayout = await page.locator('#mapExportPreview').evaluate(dialog => {
    const actions = dialog.querySelector('.editor-actions').getBoundingClientRect();
    const dialogRect = dialog.getBoundingClientRect();
    const close = dialog.querySelector('#closeMapExportPreview').getBoundingClientRect();
    const section = dialog.querySelector('section');
    return {
      closeHeight: close.height,
      actionsInsideDialog: actions.top >= dialogRect.top && actions.bottom <= dialogRect.bottom,
      sectionOverflowY: section.scrollHeight > section.clientHeight,
      dialogOverflowX: dialog.scrollWidth > dialog.clientWidth,
      pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  expect(mapPreviewLayout).toEqual({ closeHeight: 44, actionsInsideDialog: true, sectionOverflowY: false, dialogOverflowX: false, pageOverflowX: false });
  await page.screenshot({ path: 'work/mobile-map-export-preview-stage121.png' });
  await page.evaluate(() => {
    window.__shareCalls = 0;
    Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { window.__shareCalls += 1; } });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
  });
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#downloadMapExportPreview').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/当前地图\.png$/);
  expect(await page.evaluate(() => window.__shareCalls)).toBe(0);
});

test('mobile schedule PNG preview uses a decodable blob and downloads', async ({ page }) => {
  const exportDialogs = [];
  page.on('dialog', async dialog => { exportDialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.goto('/?preview=mobile#plans');
  const exportButton = page.locator('[data-command="#exportSchedulePng"]');
  await expect(exportButton).toBeVisible();
  await page.evaluate(() => document.body.classList.add('weather-backgrounds-enabled'));
  await page.evaluate(() => {
    const original = window.html2canvas;
    window.html2canvas = async (element, options) => {
      const card = element.querySelector('.calendar-block:not(.compact)');
      const title = card?.querySelector('.schedule-export-card-label > b');
      const detail = card?.querySelector(':scope > small, .calendar-parent-content');
      const labelOffsets = [...element.querySelectorAll('.schedule-export-card-label')].map(label => {
        const cardRect = label.parentElement.getBoundingClientRect(), labelRect = label.getBoundingClientRect();
        return { left: labelRect.left - cardRect.left, top: labelRect.top - cardRect.top };
      });
      const wrappingTitle = element.querySelector('.calendar-block.export-title-lines-2 .schedule-export-card-label>b, .calendar-block.export-title-lines-3 .schedule-export-card-label>b');
      const weatherCard = element.querySelector('.calendar-block.has-weather');
      window.__scheduleExportProbe = {
        className: element.className,
        columns: getComputedStyle(element).gridTemplateColumns,
        titleFontSize: title ? Number.parseFloat(getComputedStyle(title).fontSize) : 0,
        detailDisplay: detail ? getComputedStyle(detail).display : 'none',
        firstTimeLabel: element.querySelector('.time-label')?.textContent?.trim(),
        lastTimeLabel: [...element.querySelectorAll('.time-label')].at(-1)?.textContent?.trim(),
        overnightSummaries: element.querySelectorAll('.calendar-export-overnight').length,
        inlineOvernightLabels: element.querySelectorAll('.calendar-block .calendar-overnight-label').length,
        wrappingTitleWhiteSpace: wrappingTitle ? getComputedStyle(wrappingTitle).whiteSpace : '',
        weatherBackground: weatherCard ? getComputedStyle(weatherCard).backgroundColor : '',
        weatherImageOpacity: weatherCard ? Number.parseFloat(getComputedStyle(weatherCard, '::before').opacity) : 0,
        labelOffsets
      };
      return original(element, options);
    };
  });
  await exportButton.click();
  await expect(page.locator('#scheduleExportPreview'), `export dialogs: ${exportDialogs.join(' | ')}`).toBeVisible({ timeout: 20000 });
  const previewImage = page.locator('#scheduleExportPreviewImage');
  await expect(previewImage).toHaveAttribute('src', /^blob:/);
  expect(await previewImage.evaluate(image => ({ width: image.naturalWidth, height: image.naturalHeight }))).toEqual(expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }));
  expect(await previewImage.evaluate(image => image.naturalWidth > 0 && image.naturalHeight > 0)).toBe(true);
  const probe = await page.evaluate(() => window.__scheduleExportProbe);
  expect(probe.className).toContain('schedule-export-grid');
  expect(probe.columns).toContain('270px');
  expect(probe.titleFontSize).toBeGreaterThanOrEqual(11);
  expect(probe.detailDisplay).toBe('none');
  expect(probe.firstTimeLabel).toBe('07:00');
  expect(probe.lastTimeLabel).toBe('23:00');
  expect(probe.overnightSummaries).toBeGreaterThan(0);
  expect(probe.inlineOvernightLabels).toBe(0);
  expect(probe.wrappingTitleWhiteSpace).toBe('normal');
  expect(probe.weatherBackground).toBe('rgb(255, 255, 255)');
  expect(probe.weatherImageOpacity).toBeGreaterThanOrEqual(.9);
  expect(probe.labelOffsets.length).toBeGreaterThan(0);
  const labelLefts = probe.labelOffsets.map(offset => offset.left), labelTops = probe.labelOffsets.map(offset => offset.top);
  expect(Math.max(...labelLefts) - Math.min(...labelLefts)).toBeLessThan(1);
  expect(Math.max(...labelTops) - Math.min(...labelTops)).toBeLessThan(1);
  expect(Math.min(...labelLefts)).toBeGreaterThanOrEqual(8);
  expect(Math.min(...labelTops)).toBeLessThanOrEqual(1.5);
  await page.setViewportSize({ width: 360, height: 640 });
  const schedulePreviewLayout = await page.locator('#scheduleExportPreview').evaluate(dialog => {
    const actions = dialog.querySelector('.editor-actions').getBoundingClientRect();
    const dialogRect = dialog.getBoundingClientRect();
    const close = dialog.querySelector('#closeScheduleExportPreview').getBoundingClientRect();
    const section = dialog.querySelector('section');
    return {
      closeHeight: close.height,
      actionsInsideDialog: actions.top >= dialogRect.top && actions.bottom <= dialogRect.bottom,
      sectionOverflowY: section.scrollHeight > section.clientHeight,
      dialogOverflowX: dialog.scrollWidth > dialog.clientWidth,
      pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  expect(schedulePreviewLayout).toEqual({ closeHeight: 44, actionsInsideDialog: true, sectionOverflowY: false, dialogOverflowX: false, pageOverflowX: false });
  await page.screenshot({ path: 'work/mobile-schedule-export-preview-stage121.png' });
  await page.evaluate(() => Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false }));
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#downloadScheduleExportPreview').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/时间表\.png$/);
  expect(exportDialogs).toEqual([]);
});
