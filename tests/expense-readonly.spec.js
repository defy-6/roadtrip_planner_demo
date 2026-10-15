import { expect, test } from '@playwright/test';
import { auditVisibleTextContrast } from './helpers/text-contrast.js';

for (const width of [360, 430]) {
  test(`read-only ledger keeps viewing and export but rejects mutations at ${width}px`, async ({ page }) => {
    const payload = await page.request.get('/api/planner-data').then(response => response.json());
    payload.data.versions[payload.data.activeVersion].expenses = [{ id: 'readonly-fixture', date: '2026-08-16', category: '停车', note: '只读账目', amount: 12.5 }];
    await page.addInitScript(data => { window.__ROADTRIP_SHARE_MODE__ = true; window.__ROADTRIP_SHARE_DATA__ = data; }, payload.data);
    await page.setViewportSize({ width, height: 640 });
    await page.goto('/?preview=mobile#plans', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#fileSaveStatus')).toContainText('共享只读版');
    await page.locator('[data-accounting]').click();
    const ledger = page.locator('#expenseLedger');
    await expect(ledger.locator('[data-ledger-readonly]')).toBeVisible();
    await expect(ledger.locator('[data-ledger-add]')).toBeHidden();
    await expect(ledger.locator('[data-expense-edit],[data-expense-delete]')).toHaveCount(0);
    const total = await ledger.locator('[data-ledger-total]').textContent();
    const rows = await ledger.locator('.expense-row').count();
    await ledger.locator('[data-ledger-add]').dispatchEvent('click');
    await expect(ledger.locator('[data-ledger-form]')).toBeHidden();
    await ledger.evaluate(dialog => {
      for (const [attribute, value] of [['data-expense-edit', 'event-0'], ['data-expense-delete', 'readonly-fixture']]) {
        const button = document.createElement('button');
        button.setAttribute(attribute, value);
        dialog.append(button);
        button.click();
        button.remove();
      }
      const form = dialog.querySelector('[data-ledger-form]');
      form.querySelector('[data-expense-note]').value = '不应保存';
      form.querySelector('[data-expense-amount]').value = '999';
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await expect(page.locator('#eventEditor')).toBeHidden();
    await expect(ledger.locator('[data-ledger-total]')).toHaveText(total);
    await expect(ledger.locator('.expense-row')).toHaveCount(rows);
    await expect(ledger).toContainText('只读账目');
    const contrast = await auditVisibleTextContrast(page, '#expenseLedger');
    expect(contrast.issues).toEqual([]);
    expect(await ledger.evaluate(dialog => dialog.scrollWidth > dialog.clientWidth)).toBe(false);
    await page.screenshot({ path: `design/expense-readonly-${width}.png` });
    const download = page.waitForEvent('download');
    await ledger.locator('[data-ledger-export]').click();
    expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
    await ledger.locator('[data-ledger-close]').click();
    await expect(ledger).toBeHidden();
  });
}

test('expense submission rechecks the current edit gate after its form has opened', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/?preview=mobile#plans', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#fileSaveStatus')).toContainText(/已从本地文件载入|已写入本地文件|已同步云端/);
  await page.locator('[data-accounting]').click();
  const ledger = page.locator('#expenseLedger');
  const before = await ledger.locator('[data-ledger-total]').textContent();
  const count = await ledger.locator('.expense-row').count();
  await ledger.locator('[data-ledger-add]').click();
  await ledger.locator('[data-expense-note]').fill('禁止提交的账目');
  await ledger.locator('[data-expense-amount]').fill('99');
  await page.locator('#addScheduleBtn').evaluate(button => { button.disabled = true; });
  await ledger.locator('[data-ledger-form]').dispatchEvent('submit');
  await expect(ledger.locator('[data-ledger-form]')).toBeHidden();
  await expect(ledger.locator('[data-ledger-readonly]')).toBeVisible();
  await expect(ledger.locator('[data-ledger-total]')).toHaveText(before);
  await expect(ledger.locator('.expense-row')).toHaveCount(count);
  await expect(ledger.locator('[data-ledger-close]')).toBeFocused();
});
