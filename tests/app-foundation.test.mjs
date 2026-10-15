import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlannerMigrations, migratePlannerData } from '../public/storage/migrations.js';
import { clockToMinutes, expandScheduleSegments, transportArrivalDate, zonedClock } from '../public/core/time.js';
import { createPlannerCache } from '../public/storage/planner-cache.js';
import { createPersistence } from '../public/storage/persistence.js';

const migrations = () => createPlannerMigrations({
  typeForTitle: () => 'spot', createId: () => 'generated-id', readFlag: () => true, writeFlag: () => {}, pendingAddressMigrationKey: 'test'
});

test('旧航班迁移为固定班次交通，并保持路程事件独立', () => {
  const source = {
    versions: {
      plan: {
        schedule: [
          { type: 'flight', date: '2026-08-24', title: 'CZ1234', flightInfo: { flightNumber: 'CZ1234', departureAirport: '广州白云机场', arrivalAirport: '喀什机场', arrivalDate: '2026-08-24' } },
          { type: 'drive', date: '2026-08-24', title: '前往酒店', routeLinks: { transportMode: 'driving' } }
        ]
      }
    }
  };
  const migrated = migratePlannerData(source, migrations());
  const [flight, route] = migrated.versions.plan.schedule;
  assert.equal(migrated.schemaVersion, 4);
  assert.equal(flight.type, 'transport');
  assert.equal(flight.transportInfo.kind, 'flight');
  assert.equal(flight.transportInfo.number, 'CZ1234');
  assert.equal(route.type, 'drive');
  assert.equal(route.transportInfo, undefined);
});

test('统一时区工具不受运行设备时区影响', () => {
  const instant = new Date('2026-08-24T16:30:00.000Z');
  assert.deepEqual(zonedClock(instant, 'Asia/Shanghai'), { iso: '2026-08-25', hour: 0, minute: 30, timeZone: 'Asia/Shanghai' });
  assert.equal(clockToMinutes('24:00'), 1440);
  assert.equal(transportArrivalDate({ date: '2026-08-24', transportInfo: { arrivalDate: '2026-08-25' } }), '2026-08-25');
});

test('跨天固定班次投影为出发、续段和抵达卡片，但保持同一事件索引', () => {
  const event = { type: 'transport', date: '2026-08-24', start: '23:30', end: '01:20', title: '夜间列车', transportInfo: { kind: 'train', arrivalDate: '2026-08-26' } };
  const segments = expandScheduleSegments([event]);
  assert.deepEqual(segments.map(item => [item.displayDate, item.segmentStart, item.segmentEnd, item.segmentKind, item.index]), [
    ['2026-08-24', '23:30', '24:00', 'departure', 0],
    ['2026-08-25', '00:00', '24:00', 'continuation', 0],
    ['2026-08-26', '00:00', '01:20', 'arrival', 0]
  ]);
});

test('普通事件结束时间早于开始时间时按次日结束显示', () => {
  const segments = expandScheduleSegments([{ type: 'hotel', date: '2026-08-24', start: '23:00', end: '07:00', title: '夜间住宿' }]);
  assert.deepEqual(segments.map(item => [item.displayDate, item.segmentStart, item.segmentEnd]), [
    ['2026-08-24', '23:00', '24:00'], ['2026-08-25', '00:00', '07:00']
  ]);
});

test('IndexedDB 不可用时缓存安全降级', async () => {
  const cache = createPlannerCache({ indexedDb: null, scope: 'account-a' });
  assert.equal(await cache.read('trip-a'), null);
  assert.equal(await cache.write('trip-a', { activeVersion: 'p1' }), null);
  assert.equal(await cache.readPending('trip-a'), null);
  assert.equal(await cache.writePending('trip-a', { activeVersion: 'p1' }), null);
});

test('IndexedDB 升级被旧页面阻塞时不会卡住启动', async () => {
  const indexedDb = {
    open() {
      const request = {};
      queueMicrotask(() => request.onblocked?.());
      return request;
    }
  };
  const cache = createPlannerCache({ indexedDb, scope: 'account-a', operationTimeoutMs: 20 });
  assert.equal(await cache.read('trip-a'), null);
});

test('断网保存进入待同步队列，恢复连接后清除队列', async () => {
  let pending = null;
  let online = false;
  const statuses = [];
  const queue = {
    async writePending(_tripId, payload) { pending = structuredClone(payload); return true; },
    async readPending() { return pending; },
    async clearPending() { pending = null; }
  };
  const persistence = createPersistence({
    runtime: { editable: true, shareMode: false },
    api: { async savePlannerData() { if (!online) throw new TypeError('Failed to fetch'); return { savedAt: '2026-08-24T10:00:00.000Z' }; } },
    onSaveStatus: status => statuses.push(status)
  });
  persistence.setOfflineQueue(queue, 'trip-a');
  persistence.enableAutoSave();
  persistence.queueFileSave(() => ({ activeVersion: 'plan-a', versions: {} }), 0);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(pending.activeVersion, 'plan-a');
  assert.match(statuses.at(-1), /待同步队列/);

  online = true;
  assert.equal(await persistence.flushOfflineQueue(), true);
  assert.equal(pending, null);
  assert.match(statuses.at(-1), /已同步到云端/);
});

