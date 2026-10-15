import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlannerInitializer } from '../public/features/runtime/initializer.js';

function fixture(overrides = {}) {
  const calls = [];
  const status = { textContent: '', dataset: {} };
  const state = { versionKey: 'plan-a', plans: [{ id: 'plan-a' }], schedule: [] };
  let revision = '';
  const persistence = {
    editable: true,
    enableAutoSave: () => calls.push('autosave'),
    disableAutoSave: () => calls.push('autosave-off'),
    flushOfflineQueue: () => calls.push('flush'),
    setOnFileSaved: callback => { persistence.onSaved = callback; }
  };
  const dependencies = {
    state,
    api: { getPlannerData: async () => { throw new Error('offline'); } },
    persistence,
    plannerCache: null,
    activeTripId: 'trip-a',
    isShareMode: false,
    shareData: null,
    defaultPlanId: 'plan-a',
    statusNode: () => status,
    setPlanCatalog: value => calls.push(['catalog', value]),
    loadFileContainer: data => data,
    load: (snapshot, key) => { calls.push(['load', snapshot, key]); state.schedule = snapshot.schedule || []; },
    loadPreset: key => calls.push(['preset', key]),
    save: () => calls.push('save'),
    renderSchedule: schedule => calls.push(['schedule', schedule]),
    renderManualSchedule: () => calls.push('manual'),
    ensureMapReady: async () => { calls.push('map'); return true; },
    renderRouteTotals: () => calls.push('totals'),
    fileSavePayload: () => ({ payload: true }),
    getFileRevision: () => revision,
    setFileRevision: value => { revision = value; },
    getPreviewMode: () => 'mobile',
    ...overrides
  };
  return { calls, status, state, persistence, dependencies, getRevision: () => revision };
}

test('planner initializer renders an approved cache but pauses saving when cloud loading fails', async () => {
  const cached = { updatedAt: '2026-09-24T10:00:00Z', versions: { 'plan-a': { planKey: 'plan-a', schedule: [{ id: 1 }] } } };
  const context = fixture({ plannerCache: { read: async () => cached, write: async () => {} } });
  const result = await createPlannerInitializer(context.dependencies)();
  assert.deepEqual(result, { dataStatus: 'offline' });

  assert.match(context.status.textContent, /读取失败/);
  assert.equal(context.status.dataset.tone, 'warning');
  assert.equal(context.getRevision(), cached.updatedAt);
  assert.deepEqual(context.state.schedule, [{ id: 1 }]);
  assert.equal(context.calls.filter(call => Array.isArray(call) && call[0] === 'schedule').length, 1);
  assert.equal(context.calls.includes('map'), false, 'mobile startup keeps map lazy');
  assert.equal(context.calls.includes('autosave'), false, '读取失败时不得启用自动保存');
  assert.equal(context.calls.includes('flush'), false, '读取失败时不得刷新离线写入队列');
  assert.equal(context.calls.includes('save'), false, '读取失败时不得写入缓存快照');
});

test('a response for another trip cannot initialize or save the current trip', async () => {
  const context = fixture({ api: { getPlannerData: async () => ({ trip: { _id: 'foreign' },
    data: { versions: { 'plan-a': { schedule: [{ id: 'foreign' }] } } } }) } });
  await createPlannerInitializer(context.dependencies)();
  assert.equal(context.calls.includes('autosave'), false);
  assert.equal(context.calls.includes('save'), false);
  assert.equal(context.calls.some(call => Array.isArray(call) && call[0] === 'load'), false);
});

test('desktop map initialization cannot block a failed-read result or its write gate', async () => {
  const context = fixture({ getPreviewMode: () => 'desktop', ensureMapReady: () => new Promise(() => {}) });
  const result = await createPlannerInitializer(context.dependencies)();
  assert.equal(result.dataStatus, 'preset');
  assert.match(context.status.textContent, /读取失败/);
  assert.equal(context.calls.includes('autosave'), false);
  assert.equal(context.calls.includes('save'), false);
});

