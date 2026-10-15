import { test, expect } from './helpers/safety-browser.mjs';
import { readFile } from 'node:fs/promises';
import { plannerSafetyFixture } from './fixtures/planner-safety.mjs';

test('pending conflict can be exported, cancelled and explicitly discarded without uploading stale data', async ({ page, request, baseURL, browserName }) => {
  test.setTimeout(90_000);
  const scriptErrors = [];
  page.on('pageerror', error => scriptErrors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['127.0.0.1', '127.0.0.2'].includes(url.hostname) ? route.continue() : route.abort();
  });
  const username = `safe_${Math.random().toString(36).slice(2, 10)}`;
  const registered = await request.post('/api/auth/register', { data: { username, password: 'synthetic-password' } });
  expect(registered.status()).toBe(200);
  const auth = await registered.json();
  const created = await request.post('/api/trips', { headers: { Authorization: `Bearer ${auth.token}` },
    data: { name: '合成待同步验收', data: plannerSafetyFixture } });
  expect(created.status()).toBe(200);
  const { trip } = await created.json();
  // Cloud-like UI mode on another LOOPBACK address. Never contact the formal cloud.
  const origin = baseURL.replace('127.0.0.1', '127.0.0.2');
  await page.goto(`${origin}/api/preview-mode`);
  const pending = structuredClone(plannerSafetyFixture);
  pending.baseUpdatedAt = '2000-01-01T00:00:00.000Z';
  pending.versions.dated.schedule[0].title = '待同步的本地午餐';
  await page.evaluate(async ({ username, id, pending }) => {
    const { createPlannerCache } = await import('/storage/planner-cache.js');
    await createPlannerCache({ scope: username }).writePending(id, pending);
  }, { username, id: trip._id, pending });
  await page.addInitScript(({ token, id }) => {
    window.__API_BASE__ = location.origin;
    localStorage.setItem('roadtrip-token', token);
    localStorage.setItem('roadtrip-active-trip', id);
  }, { token: auth.token, id: trip._id });
  await page.setViewportSize({ width: 430, height: 780 });
  await page.goto(`${origin}/?preview=mobile#plans`);
  // Real login + cache transactions may take longer than a mocked 5-second assertion.
  await expect(page.locator('[data-plan-load-status]')).toContainText('版本冲突', { timeout: 20_000 });
  const exportButton = page.locator('[data-pending-action="export"]');
  const discardButton = page.locator('[data-pending-action="discard"]');
  await expect(exportButton).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await exportButton.click();
  const downloaded = await downloadPromise;
  const backup = JSON.parse(await readFile(await downloaded.path(), 'utf8'));
  expect(backup.data.versions.dated.schedule[0].title).toBe('待同步的本地午餐');
  await page.screenshot({ path: `design/${browserName}-s1-pending-conflict-430.png` });
  await page.evaluate(() => {
    window.__pendingEvents = [];
    window.addEventListener('planner:pendingdiscard', () => window.__pendingEvents.push('discard'));
    document.addEventListener('click', event => window.__pendingEvents.push(event.target.dataset.pendingAction || event.target.tagName), true);
  });
  await discardButton.click();
  const confirmation = page.locator('.action-confirm-dialog');
  try { await expect(confirmation).toBeVisible({ timeout: 15_000 }); }
  catch (error) {
    const diagnostic = await page.evaluate(async ({ username, id }) => {
      const { createPlannerCache } = await import('/storage/planner-cache.js');
      return { events: window.__pendingEvents, pending: Boolean(await createPlannerCache({ scope: username }).readPending(id)),
        open: document.querySelector('.action-confirm-dialog').open, focused: document.hasFocus() };
    }, { username, id: trip._id });
    throw new Error(`${error.message}\n${JSON.stringify({ diagnostic, scriptErrors })}`);
  }
  await expect(confirmation).toContainText('只清除本地待同步队列', { timeout: 15_000 });
  await confirmation.locator('[data-confirm-cancel]').click();
  await expect(confirmation).toBeHidden();
  await expect(exportButton).toBeVisible();
  await discardButton.click();
  await expect(confirmation).toBeVisible();
  await confirmation.locator('[data-confirm-submit]').click();
  await expect(page.locator('[data-plan-load-status]')).toBeHidden({ timeout: 20_000 });
  await expect(exportButton).toBeHidden();
  await expect(page.locator('#fileSaveStatus')).toContainText('已同步', { timeout: 15_000 });
  const current = await request.get(`/api/trips/${trip._id}/schedule`, { headers: { Authorization: `Bearer ${auth.token}` } });
  expect((await current.json()).schedule[0].title).toBe('合成午餐');
  expect(scriptErrors).toEqual([]);
});

test('IndexedDB reports transaction abort and never clears a newer pending payload', async ({ page }) => {
  await page.goto('/api/preview-mode');
  const result = await page.evaluate(async () => {
    const { createPlannerCache } = await import('/storage/planner-cache.js');
    const cache = createPlannerCache({ scope: 'synthetic-transaction' });
    await cache.writePending('t', { value: 'old' });
    await cache.writePending('t', { value: 'new' });
    const oldCleared = await cache.clearPending('t', { value: 'old' });
    const kept = await cache.readPending('t');
    const newCleared = await cache.clearPending('t', { value: 'new' });
    const indexedDb = { open(...args) {
      const request = indexedDB.open(...args);
      request.addEventListener('success', () => {
        const db = request.result;
        const transaction = db.transaction.bind(db);
        db.transaction = (...transactionArgs) => {
          const tx = transaction(...transactionArgs);
          if (transactionArgs[1] === 'readwrite') {
            const objectStore = tx.objectStore.bind(tx);
            tx.objectStore = (...storeArgs) => {
              const store = objectStore(...storeArgs);
              const put = store.put.bind(store);
              store.put = (...putArgs) => { const written = put(...putArgs); written.addEventListener('success', () => tx.abort()); return written; };
              return store;
            };
          }
          return tx;
        };
      });
      return request;
    } };
    const abortingCache = createPlannerCache({ indexedDb, scope: 'synthetic-abort' });
    const aborted = await abortingCache.writePending('aborted', { value: 'not committed' });
    return { oldCleared, kept, newCleared, aborted };
  });
  expect(result).toEqual({ oldCleared: false, kept: { value: 'new' }, newCleared: true, aborted: null });
});
