// S1 工作包 B：完整备份与恢复（LOCAL 模式，合成数据落在临时 JSON 文件，不接触正式数据/云）。
// 覆盖：往返一致、格式版本与来源版本、完整性校验、损坏/版本不支持/关联缺失/恢复中断/权限不足。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { withCurrentBaseline } from './helpers/versioned-requests.mjs';
import { isolatedDataFile } from './helpers/temp-data.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
// 合成数据改用进程独占的临时目录：并发或被中断的运行不会再争用 work/ 下的固定路径与同名锁。
const dataFile = isolatedDataFile('backup');

process.env.LOCAL = '1';
process.env.CLOUD_DEV_DATA = dataFile;
try { fs.unlinkSync(dataFile); } catch { /* 首次无文件 */ }

const require = createRequire(import.meta.url);
const api = require(path.join(root, 'cloudfunctions', 'api', 'index.js'));
const backupFormat = require(path.join(root, 'cloudfunctions', 'api', 'backup-format.js'));

// 故障注入包装：默认直通，仅在需要时让目标集合的 update 抛错（验证"恢复中断不破坏原数据"）。
const baseStore = api.createStore();
const faults = { updateTrips: 0 };
const store = {
  findOne: (collection, query) => baseStore.findOne(collection, query),
  find: (collection, query) => baseStore.find(collection, query),
  insert: (collection, doc) => baseStore.insert(collection, doc),
  remove: (collection, query) => baseStore.remove(collection, query),
  removeIfMatches: (collection, query) => baseStore.removeIfMatches(collection, query),
  update: async (collection, query, patch) => {
    if (collection === 'trips' && faults.updateTrips > 0) {
      faults.updateTrips -= 1;
      throw new Error('模拟写入中断');
    }
    return baseStore.update(collection, query, patch);
  },
  // 版本前置条件（条件更新）需要透传，否则写入入口无法工作
  updateIfMatches: async (collection, query, patch, related) => {
    if (collection === 'trips' && faults.updateTrips > 0) {
      faults.updateTrips--; throw new Error('模拟写入中断');
    }
    return baseStore.updateIfMatches(collection, query, patch, related);
  },
};
const handle = api.createRouter({ store });

async function call(method, pathname, { token, body, query } = {}) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  body = await withCurrentBaseline(baseStore, method, pathname, body, token);
  return handle({ method, path: pathname, headers, body, query });
}
const parse = res => JSON.parse(res.body);

async function register(username) {
  const res = await call('POST', '/api/auth/register', { body: { username, password: 'pass123456', nickname: username } });
  assert.equal(res.statusCode, 200, `注册 ${username} 失败: ${res.body}`);
  return parse(res);
}

// 合成行程：两个方案、事件与地点/路线关联、费用、类别、偏好、内嵌图片 + 网络图片。
function tripData() {
  return {
    activeVersion: 'plan-a',
    schemaVersion: 4,
    plans: [{ id: 'plan-a', name: '主方案' }, { id: 'plan-b', name: '备选方案' }],
    versions: {
      'plan-a': {
        planKey: 'plan-a', name: '主方案',
        schedule: [
          { id: 'e1', type: 'spot', date: '2026-08-24', title: '赛里木湖', locationId: 'loc-1', routeLinks: { routeId: 'route-1' } },
          { id: 'e2', type: 'hotel', date: '2026-08-25', title: '伊宁住宿', locationId: 'loc-2' },
        ],
        locations: [
          { id: 'loc-1', type: 'spot', name: '赛里木湖', address: '新疆博乐', photo: 'data:image/png;base64,AAAA' },
          { id: 'loc-2', type: 'hotel', name: '伊宁住宿', address: '伊宁', photo: 'https://example.com/hotel.jpg' },
        ],
        routes: [{ id: 'route-1', name: '前往赛里木湖', amap: { distance: 12000, duration: 900, tolls: 30, steps: [] } }],
        expenses: [{ id: 'x1', name: '门票', amount: 120, date: '2026-08-24' }],
        placeCategories: [{ id: 'c1', name: '露营地', color: '#2f73a9' }],
        preferences: { timeZone: 'Asia/Shanghai', currency: 'CNY' },
        updatedAt: '2026-08-20T00:00:00.000Z',
      },
      'plan-b': {
        planKey: 'plan-b', name: '备选方案',
        schedule: [{ id: 'e3', type: 'spot', date: '2026-08-26', title: '喀纳斯' }],
        locations: [], routes: [], expenses: [], placeCategories: [], preferences: {},
        updatedAt: '2026-08-20T00:00:00.000Z',
      },
    },
    routes: [{ id: 'route-1', name: '前往赛里木湖' }],
    sharedSchedule: {},
    updatedAt: '2026-08-20T00:00:00.000Z',
  };
}
const LIBRARY = [{ id: 'lib-1', type: 'supply', name: '乌鲁木齐租车点', address: '乌鲁木齐', photo: 'data:image/png;base64,BBBB' }];

