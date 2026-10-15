// S1 工作包 A：待同步队列与离线修改保护（合成数据，真实 persistence + initializer）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlannerInitializer } from '../public/features/runtime/initializer.js';
import { createPersistence } from '../public/storage/persistence.js';

const REV_LOCAL = '2026-10-14T02:00:00.000Z';
const REV_OLD = '2026-10-13T02:00:00.000Z';

function snapshot(id) {
  return { activeVersion: 'plan-a', versions: { 'plan-a': { planKey: 'plan-a', schedule: [{ id }] } } };
}

// 合成环境：远端容器固定为 remoteId，待同步队列预先放入 pending（可选）。
// queue 可注入外部队列，用于模拟"刷新后同一本地队列"或"按行程分键"的场景。
function harness({ remoteId = 'remote', remoteRevision = REV_LOCAL, pending = null, saveImpl, queue: injectedQueue } = {}) {
  let revision = '';
  let remoteRevisionValue = remoteRevision;
  const state = { versionKey: 'plan-a', plans: [{ id: 'plan-a' }], schedule: [], locations: [] };
  const statuses = [];
  const savedPayloads = [];
  const queue = injectedQueue || {
    store: pending ? structuredClone(pending) : null,
    async writePending(_tripId, payload) { this.store = structuredClone(payload); },
    async readPending() { return this.store ? structuredClone(this.store) : null; },
    async clearPending() { this.store = null; }
  };
  if (injectedQueue && pending) injectedQueue.store = structuredClone(pending);
  const api = {
    getPlannerData: async () => ({ data: { ...snapshot(remoteId), updatedAt: remoteRevisionValue } }),
    getRemoteRevision: () => remoteRevisionValue,
    getActiveTripId: () => 'trip-a',
    savePlannerData: async payload => {
      savedPayloads.push(structuredClone(payload));
      if (saveImpl) return saveImpl(payload);
      return { savedAt: remoteRevisionValue, updatedAt: remoteRevisionValue };
    }
  };
  const persistence = createPersistence({
    runtime: { editable: true, shareMode: false },
    api,
    onSaveStatus: (message, tone) => statuses.push({ message, tone })
  });
  persistence.setOfflineQueue(queue, 'trip-a');

  const firstScheduleId = payload => payload?.versions?.[Object.keys(payload.versions)[0]]?.schedule?.[0]?.id;
  const fileSavePayload = () => ({
    ...snapshot(state.schedule[0]?.id ?? 'empty'),
    baseUpdatedAt: revision,
    updatedAt: new Date().toISOString()
  });
  const deps = {
    state,
    api,
    persistence,
    plannerCache: null,
    activeTripId: 'trip-a',
    isShareMode: false,
    shareData: null,
    defaultPlanId: 'plan-a',
    statusNode: () => ({ textContent: '', dataset: {} }),
    setPlanCatalog: () => {},
    loadFileContainer: data => data,
    load: snapshotValue => { state.schedule = structuredClone(snapshotValue?.schedule || []); },
    loadPreset: () => { state.schedule = [{ id: 'preset' }]; },
    save: () => { persistence.queueFileSave(fileSavePayload, 0); },
    renderSchedule: () => {},
    renderManualSchedule: () => {},
    ensureMapReady: async () => true,
    renderRouteTotals: () => {},
    fileSavePayload,
    getFileRevision: () => revision,
    setFileRevision: value => { revision = value; },
    getPreviewMode: () => 'mobile',
    getDraftSnapshot: fileSavePayload
  };
  return { deps, queue, persistence, savedPayloads, statuses, state, firstScheduleId, lastStatus: () => statuses.at(-1) };
}

test('A1 初始化成功时，未同步的本地修改先安全重放，且不被本次快照覆盖', async () => {
  const h = harness({ pending: { ...snapshot('local-edit'), baseUpdatedAt: REV_LOCAL } });
  await createPlannerInitializer(h.deps)();
  await new Promise(resolve => setTimeout(resolve, 60));

  assert.equal(h.queue.store, null, '安全重放成功后队列应清除');
  assert.ok(h.savedPayloads.length >= 1, '应发生一次云端写入');
  assert.equal(
    h.firstScheduleId(h.savedPayloads.at(-1)),
    'local-edit',
    '最后一次云端写入必须是未同步的本地修改，不能被刚读取的快照覆盖'
  );
});

