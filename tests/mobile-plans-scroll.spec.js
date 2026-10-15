import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 360, height: 640 }, { width: 393, height: 852 }, { width: 430, height: 640 }]) {
  test(`mobile plans cards retain content height and scroll to the end at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/?preview=mobile#plans');
    const panel = page.locator('.mobile-plans-panel');
    await expect(panel).toBeVisible();
    await expect(page.locator('#planSelect')).not.toBeEmpty();
    const geometry = await panel.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return {
        overflowing: element.scrollHeight > element.clientHeight,
        overflowY: getComputedStyle(element).overflowY,
        left: rect.left - document.body.getBoundingClientRect().left,
        right: document.body.getBoundingClientRect().right - rect.right,
        cardsUnclipped: [...element.querySelectorAll('.mobile-action-card')]
          .every(card => card.scrollHeight <= card.clientHeight + 1),
        horizontalOverflow: element.scrollWidth > element.clientWidth
      };
    });
    expect(geometry).toEqual({ overflowing: true, overflowY: 'auto', left: 16, right: 16, cardsUnclipped: true, horizontalOverflow: false });
    await panel.hover();
    await page.mouse.wheel(0, 4000);
    await expect.poll(() => panel.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await panel.evaluate(element => { element.scrollTop = element.scrollHeight; });
    const end = await panel.evaluate(element => {
      const lastButton = element.querySelector('.mobile-action-card:last-child button:last-of-type');
      const buttonRect = lastButton.getBoundingClientRect();
      const panelRect = element.getBoundingClientRect();
      const navRect = document.querySelector('.mobile-tabbar').getBoundingClientRect();
      return { visible: buttonRect.top >= panelRect.top && buttonRect.bottom <= Math.min(panelRect.bottom, navRect.top), atEnd: Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) <= 1 };
    });
    expect(end).toEqual({ visible: true, atEnd: true });
  });
}