// 备份记录的直读/篡改（绕过接口，用于构造损坏/更高版本/关联缺失等反例）。
const backupRow = id => baseStore.findOne('trip_backups', { _id: id });
const patchBackup = (id, patch) => baseStore.update('trip_backups', { _id: id }, patch);
const reSign = (data, placeLibrary) => backupFormat.computeIntegrity({ data, place_library: placeLibrary || [] });

let owner, editor, viewer, stranger, trip;

test('前置：注册账号并建立合成行程与通用地点库', async () => {
  owner = await register('backup_owner');
  editor = await register('backup_editor');
  viewer = await register('backup_viewer');
  stranger = await register('backup_stranger');

  const created = await call('POST', '/api/trips', { token: owner.token, body: { name: '备份测试行程', data: tripData() } });
  assert.equal(created.statusCode, 200);
  trip = parse(created).trip;

  // 通用地点库随 slim 全量上传（服务端存到账号 place_library，并从行程数据中剥离）。
  const put = await call('PUT', `/api/trips/${trip._id}`, { token: owner.token, body: { data: { ...tripData(), locations: LIBRARY } } });
  assert.equal(put.statusCode, 200);
});

test('B0 启动/读取不会自动创建备份', async () => {
  await call('GET', `/api/trips/${trip._id}`, { token: owner.token });
  await call('GET', `/api/trips/${trip._id}`, { token: owner.token });
  const rows = await baseStore.find('trip_backups', { trip_id: trip._id });
  assert.equal(rows.length, 0, '读取与启动不得自动产生备份');
});

test('B1 完整备份携带格式版本/来源版本/创建时间/完整性校验，并如实报告图片资源', async () => {
  const res = await call('POST', `/api/trips/${trip._id}/backups`, { token: owner.token });
  assert.equal(res.statusCode, 200);
  const backup = parse(res).backup;
  assert.equal(backup.format_version, backupFormat.BACKUP_FORMAT_VERSION);
  assert.ok(backup.created_at, '必须记录创建时间');
  assert.ok(backup.source.updated_at, '必须记录来源版本（行程 updated_at）');
  assert.equal(backup.assets.photos.total, 3, '2 张方案地点图片 + 1 张通用库图片');
  assert.equal(backup.assets.photos.embedded, 2);
  assert.equal(backup.assets.photos.remote, 1);
  assert.equal(backup.assets.images_fully_embedded, false, '存在网络图片 URL 时不得宣称图片已完整保存');
  assert.ok(backup.assets.notes.some(note => /网络链接/.test(note)));

  const row = await backupRow(backup._id);
  assert.ok(row.integrity, '备份必须带完整性校验值');
  assert.equal(row.integrity, reSign(row.data, row.place_library));
  assert.ok(Array.isArray(row.place_library) && row.place_library.length, '备份范围必须包含通用地点库');
});

test('B2 列表不回落整份行程数据，仅暴露元信息', async () => {
  const res = await call('GET', `/api/trips/${trip._id}/backups`, { token: owner.token });
  const list = parse(res).backups;
  assert.ok(list.length >= 1);
  list.forEach(item => {
    assert.equal(item.data, undefined, '列表不得回传整份 data');
    assert.equal(item.place_library, undefined, '列表不得回传通用地点库');
    assert.equal(typeof item.format_version, 'number');
  });
});

