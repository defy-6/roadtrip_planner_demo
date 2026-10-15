import { test, expect } from './helpers/safety-browser.mjs';
import { plannerSafetyFixture } from './fixtures/planner-safety.mjs';

for (const width of [360, 430]) {
  test(`release: login, load and navigate all four pages at ${width}px`, async ({ page, request, baseURL }) => {
    const username = `rel_${Math.random().toString(36).slice(2, 12)}`;
    const password = 'synthetic-release-password';
    expect((await request.post('/api/auth/register', { data: { username, password } })).ok()).toBe(true);
    const login = await request.post('/api/auth/login', { data: { username, password } });
    expect(login.ok()).toBe(true);
    const auth = await login.json();
    const created = await request.post('/api/trips', { headers: { Authorization: `Bearer ${auth.token}` },
      data: { name: '发布冒烟合成行程', data: plannerSafetyFixture } });
    expect(created.ok()).toBe(true);
    const { trip } = await created.json();
    const origin = baseURL.replace('127.0.0.1', '127.0.0.2');
    await page.addInitScript(({ token, id }) => {
      window.__API_BASE__ = location.origin;
      localStorage.setItem('roadtrip-token', token);
      localStorage.setItem('roadtrip-active-trip', id);
    }, { token: auth.token, id: trip._id });
    await page.setViewportSize({ width, height: 780 });
    await page.goto(`${origin}/?preview=mobile#plans`);
    await expect(page.locator('.mobile-current-plan')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('[data-plan-title]')).toHaveText('合成行程方案');
    for (const view of ['schedule', 'map', 'places', 'plans']) {
      await page.locator(`.mobile-tabbar [data-mobile-view="${view}"]`).click();
      await expect(page.locator('body')).toHaveAttribute('data-mobile-view', view);
    }
    await expect(page.locator('#fileSaveStatus')).toContainText('已同步', { timeout: 20_000 });
  });
}
