import { expect, test } from '@playwright/test';

for (const width of [360, 393, 430]) {
  test(`expense ledger distinguishes trip and plan with long names at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 640 });
    await page.goto('/?preview=mobile#plans', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#fileSaveStatus')).toContainText(/已从本地文件载入|已写入本地文件|已同步云端/);
    const names = { trip: `旅行${'LongTrip'.repeat(9)}`, plan: `方案${'LongPlan'.repeat(9)}` };
    await page.evaluate(names => {
      document.querySelector('#tripName').value = names.trip;
      document.querySelector('#planSelect').selectedOptions[0].textContent = names.plan;
    }, names);
    await page.locator('[data-accounting]').click();
    const ledger = page.locator('#expenseLedger');
    await expect(ledger).toHaveAccessibleName('每日开销');
    await expect(ledger).toHaveAccessibleDescription(`所属行程：${names.trip} 当前方案：${names.plan}`);
    await expect(ledger.locator('.expense-ledger-toolbar small')).toHaveText('当前方案总开销');
    expect(await ledger.evaluate(dialog => dialog.scrollWidth > dialog.clientWidth)).toBe(false);
    const context = ledger.locator('#expenseLedgerContext');
    expect(await context.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
    await page.screenshot({ path: `design/expense-context-${width}.png` });
    await ledger.locator('[data-ledger-close]').click();
    await page.evaluate(() => {
      document.querySelector('#tripName').value = '';
      document.querySelector('#planSelect').selectedOptions[0].textContent = '';
    });
    await page.locator('[data-accounting]').click();
    await expect(context).toBeHidden();
  });
}