test('B3 恢复前保护当前数据，恢复后内容与备份一致（含全部方案/费用/类别/偏好/通用库）', async () => {
  const before = await call('GET', `/api/trips/${trip._id}/backups`, { token: owner.token });
  const target = parse(before).backups[0];

  // 覆盖当前数据：只留一个方案，制造明显差异。
  const mutated = { activeVersion: 'plan-b', plans: [{ id: 'plan-b', name: '备选方案' }], versions: { 'plan-b': { planKey: 'plan-b', schedule: [{ id: 'only', title: '被覆盖' }] } } };
  assert.equal((await call('PUT', `/api/trips/${trip._id}`, { token: owner.token, body: { data: mutated } })).statusCode, 200);

  const restored = await call('POST', `/api/trips/${trip._id}/backups/restore`, { token: owner.token, body: { backup_id: target._id } });
  assert.equal(restored.statusCode, 200);
  const payload = parse(restored);
  assert.ok(payload.guard_backup_id, '恢复前必须留下"恢复前快照"以便回退');

  const got = await call('GET', `/api/trips/${trip._id}`, { token: owner.token });
  const data = parse(got).trip.data;
  assert.equal(data.activeVersion, 'plan-a');
  assert.deepEqual(Object.keys(data.versions).sort(), ['plan-a', 'plan-b'], '全部方案都应恢复');
  assert.equal(data.versions['plan-a'].schedule.length, 2);
  assert.equal(data.versions['plan-a'].expenses.length, 1);
  assert.equal(data.versions['plan-a'].placeCategories.length, 1);
  assert.equal(data.versions['plan-a'].preferences.currency, 'CNY');
  assert.equal(data.versions['plan-a'].locations[0].photo, 'data:image/png;base64,AAAA', '内嵌图片本体应完整恢复');
  assert.ok(data.locations.some(place => place.id === 'lib-1'), '通用地点库应随备份恢复');

  const guard = await backupRow(payload.guard_backup_id);
  assert.ok(guard && guard.format_version === 1, '恢复前快照同样必须是可校验的完整备份');
});

test('B4 损坏备份（完整性不匹配）被拒绝，且不破坏当前数据', async () => {
  const res = await call('POST', `/api/trips/${trip._id}/backups`, { token: owner.token });
  const id = parse(res).backup._id;
  const row = await backupRow(id);
  await patchBackup(id, { data: { ...row.data, tampered: true } }); // 篡改但不更新 integrity

  const before = parse(await call('GET', `/api/trips/${trip._id}`, { token: owner.token })).trip.data;
  const restore = await call('POST', `/api/trips/${trip._id}/backups/restore`, { token: owner.token, body: { backup_id: id } });
  assert.equal(restore.statusCode, 409);
  assert.equal(parse(restore).code, 'BACKUP_UNVERIFIED');
  assert.match(parse(restore).error, /完整性/);
  const after = parse(await call('GET', `/api/trips/${trip._id}`, { token: owner.token })).trip.data;
  assert.deepEqual(Object.keys(after.versions), Object.keys(before.versions), '拒绝恢复时当前数据不得被改动');
});

test('B5 更高格式版本的备份禁止降级重写', async () => {
  const res = await call('POST', `/api/trips/${trip._id}/backups`, { token: owner.token });
  const id = parse(res).backup._id;
  await patchBackup(id, { format_version: backupFormat.BACKUP_FORMAT_VERSION + 1 });

  const restore = await call('POST', `/api/trips/${trip._id}/backups/restore`, { token: owner.token, body: { backup_id: id } });
  assert.equal(restore.statusCode, 409);
  assert.equal(parse(restore).code, 'BACKUP_UNVERIFIED');
  assert.match(parse(restore).error, /降级/);
});

test('B6 关联缺失的备份默认拒绝；用户显式确认后才可恢复并如实提示', async () => {
  const res = await call('POST', `/api/trips/${trip._id}/backups`, { token: owner.token });
  const id = parse(res).backup._id;
  const row = await backupRow(id);
  const broken = structuredClone(row.data);
  broken.versions['plan-a'].schedule.push({ id: 'e9', type: 'spot', title: '悬空关联', locationId: 'loc-missing' });
  await patchBackup(id, { data: broken, integrity: reSign(broken, row.place_library) });

  const denied = await call('POST', `/api/trips/${trip._id}/backups/restore`, { token: owner.token, body: { backup_id: id } });
  assert.equal(denied.statusCode, 409);
  assert.equal(parse(denied).code, 'BACKUP_LINK_MISSING');
  assert.match(parse(denied).error, /关联缺失/);

  const allowed = await call('POST', `/api/trips/${trip._id}/backups/restore`, { token: owner.token, body: { backup_id: id, allow_missing_links: true } });
  assert.equal(allowed.statusCode, 200);
  assert.ok(parse(allowed).warnings.some(text => /忽略/.test(text)), '忽略关联缺失必须如实提示');
});