test('share initialization uses supplied data without cloud requests', async () => {
  let apiCalls = 0;
  const shared = { savedAt: '2026-09-24T10:00:00Z', versions: { 'plan-a': { planKey: 'plan-a', schedule: [] } } };
  const context = fixture({
    isShareMode: true,
    shareData: shared,
    api: { getPlannerData: async () => { apiCalls += 1; return { data: null }; } }
  });
  const result = await createPlannerInitializer(context.dependencies)();
  assert.deepEqual(result, { dataStatus: 'ready' });

  assert.equal(apiCalls, 0);
  assert.match(context.status.textContent, /^共享只读版/);
  assert.equal(context.calls.filter(call => call === 'save').length, 1, '沿用会话层的只读 save 防护');
  assert.equal(context.calls.some(call => Array.isArray(call) && call[0] === 'load'), true);
});

test('failed loading without cache reports preset fallback but never saves preset data', async () => {
  const context = fixture();
  const result = await createPlannerInitializer(context.dependencies)();
  assert.deepEqual(result, { dataStatus: 'preset' });
  assert.deepEqual(context.calls.find(call => Array.isArray(call) && call[0] === 'preset'), ['preset', 'plan-a']);
  assert.match(context.status.textContent, /读取失败/);
  assert.equal(context.calls.includes('autosave'), false, '读取失败时不得启用自动保存');
  assert.equal(context.calls.includes('flush'), false, '读取失败时不得刷新离线写入队列');
  assert.equal(context.calls.includes('save'), false, '读取失败时不得把预设/空数据写入保存流程');
});

test('a successful read that yields no usable snapshot still pauses saving', async () => {
  const context = fixture({ api: { getPlannerData: async () => ({ data: null }) } });
  const result = await createPlannerInitializer(context.dependencies)();
  assert.deepEqual(result, { dataStatus: 'preset' });
  assert.match(context.status.textContent, /读取失败/);
  assert.equal(context.calls.includes('save'), false, '空容器不得进入保存流程');
  assert.equal(context.calls.includes('autosave'), false);
  assert.equal(context.calls.includes('flush'), false);
});

test('retrying after a failed read restores normal saving once the read succeeds', async () => {
  let failing = true;
  const fresh = { updatedAt: '2026-09-25T10:00:00Z', versions: { 'plan-a': { planKey: 'plan-a', schedule: [{ id: 2 }] } } };
  const context = fixture({
    api: { getPlannerData: async () => { if (failing) throw new Error('offline'); return { data: fresh }; } }
  });
  const initializePlanner = createPlannerInitializer(context.dependencies);

  const first = await initializePlanner();
  assert.deepEqual(first, { dataStatus: 'preset' });
  assert.equal(context.calls.includes('save'), false, '失败的首轮不得保存');

  failing = false;
  const second = await initializePlanner();
  assert.deepEqual(second, { dataStatus: 'ready' });
  assert.equal(context.getRevision(), fresh.updatedAt);
  assert.equal(context.calls.includes('autosave'), true, '成功读取后恢复自动保存');
  assert.equal(context.calls.includes('flush'), true, '成功读取后可刷新待同步修改');
  assert.equal(context.calls.includes('save'), true, '成功读取后恢复保存');
});

for (const fresh of [null, {}, { versions: {} }, { versions: { 'plan-a': { schedule: 'invalid' } } }]) {
  test(`cached data cannot verify an unusable fresh response: ${JSON.stringify(fresh)}`, async () => {
    const snapshot = { versions: { 'plan-a': { schedule: [{ title: 'cached' }] } } };
    let cacheWrites = 0;
    const context = fixture({
      plannerCache: { read: async () => snapshot, write: async () => cacheWrites++ },
      api: { getPlannerData: async () => ({ data: fresh }) }
    });
    assert.deepEqual(await createPlannerInitializer(context.dependencies)(), { dataStatus: 'offline' });
    assert.equal(cacheWrites, 0);
    assert.deepEqual(context.state.schedule, [{ title: 'cached' }]);
    assert.equal(context.calls.includes('autosave'), false);
    assert.equal(context.calls.includes('flush'), false);
  });
}

