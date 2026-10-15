import { expect, test } from '@playwright/test';

for (const width of [360, 430]) {
  test(`expense deletion confirms the exact record and restores focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 640 });
    await page.goto('/?preview=mobile#plans', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#fileSaveStatus')).toContainText(/已从本地文件载入|已写入本地文件|已同步云端/);
    await page.locator('[data-accounting]').click();
    const ledger = page.locator('#expenseLedger');
    const add = ledger.locator('[data-ledger-add]');
    const before = await ledger.locator('[data-ledger-total]').textContent();
    const note = `临时删除测试 ${width} <安全文本>`;
    await add.click();
    await ledger.locator('[data-expense-note]').fill(note);
    await ledger.locator('[data-expense-amount]').fill('12.50');
    await ledger.locator('[data-ledger-form] button[type="submit"]').click();
    const row = ledger.locator('.expense-row', { hasText: note });
    const remove = row.locator('[data-expense-delete]');
    const total = await ledger.locator('[data-ledger-total]').textContent();
    await remove.click();
    const confirmation = page.locator('.action-confirm-dialog');
    await expect(confirmation).toHaveAccessibleName('删除账目');
    await expect(confirmation.locator('#actionConfirmMessage')).toContainText(note);
    await expect(confirmation.locator('#actionConfirmMessage')).toContainText('¥12.50');
    await expect(confirmation.locator('[data-confirm-cancel]')).toBeFocused();
    await page.screenshot({ path: `design/expense-delete-confirm-${width}.png` });
    await confirmation.locator('[data-confirm-cancel]').click();
    await expect(remove).toBeFocused();
    await expect(ledger.locator('[data-ledger-total]')).toHaveText(total);
    await remove.click();
    await page.keyboard.press('Escape');
    await expect(remove).toBeFocused();
    await expect(row).toHaveCount(1);
    await remove.click();
    await page.locator('#addScheduleBtn').evaluate(button => { button.disabled = true; });
    await confirmation.locator('[data-confirm-submit]').click();
    await expect(row).toHaveCount(1);
    await expect(ledger.locator('[data-ledger-total]')).toHaveText(total);
    await expect(ledger.locator('[data-ledger-close]')).toBeFocused();
    await page.locator('#addScheduleBtn').evaluate(button => { button.disabled = false; });
    await ledger.locator('[data-ledger-close]').click();
    await page.locator('[data-accounting]').click();
    await remove.click();
    await confirmation.locator('[data-confirm-submit]').click();
    await expect(row).toHaveCount(0);
    await expect(ledger.locator('[data-ledger-total]')).toHaveText(before);
    await expect(add).toBeFocused();
  });
}