test('B7 结构性损坏（空方案集）即使校验通过也被拒绝', async () => {
  const res = await call('POST', `/api/trips/${trip._id}/backups`, { token: owner.token });
  const id = parse(res).backup._id;
  const row = await backupRow(id);
  const empty = { activeVersion: null, plans: [], versions: {} };
  await patchBackup(id, { data: empty, integrity: reSign(empty, row.place_library) });

  const restore = await call('POST', `/api/trips/${trip._id}/backups/restore`, { token: owner.token, body: { backup_id: id } });
  assert.equal(restore.statusCode, 409);
  assert.equal(parse(restore).code, 'BACKUP_INVALID');
});

test('B8 恢复中断时原数据保持不变，并留下可回退的快照', async () => {
  // 回到干净数据，避免前一用例"关联缺失恢复"留下的悬空引用影响本用例判定。
  assert.equal((await call('PUT', `/api/trips/${trip._id}`, { token: owner.token, body: { data: tripData() } })).statusCode, 200);
  const res = await call('POST', `/api/trips/${trip._id}/backups`, { token: owner.token });
  const id = parse(res).backup._id;
  const before = JSON.stringify(parse(await call('GET', `/api/trips/${trip._id}`, { token: owner.token })).trip.data);

  faults.updateTrips = 1;
  const restore = await call('POST', `/api/trips/${trip._id}/backups/restore`, { token: owner.token, body: { backup_id: id } });
  assert.equal(restore.statusCode, 500);
  assert.equal(parse(restore).code, 'RESTORE_FAILED');
  assert.match(parse(restore).error, /原行程数据保持不变/);
  assert.ok(parse(restore).guard_backup_id, '中断也必须留下可回退快照');

  const after = JSON.stringify(parse(await call('GET', `/api/trips/${trip._id}`, { token: owner.token })).trip.data);
  assert.equal(after, before, '写入中断不得破坏当前数据');
});

test('B9 权限：只读成员不可备份，非创建者不可恢复，未加入者一律拒绝', async () => {
  const share = await call('POST', `/api/trips/${trip._id}/share`, { token: owner.token, body: { enabled: true, readonly: true } });
  assert.equal(share.statusCode, 200, `开启分享失败: ${share.body}`);
  const code = parse(share).trip.share_code;
  assert.ok(code, '应生成分享码');

  // viewer（只读分享加入）
  const joined = await call('POST', '/api/trips/join', { token: viewer.token, body: { share_code: code } });
  assert.equal(joined.statusCode, 200, `分享码 ${code} 加入失败: ${joined.body}`);
  const viewerBackup = await call('POST', `/api/trips/${trip._id}/backups`, { token: viewer.token });
  assert.equal(viewerBackup.statusCode, 403);

  // editor（先以只读身份加入，再由创建者授予编辑权限）可以备份，但不可恢复
  assert.equal((await call('POST', '/api/trips/join', { token: editor.token, body: { share_code: code } })).statusCode, 200);
  assert.equal((await call('PUT', `/api/trips/${trip._id}/members`, { token: owner.token, body: { user_id: editor.user._id, role: 'editor' } })).statusCode, 200);
  assert.equal((await call('POST', `/api/trips/${trip._id}/backups`, { token: editor.token })).statusCode, 200);
  const list = parse(await call('GET', `/api/trips/${trip._id}/backups`, { token: owner.token })).backups;
  const editorRestore = await call('POST', `/api/trips/${trip._id}/backups/restore`, { token: editor.token, body: { backup_id: list[0]._id } });
  assert.equal(editorRestore.statusCode, 403);
  assert.match(parse(editorRestore).error, /创建者/);

  // 未加入者
  assert.equal((await call('POST', `/api/trips/${trip._id}/backups`, { token: stranger.token })).statusCode, 403);
  assert.equal((await call('GET', `/api/trips/${trip._id}/backups`, { token: stranger.token })).statusCode, 403);
  assert.equal((await call('POST', `/api/trips/${trip._id}/backups/restore`, { token: stranger.token, body: { backup_id: list[0]._id } })).statusCode, 403);
});

test('B10 备份中不存在该行程的记录不可越权恢复', async () => {
  const other = parse(await call('POST', '/api/trips', { token: stranger.token, body: { name: '他人行程', data: tripData() } })).trip;
  const otherBackup = parse(await call('POST', `/api/trips/${other._id}/backups`, { token: stranger.token })).backup;
  const res = await call('POST', `/api/trips/${trip._id}/backups/restore`, { token: owner.token, body: { backup_id: otherBackup._id } });
  assert.equal(res.statusCode, 404, '跨行程的备份 id 不可用');
});