test('A2 待同步快照的基线与云端版本不一致时提示冲突，不自动覆盖任一方', async () => {
  const h = harness({ pending: { ...snapshot('local-edit'), baseUpdatedAt: REV_OLD } });
  await createPlannerInitializer(h.deps)();
  await new Promise(resolve => setTimeout(resolve, 60));

  assert.equal(h.savedPayloads.length, 0, '冲突时不得向云端写入任何一方的数据');
  assert.ok(h.queue.store, '冲突时必须保留待同步数据');
  assert.equal(h.firstScheduleId(h.queue.store), 'local-edit');
  assert.equal(h.lastStatus().tone, 'error');
  assert.match(h.lastStatus().message, /保留/);
});

test('A3 重放失败时保留待同步数据，且不用本次快照覆盖', async () => {
  const h = harness({
    pending: { ...snapshot('local-edit'), baseUpdatedAt: REV_LOCAL },
    saveImpl: () => { throw new TypeError('Failed to fetch'); }
  });
  await createPlannerInitializer(h.deps)();
  await new Promise(resolve => setTimeout(resolve, 60));

  assert.ok(h.queue.store, '写入失败时队列不得提前清空');
  assert.equal(h.firstScheduleId(h.queue.store), 'local-edit');
  assert.equal(h.firstScheduleId(h.savedPayloads.at(-1)), 'local-edit', '不得用本次读取的快照覆盖未同步修改');
});

test('A4 无待同步数据时保持原有初始化保存行为', async () => {
  const h = harness();
  await createPlannerInitializer(h.deps)();
  await new Promise(resolve => setTimeout(resolve, 60));

  assert.ok(h.savedPayloads.length >= 1, '无待同步数据时应正常保存本次读取结果');
  assert.equal(h.firstScheduleId(h.savedPayloads.at(-1)), 'remote');
  assert.equal(h.queue.store, null);
});

test('A5 队列读取到冲突载荷时不发送也不清除（persistence 层）', async () => {
  const statuses = [];
  let pending = { value: 'stale', baseUpdatedAt: REV_OLD };
  const persistence = createPersistence({
    runtime: { editable: true, shareMode: false },
    api: {
      getRemoteRevision: () => REV_LOCAL,
      async savePlannerData() { throw new Error('不应被调用'); }
    },
    onSaveStatus: (message, tone) => statuses.push({ message, tone })
  });
  persistence.setOfflineQueue({
    async readPending() { return pending; },
    async clearPending() { pending = null; }
  }, 'trip-a');
  persistence.enableAutoSave();

  assert.equal(await persistence.flushOfflineQueue(), false);
  assert.ok(pending, '冲突时不得清除待同步数据');
  assert.equal(statuses.at(-1).tone, 'error');
});

test('A6 断网编辑后刷新再联网：待同步修改被安全重放，不被快照覆盖', async () => {
  // 同一份本地队列跨"刷新"复用，模拟 IndexedDB 中已持久化的待同步数据。
  const sharedQueue = {
    store: null,
    async writePending(_tripId, payload) { this.store = structuredClone(payload); },
    async readPending() { return this.store ? structuredClone(this.store) : null; },
    async clearPending() { this.store = null; }
  };

  // 第一段：断网时保存失败，修改只进入待同步队列（不得丢失）。
  const beforeReload = harness({
    remoteRevision: REV_LOCAL,
    queue: sharedQueue,
    saveImpl: () => { throw new TypeError('Failed to fetch'); }
  });
  beforeReload.persistence.enableAutoSave();
  beforeReload.persistence.queueFileSave(() => ({ ...snapshot('local-edit'), baseUpdatedAt: REV_LOCAL }), 0);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.ok(sharedQueue.store, '断网时修改必须进入待同步队列');
  assert.equal(beforeReload.firstScheduleId(sharedQueue.store), 'local-edit');

  // 第二段：刷新后新实例，联网恢复，安全重放本次未同步修改。
  const afterReload = harness({ remoteRevision: REV_LOCAL, queue: sharedQueue });
  await createPlannerInitializer(afterReload.deps)();
  await new Promise(resolve => setTimeout(resolve, 60));

  assert.equal(sharedQueue.store, null, '联网恢复后队列应清空');
  assert.ok(afterReload.savedPayloads.length >= 1, '应完成一次云端写入');
  assert.equal(afterReload.firstScheduleId(afterReload.savedPayloads.at(-1)), 'local-edit');
  assert.ok(
    afterReload.savedPayloads.every(payload => afterReload.firstScheduleId(payload) === 'local-edit'),
    '不得在重放后又用本次读取的快照覆盖'
  );
});