test('initialization suspends writes before loading a cache or waiting for the network', async () => {
  const context = fixture();
  let enabled = true;
  context.persistence.disableAutoSave = () => { enabled = false; context.calls.push('autosave-off'); };
  context.dependencies.plannerCache = { read: async () => {
    assert.equal(enabled, false);
    return { versions: { 'plan-a': { schedule: [] } } };
  } };
  context.dependencies.load = () => assert.equal(enabled, false, 'load() itself may invoke save()');
  await createPlannerInitializer(context.dependencies)();
  assert.equal(context.calls[0], 'autosave-off');
});

test('cancelled retry retains unsaved edits without reading or replacing the state', async () => {
  let reads = 0;
  let confirmations = 0;
  const draft = { title: 'original' };
  const context = fixture({
    api: { getPlannerData: async () => { reads++; throw Error('offline'); } },
    getDraftSnapshot: () => draft,
    confirmDiscardDraft: async () => { confirmations++; return false; }
  });
  const initialize = createPlannerInitializer(context.dependencies);
  await initialize();
  draft.title = 'unsaved edit';
  assert.deepEqual(await initialize(), { dataStatus: 'draft' });
  assert.equal(draft.title, 'unsaved edit');
  assert.equal(reads, 1);
  assert.equal(confirmations, 1);
  assert.equal(context.calls.filter(call => Array.isArray(call) && call[0] === 'preset').length, 1);
});

test('approved retry never discards the draft if the fresh read still fails', async () => {
  const draft = { title: 'original' };
  const context = fixture({ getDraftSnapshot: () => draft, confirmDiscardDraft: async () => true });
  const initialize = createPlannerInitializer(context.dependencies);
  await initialize();
  draft.title = 'unsaved edit';
  assert.deepEqual(await initialize(), { dataStatus: 'preset' });
  assert.equal(draft.title, 'unsaved edit');
  assert.equal(context.calls.filter(call => Array.isArray(call) && call[0] === 'preset').length, 1);
});

test('editing while a retry is awaiting the response aborts replacement', async () => {
  let release;
  let reads = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const draft = { title: 'original' };
  const context = fixture({
    getDraftSnapshot: () => draft,
    api: { getPlannerData: async () => {
      if (++reads === 1) throw Error('offline');
      await gate;
      return { data: { versions: { 'plan-a': { schedule: [] } } } };
    } }
  });
  const initialize = createPlannerInitializer(context.dependencies);
  await initialize();
  const retry = initialize();
  await Promise.resolve();
  draft.title = 'edit during retry';
  release();
  assert.deepEqual(await retry, { dataStatus: 'draft' });
  assert.equal(context.calls.some(call => Array.isArray(call) && call[0] === 'load'), false);
  assert.equal(context.calls.includes('autosave'), false);
});

test('a slow cache write cannot make retry overwrite edits made after loading the response', async () => {
  let reads = 0, release, writing;
  const gate = new Promise(resolve => { release = resolve; });
  const writingGate = new Promise(resolve => { writing = resolve; });
  const draft = { title: 'original' };
  const context = fixture({
    getDraftSnapshot: () => draft,
    api: { getPlannerData: async () => {
      if (++reads === 1) throw Error('offline');
      return { data: { versions: { 'plan-a': { schedule: [] } } } };
    } },
    plannerCache: { read: async () => null, write: async () => { writing(); await gate; } },
    load: () => { draft.title = 'remote title'; }
  });
  const initialize = createPlannerInitializer(context.dependencies);
  await initialize();
  const retry = initialize();
  await writingGate;
  draft.title = 'edit during cache write';
  release();
  await retry;
  assert.equal(draft.title, 'edit during cache write');
});
