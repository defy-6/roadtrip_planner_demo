import { expect, test } from '@playwright/test';
import { auditVisibleTextContrast } from './helpers/text-contrast.js';

test('contrast audit also measures text owned by the selected root', async ({ page }) => {
  await page.setContent('<p id="rootText" style="color:#ccc;background:white">Root text</p>');
  const result = await auditVisibleTextContrast(page, '#rootText');
  expect(result.checked).toBe(1);
  expect(result.issues).toHaveLength(1);
  expect(result.issues[0].element).toBe('rootText');
});

for (const width of [360, 393, 430]) for (const view of ['schedule', 'places', 'map', 'plans']) {
  test(`mobile ${view} visible solid-background text contrast at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 852 });
    await page.goto(`/?preview=mobile#${view}`);
    await expect(page.locator('body')).toHaveAttribute('data-mobile-view', view);
    await expect(page.locator('#fileSaveStatus')).toContainText(/已从本地文件载入|已写入本地文件|已同步云端/);
    const result = await auditVisibleTextContrast(page);
    expect(result.checked).toBeGreaterThan(10);
    expect(result.issues, JSON.stringify(result, null, 2)).toEqual([]);
    await page.screenshot({ path: `design/mobile-text-contrast-${view}-${width}.png` });
    const scroller = { schedule: '.schedule-scroll', places: '#places', map: '.map-panel', plans: '.mobile-plans-panel' }[view];
    await page.locator(scroller).evaluate(element => { element.scrollTop = element.scrollHeight; });
    const end = await auditVisibleTextContrast(page);
    expect(end.checked).toBeGreaterThan(10);
    expect(end.issues, JSON.stringify(end, null, 2)).toEqual([]);
  });
}

test('contrast audit detects faint text without treating invisible text or gradients as measured text', async ({ page }) => {
  await page.setContent('<body style="background:white"><p style="color:#888">Faint text</p><p style="color:#666">Readable text</p><p style="color:transparent">Invisible label</p><p style="background-image:linear-gradient(white,black)">Gradient text</p><button disabled style="color:#aaa">Disabled</button></body>');
  const result = await auditVisibleTextContrast(page);
  expect(result.checked).toBe(2);
  expect(result.unsupported).toBe(1);
  expect(result.issues).toHaveLength(1);
  expect(result.issues[0].text).toBe('Faint text');
  expect(result.issues[0].ratio).toBeCloseTo(3.54, 2);
});

test('contrast audit scopes fields to the chosen root and checks placeholders without reading passwords', async ({ page }) => {
  await page.setContent('<style>input::placeholder{color:#888;opacity:1}</style><body style="background:white"><p style="color:#888">Outside the audit</p><section id="audit"><input style="color:#666;background:white" value="Readable"><input id="faintHint" style="background:white" placeholder="Hint"><input type="password" style="color:#888" value="Do not inspect"></section></body>');
  const result = await auditVisibleTextContrast(page, '#audit');
  expect(result.checked).toBe(2);
  expect(result.issues).toHaveLength(1);
  expect(result.issues[0].element).toBe('faintHint');
  expect(result.issues[0].text).toBe('placeholder');
  expect(JSON.stringify(result)).not.toContain('Do not inspect');
});