test('A7 重复同步不会重复发送，也不会重复宣告', async () => {
  const h = harness({ pending: { ...snapshot('local-edit'), baseUpdatedAt: REV_LOCAL } });
  h.persistence.enableAutoSave();

  assert.equal(await h.persistence.replayPendingChanges(), 'replayed');
  assert.equal(h.savedPayloads.length, 1);

  // 队列已清空：再次重放/刷新不得重复发送，且不得谎报成功。
  assert.equal(await h.persistence.replayPendingChanges(), 'none');
  assert.equal(await h.persistence.flushOfflineQueue(), false);
  assert.equal(h.savedPayloads.length, 1, '队列已清空，重复调用不得再次发送');
});

test('A8 旅行切换后待同步数据归属正确，不会串台', async () => {
  const stores = new Map();
  const queue = {
    async writePending(tripId, payload) { stores.set(tripId, structuredClone(payload)); return tripId; },
    async readPending(tripId) { return stores.get(tripId) ?? null; },
    async clearPending(tripId) { stores.set(tripId, null); }
  };
  const persistence = createPersistence({
    runtime: { editable: true, shareMode: false },
    api: { getRemoteRevision: () => REV_LOCAL, async savePlannerData() { return { savedAt: REV_LOCAL }; } },
    onSaveStatus: () => {}
  });
  persistence.setOfflineQueue(queue, 'trip-a');
  persistence.enableAutoSave();
  await queue.writePending('trip-a', { activeVersion: 'plan-a', baseUpdatedAt: REV_LOCAL });

  // 切换行程：队列改绑 trip-b，绝不能读到 trip-a 的待同步数据。
  persistence.setOfflineQueue(queue, 'trip-b');
  assert.equal(await persistence.readPendingChanges(), null, '切换行程后不得读到其它行程的待同步数据');
  assert.equal(await persistence.replayPendingChanges(), 'none');
  assert.equal(stores.get('trip-b') ?? null, null, '不得把其它行程的修改写到新行程');

  // trip-a 的待同步数据必须保留在自己的键下。
  assert.ok(stores.get('trip-a'), '其它行程的待同步数据必须保留');
  assert.equal(stores.get('trip-a').activeVersion, 'plan-a');
});

test('A9 云端已接受但本地队列清除失败时，不得提前宣告成功也不得丢失队列', async () => {
  const statuses = [];
  const pending = { activeVersion: 'plan-a', baseUpdatedAt: REV_LOCAL };
  const persistence = createPersistence({
    runtime: { editable: true, shareMode: false },
    api: { getRemoteRevision: () => REV_LOCAL, async savePlannerData() { return { savedAt: REV_LOCAL }; } },
    onSaveStatus: (message, tone) => statuses.push({ message, tone })
  });
  persistence.setOfflineQueue({
    async readPending() { return pending; },
    async clearPending() { throw new Error('IndexedDB 事务失败'); }
  }, 'trip-a');
  persistence.enableAutoSave();

  const outcome = await persistence.replayPendingChanges();
  assert.equal(outcome, 'failed', '清除失败时不得返回 replayed');
  assert.ok(pending, '待同步数据不得丢失');
  assert.doesNotMatch(statuses.at(-1).message, /已同步到云端/, '不得提前宣告已同步');
  assert.match(statuses.at(-1).message, /保留/);
});

test('A10 无法持久化离线修改时明确提示"仅在内存"', async () => {
  const collect = () => {
    const statuses = [];
    return { statuses, onSaveStatus: (message, tone) => statuses.push({ message, tone }) };
  };

  // 场景一：队列存在但写入返回 null（等价于 IndexedDB 不可用/超时）。
  const a = collect();
  const withQueue = createPersistence({
    runtime: { editable: true, shareMode: false },
    api: { async savePlannerData() { throw new TypeError('Failed to fetch'); } },
    onSaveStatus: a.onSaveStatus
  });
  withQueue.setOfflineQueue({ async writePending() { return null; }, async readPending() { return null; }, async clearPending() {} }, 'trip-a');
  withQueue.enableAutoSave();
  withQueue.queueFileSave(() => ({ activeVersion: 'plan-a' }), 0);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(a.statuses.at(-1).tone, 'error');
  assert.match(a.statuses.at(-1).message, /仅在内存/);
  assert.match(a.statuses.at(-1).message, /丢失/);

  // 场景二：完全没有队列能力时同样按"仅在内存"提示，而不是谎称已入队。
  const b = collect();
  const withoutQueue = createPersistence({
    runtime: { editable: true, shareMode: false },
    api: { async savePlannerData() { throw new TypeError('Failed to fetch'); } },
    onSaveStatus: b.onSaveStatus
  });
  withoutQueue.enableAutoSave();
  withoutQueue.queueFileSave(() => ({ activeVersion: 'plan-a' }), 0);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.match(b.statuses.at(-1).message, /仅在内存/);
});