test('云端版本冲突通过保存状态反馈且保留本地待同步数据', async () => {
  let pending = null;
  const statuses = [];
  const conflict = Object.assign(new Error('云端行程已被其他成员更新'), { code: 'VERSION_CONFLICT' });
  const persistence = createPersistence({
    runtime: { editable: true, shareMode: false },
    api: { async savePlannerData() { throw conflict; } },
    onSaveStatus: (message, tone) => statuses.push({ message, tone })
  });
  persistence.setOfflineQueue({
    async writePending(_tripId, payload) { pending = structuredClone(payload); return true; },
    async clearPending() { pending = null; }
  }, 'trip-conflict');
  persistence.enableAutoSave();
  persistence.queueFileSave(() => ({ activeVersion: 'plan-conflict', versions: {} }), 0);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(pending.activeVersion, 'plan-conflict');
  assert.equal(statuses.at(-1).tone, 'error');
  assert.match(statuses.at(-1).message, /其他成员更新/);
  assert.match(statuses.at(-1).message, /待同步修改已持久化保留/);
});

test('自动保存与离线队列恢复严格串行，不会互相制造版本冲突', async () => {
  let pending = { value: 'offline' };
  let active = 0, maximumActive = 0;
  const saved = [];
  const queue = {
    async writePending(_tripId, payload) { pending = payload; },
    async readPending() { return pending; },
    async clearPending() { pending = null; }
  };
  const persistence = createPersistence({
    runtime: { editable: true, shareMode: false },
    api: {
      async savePlannerData(payload) {
        active += 1; maximumActive = Math.max(maximumActive, active);
        await new Promise(resolve => setTimeout(resolve, 12));
        saved.push(payload.value); active -= 1;
        return { savedAt: new Date().toISOString() };
      }
    }
  });
  persistence.setOfflineQueue(queue, 'trip-a');
  persistence.enableAutoSave();
  const flushing = persistence.flushOfflineQueue();
  persistence.queueFileSave(() => ({ value: 'latest' }), 0);
  await flushing;
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(maximumActive, 1);
  assert.deepEqual(saved, ['latest'], 'newly accepted snapshot supersedes an older queue before replay starts');
  assert.equal(pending, null);
});

test('暂停后旧代次排队保存不会在重新启用时复活', async () => {
  let release;
  let started;
  const gate = new Promise(resolve => { release = resolve; });
  const startedGate = new Promise(resolve => { started = resolve; });
  const saved = [];
  const writes = [];
  const persistence = createPersistence({ runtime: { editable: true }, api: {
    async savePlannerData(payload) {
      saved.push(payload.value); started(); await gate;
      return { savedAt: new Date().toISOString() };
    }
  } });
  persistence.setOfflineQueue({ readPending: async () => ({ value: 'in-flight' }),
    writePending: async (_id, payload) => writes.push(payload), clearPending: async () => {} });
  persistence.enableAutoSave();
  const flush = persistence.flushOfflineQueue();
  await startedGate;
  persistence.queueFileSave(() => ({ value: 'stale queued save' }), 0);
  await new Promise(resolve => setTimeout(resolve, 0));
  persistence.disableAutoSave();
  persistence.enableAutoSave();
  release();
  await flush;
  await persistence.waitForIdle();
  assert.deepEqual(saved, ['in-flight'], 'already-sent writes finish; old queued tasks do not send');
  assert.deepEqual(writes, []);
});

test('队列读取途中暂停不会发送旧数据，也不清除待同步修改', async () => {
  let release;
  let reading;
  const gate = new Promise(resolve => { release = resolve; });
  const readingGate = new Promise(resolve => { reading = resolve; });
  let sent = 0, cleared = 0;
  const persistence = createPersistence({ runtime: { editable: true }, api: {
    savePlannerData: async () => { sent++; return {}; }
  } });
  persistence.setOfflineQueue({ readPending: async () => { reading(); await gate; return { value: 'pending' }; },
    clearPending: async () => { cleared++; } });
  persistence.enableAutoSave();
  const flush = persistence.flushOfflineQueue();
  await readingGate;
  persistence.disableAutoSave();
  persistence.enableAutoSave();
  release();
  assert.equal(await flush, false);
  assert.equal(sent, 0);
  assert.equal(cleared, 0);
});

test('accepted saves capture immutable data immediately and preserve a recoverable memory snapshot after storage failure', async () => {
  const source = { title: 'accepted' };
  const payloads = [];
  const persistence = createPersistence({ runtime: { editable: true }, api: {
    async savePlannerData(payload) { payloads.push(payload); throw Object.assign(new Error('conflict'), { code: 'VERSION_CONFLICT' }); }
  } });
  persistence.setOfflineQueue({ scope: 'actor', writePending: async () => null, readPending: async () => null }, 'original-trip');
  persistence.enableAutoSave(); persistence.queueFileSave(() => source, 0);
  source.title = 'later edit';
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(payloads[0].title, 'accepted');
  assert.equal(payloads[0].sourceTripId, 'original-trip');
  const pending = await persistence.readPendingChanges();
  assert.equal(pending.title, 'accepted');
  pending.title = 'export copy mutated';
  assert.equal((await persistence.readPendingChanges()).title, 'accepted');
  assert.equal(await persistence.replayPendingChanges(), 'failed', 'missing durable queue cannot authorize replacing the memory draft');
  assert.equal(payloads.length, 1, 'recovery does not upload an older or missing durable snapshot');
  persistence.setOfflineQueue({ scope: 'other-actor', readPending: async () => null }, 'original-trip');
  assert.equal(await persistence.readPendingChanges(), null, 'memory recovery is actor-scoped');
});
