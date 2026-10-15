import { expect, test } from '@playwright/test';
import { auditVisibleTextContrast } from './helpers/text-contrast.js';

for (const width of [360, 430]) {
  test(`expense create and edit preserve totals and return focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 640 });
    await page.goto('/?preview=mobile#plans', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#fileSaveStatus')).toContainText(/已从本地文件载入|已写入本地文件|已同步云端/);
    await page.locator('[data-accounting]').click();
    const ledger = page.locator('#expenseLedger');
    const add = ledger.locator('[data-ledger-add]');
    const total = ledger.locator('[data-ledger-total]');
    const before = Number((await total.textContent()).replace(/[^\d.-]/g, ''));
    await add.click();
    const note = `焦点验证账目 ${width}`;
    await ledger.locator('[data-expense-note]').fill(note);
    await ledger.locator('[data-expense-amount]').fill('12.50');
    await ledger.locator('[data-ledger-form] button[type="submit"]').click();
    await expect(ledger.locator('[data-ledger-form]')).toBeHidden();
    await expect(add).toBeFocused();
    await expect(total).toHaveText(`¥${(before + 12.5).toFixed(2)}`);
    const row = ledger.locator('.expense-row', { hasText: note });
    const edit = row.locator('[data-expense-edit]');
    await edit.click();
    await expect(ledger.locator('[data-expense-amount]')).toHaveValue('12.5');
    await ledger.locator('[data-ledger-cancel]').click();
    await expect(edit).toBeFocused();
    await edit.click();
    await ledger.locator('[data-expense-amount]').fill('13.50');
    await ledger.locator('[data-ledger-form] button[type="submit"]').click();
    await expect(add).toBeFocused();
    await expect(row.locator('strong')).toHaveText('¥13.50');
    await expect(total).toHaveText(`¥${(before + 13.5).toFixed(2)}`);
  });
}

test('expense ledger empty state remains readable and closing is reachable on a short screen', async ({ page }) => {
  const payload = await page.request.get('/api/planner-data').then(response => response.json());
  const plan = payload.data.versions[payload.data.activeVersion];
  plan.schedule = [];
  plan.expenses = [];
  await page.addInitScript(data => { window.__ROADTRIP_SHARE_MODE__ = true; window.__ROADTRIP_SHARE_DATA__ = data; }, payload.data);
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/?preview=mobile#plans', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#fileSaveStatus')).toContainText('共享只读版');
  await page.locator('[data-accounting]').click();
  const ledger = page.locator('#expenseLedger');
  await expect(ledger.locator('[data-ledger-total]')).toHaveText('¥0.00');
  await expect(ledger.locator('.expense-empty')).toBeVisible();
  const result = await auditVisibleTextContrast(page, '#expenseLedger');
  expect(result.issues).toEqual([]);
  const close = ledger.locator('[data-ledger-close]');
  expect(await close.evaluate(button => button.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
  await page.screenshot({ path: 'design/expense-empty-short.png' });
  await close.click();
  await expect(ledger).toBeHidden();
});
