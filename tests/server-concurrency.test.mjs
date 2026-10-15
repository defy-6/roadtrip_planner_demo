// S1 工作包 C：双端并发与服务端冲突控制（LOCAL 模式，合成数据落在临时 JSON 文件，不接触正式数据/云）。
// 覆盖：两客户端同时保存（后者 409 不覆盖前者）、分域交错写入、带基线冲突、旧客户端（无基线）兼容、
//       读写窗口内被插入并发写入仍被原子挡住、重复请求不重复应用、部分失败保留可恢复状态、只读/越权 403。
import test, { before } from 'node:test';
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
const dataFile = isolatedDataFile('concurrency');

process.env.LOCAL = '1';
process.env.CLOUD_DEV_DATA = dataFile;
try { fs.unlinkSync(dataFile); } catch { /* 首次无文件 */ }

const require = createRequire(import.meta.url);
const api = require(path.join(root, 'cloudfunctions', 'api', 'index.js'));

const baseStore = api.createStore();

// 正常路由：直接使用共享 store。
const handle = api.createRouter({ store: baseStore });

// 竞态注入适配器：模拟"服务端读到版本 V → 另一请求在读写窗口内提交 → 本请求的条件更新落库"。
// arm 为真时，在 updateIfMatches 真正落库前先由"另一个客户端"写入一次，抬高 updated_at。
const race = { arm: false };
const raceStore = {
  findOne: (collection, query) => baseStore.findOne(collection, query),
  find: (collection, query) => baseStore.find(collection, query),
  insert: (collection, doc) => baseStore.insert(collection, doc),
  remove: (collection, query) => baseStore.remove(collection, query),
  removeIfMatches: (collection, query) => baseStore.removeIfMatches(collection, query),
  update: (collection, query, patch) => baseStore.update(collection, query, patch),
  updateIfMatches: async (collection, query, patch, related) => {
    if (race.arm && collection === 'trips') {
      race.arm = false;
      // 另一客户端在窗口内抢先提交：只改版本与名称，制造真实的"版本已前进"。
      await baseStore.update('trips', { _id: query._id }, { name: '并发的另一客户端', updated_at: new Date(Date.now() + 60000).toISOString() });
    }
    return baseStore.updateIfMatches(collection, query, patch, related);
  },
};
const raceHandle = api.createRouter({ store: raceStore });

async function call(method, pathname, { token, body } = {}) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  body = await withCurrentBaseline(baseStore, method, pathname, body, token);
  return handle({ method, path: pathname, headers, body });
}
async function callJson(method, pathname, opts) {
  const res = await call(method, pathname, opts);
  return { status: res.statusCode, data: JSON.parse(res.body) };
}

async function register(username) {
  const { status, data } = await callJson('POST', '/api/auth/register', {
    body: { username, password: 'pass123456', nickname: username },
  });
  assert.equal(status, 200, `注册 ${username} 失败: ${JSON.stringify(data)}`);
  return data;
}

// 合成行程：单方案，包含 schedule / locations / expenses / categories / routes 各一条。
function syntheticData() {
  return {
    activeVersion: 'plan-main',
    schemaVersion: 4,
    plans: [{ id: 'plan-main', name: '主方案' }],
    versions: {
      'plan-main': {
        planKey: 'plan-main', name: '主方案',
        schedule: [{ id: 'e1', type: 'spot', date: '2026-08-24', title: '初始事件', locationId: 'loc-1' }],
        locations: [{ id: 'loc-1', type: 'spot', name: '初始地点', address: '某地' }],
        routes: [{ id: 'route-1', name: '初始路线', amap: { distance: 1000, duration: 60, tolls: 0, steps: [] } }],
        expenses: [{ id: 'x1', name: '初始账目', amount: 100, date: '2026-08-24' }],
        placeCategories: [{ id: 'c1', name: '初始分类', color: '#2f73a9' }],
        preferences: { currency: 'CNY' },
        updatedAt: '2026-08-20T00:00:00.000Z',
      },
    },
    routes: [{ id: 'route-1', name: '初始路线' }],
    updatedAt: '2026-08-20T00:00:00.000Z',
  };
}

let owner, editor, viewer, stranger, tripId;

before(async () => {
  owner = await register('race_owner');
  editor = await register('race_editor');
  viewer = await register('race_viewer');
  stranger = await register('race_stranger');

  const created = await callJson('POST', '/api/trips', {
    token: owner.token, body: { name: '并发测试行程', data: syntheticData() },
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  tripId = created.data.trip._id;

  // 开启只读分享，viewer 加入
  const shared = await callJson('POST', `/api/trips/${tripId}/share`, {
    token: owner.token, body: { enabled: true, readonly: true },
  });
  assert.equal(shared.status, 200, JSON.stringify(shared.data));
  const code = shared.data.trip.share_code;
  const joinedViewer = await callJson('POST', '/api/trips/join', { token: viewer.token, body: { share_code: code } });
  assert.equal(joinedViewer.status, 200, JSON.stringify(joinedViewer.data));

  // editor 加入并把权限从 viewer 提升为 editor
  const joinedEditor = await callJson('POST', '/api/trips/join', { token: editor.token, body: { share_code: code } });
  assert.equal(joinedEditor.status, 200, JSON.stringify(joinedEditor.data));
  const promoted = await callJson('PUT', `/api/trips/${tripId}/members`, {
    token: owner.token, body: { user_id: editor.user._id, role: 'editor' },
  });
  assert.equal(promoted.status, 200, JSON.stringify(promoted.data));
});

const baseVersion = async token => {
  const { data } = await callJson('GET', `/api/trips/${tripId}/schedule`, { token });
  return data.updated_at;
};
const getSchedule = async token => (await callJson('GET', `/api/trips/${tripId}/schedule`, { token })).data.schedule;

test('C1 两客户端同时保存：先写者生效，后写者 409 且不覆盖前者', async () => {
  const v1 = await baseVersion(owner.token);

  // 客户端 A 基于 v1 保存
  const a = await callJson('PUT', `/api/trips/${tripId}/schedule`, {
    token: owner.token, body: { schedule: [{ id: 'e1', type: 'spot', date: '2026-08-24', title: 'A 的修改' }], baseUpdatedAt: v1 },
  });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  const v2 = a.data.updated_at;
  assert.ok(v2 && v2 !== v1, '写入后应返回新的权威版本');

  // 客户端 B 同样基于 v1（它"看到的"仍是旧版本）保存 → 必须 409，不得静默覆盖 A
  const b = await callJson('PUT', `/api/trips/${tripId}/schedule`, {
    token: owner.token, body: { schedule: [{ id: 'e1', type: 'spot', date: '2026-08-24', title: 'B 的修改' }], baseUpdatedAt: v1 },
  });
  assert.equal(b.status, 409, JSON.stringify(b.data));
  assert.equal(b.data.code, 'VERSION_CONFLICT');

  const schedule = await getSchedule(owner.token);
  assert.equal(schedule.length, 1);
  assert.equal(schedule[0].title, 'A 的修改', 'B 的过期写入不得覆盖 A 的结果');
});

test('C2 分域交错写入：过期基线写 expenses 被拒，最新基线写 locations 通过', async () => {
  const v1 = await baseVersion(owner.token);

  // A 写 schedule → 前进到 v2
  const a = await callJson('PUT', `/api/trips/${tripId}/schedule`, {
    token: owner.token, body: { schedule: [{ id: 'e1', type: 'spot', date: '2026-08-24', title: '交错 A' }], baseUpdatedAt: v1 },
  });
  assert.equal(a.status, 200);
  const v2 = a.data.updated_at;

  // B 仍以过期 v1 写 expenses（不同域）→ 仍须 409，不能"因为域不同"就放过
  const b = await callJson('PUT', `/api/trips/${tripId}/expenses`, {
    token: editor.token, body: { expenses: [{ id: 'x1', name: 'B 的账目', amount: 999, date: '2026-08-24' }], baseUpdatedAt: v1 },
  });
  assert.equal(b.status, 409, JSON.stringify(b.data));
  assert.equal(b.data.code, 'VERSION_CONFLICT');

  // C 以最新 v2 写 locations → 通过
  const c = await callJson('PUT', `/api/trips/${tripId}/locations`, {
    token: editor.token, body: { locations: [{ id: 'loc-1', type: 'spot', name: 'C 的地点' }], baseUpdatedAt: v2 },
  });
  assert.equal(c.status, 200, JSON.stringify(c.data));

  // 过期写被拒后，expenses 保持原值（未部分写入）
  const exp = await callJson('GET', `/api/trips/${tripId}/expenses`, { token: owner.token });
  assert.equal(exp.data.expenses[0].name, '初始账目');
  const locs = await callJson('GET', `/api/trips/${tripId}/locations`, { token: owner.token });
  assert.equal(locs.data.locations.find(l => l.id === 'loc-1').name, 'C 的地点');
});

test('C3 无基线旧客户端拒写；有基线的读写窗口由原子更新保护', async () => {
  // 旧客户端：不带 baseUpdatedAt，服务端退回"刚读到的版本"，正常写入成功
  const legacy = await callJson('PUT', `/api/trips/${tripId}/categories`, {
    token: owner.token, body: { categories: [{ id: 'c1', name: '旧客户端分类', color: '#2f73a9' }], baseUpdatedAt: '' },
  });
  assert.equal(legacy.status, 428, JSON.stringify(legacy.data));
  assert.equal(legacy.data.code, 'VERSION_REQUIRED');
  const baseline = await baseVersion(owner.token);

  // 读写窗口内被插入并发写入：服务端条件更新必须失败 → 409（而不是后写静默覆盖）
  race.arm = true;
  const res = await raceHandle({
    method: 'PUT',
    path: `/api/trips/${tripId}/schedule`,
    headers: { authorization: `Bearer ${owner.token}` },
    body: { schedule: [{ id: 'e1', type: 'spot', date: '2026-08-24', title: '窗口内写入' }], baseUpdatedAt: baseline },
  });
  const data = JSON.parse(res.body);
  assert.equal(res.statusCode, 409, JSON.stringify(data));
  assert.equal(data.code, 'VERSION_CONFLICT');
  assert.equal(race.arm, false, '竞态注入应已被触发');

  // 窗口内写入的内容不得落库
  const schedule = await getSchedule(owner.token);
  assert.ok(!schedule.some(e => e.title === '窗口内写入'), '窗口内写入不得落库');
});

test('C4 重复请求（基于同一旧版本的幂等重试）不重复应用', async () => {
  const v = await baseVersion(owner.token);
  const body = { schedule: [{ id: 'e1', type: 'spot', date: '2026-08-24', title: '重试目标' }], baseUpdatedAt: v };

  const first = await callJson('PUT', `/api/trips/${tripId}/schedule`, { token: owner.token, body });
  assert.equal(first.status, 200);
  // 同一请求重放（网络重试）：base 已过期 → 409，且不会产生第二条 / 重复事件
  const again = await callJson('PUT', `/api/trips/${tripId}/schedule`, { token: owner.token, body });
  assert.equal(again.status, 409, JSON.stringify(again.data));
  assert.equal(again.data.code, 'VERSION_CONFLICT');

  const schedule = await getSchedule(owner.token);
  assert.equal(schedule.filter(e => e.title === '重试目标').length, 1, '重复请求不应造成重复数据');
});

test('C5 部分成功保留可恢复状态并准确反馈冲突版本', async () => {
  const v1 = await baseVersion(owner.token);
  // 第一域成功
  const ok = await callJson('PUT', `/api/trips/${tripId}/expenses`, {
    token: owner.token, body: { expenses: [{ id: 'x1', name: '已成功写入', amount: 100, date: '2026-08-24' }], baseUpdatedAt: v1 },
  });
  assert.equal(ok.status, 200);
  const v2 = ok.data.updated_at;

  // 第二域使用过期基线 → 409，并返回当前权威版本，客户端可据此安全重放
  const conflict = await callJson('PUT', `/api/trips/${tripId}/categories`, {
    token: owner.token, body: { categories: [{ id: 'c1', name: '不应写入', color: '#2f73a9' }], baseUpdatedAt: v1 },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.code, 'VERSION_CONFLICT');
  assert.equal(conflict.data.current_updated_at, v2, '冲突响应须给出当前权威版本');

  // 第一域结果保留；第二域未写入
  const exp = await callJson('GET', `/api/trips/${tripId}/expenses`, { token: owner.token });
  assert.equal(exp.data.expenses[0].name, '已成功写入');
  const cats = await callJson('GET', `/api/trips/${tripId}/categories`, { token: owner.token });
  assert.equal(cats.data.categories[0].name, '初始分类');
});

test('C6 方案管理入口同样受版本前置条件约束', async () => {
  const v1 = await baseVersion(owner.token);
  // 先做一次写入，使 v1 过期
  const bump = await callJson('PUT', `/api/trips/${tripId}/schedule`, {
    token: owner.token, body: { schedule: [{ id: 'e1', type: 'spot', date: '2026-08-24', title: '前进一下' }], baseUpdatedAt: v1 },
  });
  assert.equal(bump.status, 200);

  const staleSwitch = await callJson('PUT', `/api/trips/${tripId}/plan`, {
    token: owner.token, body: { activeVersion: 'plan-main', baseUpdatedAt: v1 },
  });
  assert.equal(staleSwitch.status, 409, JSON.stringify(staleSwitch.data));
  assert.equal(staleSwitch.data.code, 'VERSION_CONFLICT');

  const staleCreate = await callJson('POST', `/api/trips/${tripId}/plans`, {
    token: owner.token, body: { name: '过期新建', baseUpdatedAt: v1 },
  });
  assert.equal(staleCreate.status, 409, JSON.stringify(staleCreate.data));

  // 最新基线可以正常新建
  const v2 = await baseVersion(owner.token);
  const freshCreate = await callJson('POST', `/api/trips/${tripId}/plans`, {
    token: owner.token, body: { name: '正常新建', baseUpdatedAt: v2 },
  });
  assert.equal(freshCreate.status, 200, JSON.stringify(freshCreate.data));

  // 复原活动方案，避免新建方案（会切换 activeVersion）影响后续用例
  const v3 = await baseVersion(owner.token);
  const back = await callJson('PUT', `/api/trips/${tripId}/plan`, {
    token: owner.token, body: { activeVersion: 'plan-main', baseUpdatedAt: v3 },
  });
  assert.equal(back.status, 200, JSON.stringify(back.data));
});

test('C7 权限边界：只读 viewer 与未加入者写入均被拒', async () => {
  const v = await baseVersion(owner.token);
  const before = await getSchedule(owner.token);

  const viewerWrite = await callJson('PUT', `/api/trips/${tripId}/schedule`, {
    token: viewer.token, body: { schedule: [{ id: 'e1', type: 'spot', date: '2026-08-24', title: 'viewer 写入' }], baseUpdatedAt: v },
  });
  assert.equal(viewerWrite.status, 403, JSON.stringify(viewerWrite.data));

  const strangerWrite = await callJson('PUT', `/api/trips/${tripId}/schedule`, {
    token: stranger.token, body: { schedule: [{ id: 'e1', type: 'spot', date: '2026-08-24', title: 'stranger 写入' }], baseUpdatedAt: v },
  });
  assert.equal(strangerWrite.status, 403, JSON.stringify(strangerWrite.data));

  const strangerExpenses = await callJson('PUT', `/api/trips/${tripId}/expenses`, {
    token: stranger.token, body: { expenses: [], baseUpdatedAt: v },
  });
  assert.equal(strangerExpenses.status, 403, JSON.stringify(strangerExpenses.data));

  const after = await getSchedule(owner.token);
  assert.deepEqual(after, before, '越权/只读写入不得落库');
});

test('C8 带基线的写入同样受原子保护：读写窗口内被并发插入 → 409（不能只靠读后预检）', async () => {
  // 关键：客户端带的基线此时并不过期（预检会放行），唯一能挡住的是"版本检查 + 写入"的服务端原子条件更新。
  const v = await baseVersion(owner.token);
  race.arm = true;
  const res = await raceHandle({
    method: 'PUT',
    path: `/api/trips/${tripId}/schedule`,
    headers: { authorization: `Bearer ${owner.token}` },
    body: { schedule: [{ id: 'e1', type: 'spot', date: '2026-08-24', title: '原子窗口写入' }], baseUpdatedAt: v },
  });
  const data = JSON.parse(res.body);
  assert.equal(res.statusCode, 409, JSON.stringify(data));
  assert.equal(data.code, 'VERSION_CONFLICT');
  assert.equal(race.arm, false, '竞态应已被触发');
  const schedule = await getSchedule(owner.token);
  assert.ok(!schedule.some(e => e.title === '原子窗口写入'), '窗口内写入不得落库');

  // 分域入口同样：以最新基线 + 窗口内并发写入 → 409
  const v2 = await baseVersion(owner.token);
  race.arm = true;
  const res2 = await raceHandle({
    method: 'PUT',
    path: `/api/trips/${tripId}/locations`,
    headers: { authorization: `Bearer ${owner.token}` },
    body: { locations: [{ id: 'loc-1', type: 'spot', name: '原子窗口地点' }], baseUpdatedAt: v2 },
  });
  const data2 = JSON.parse(res2.body);
  assert.equal(res2.statusCode, 409, JSON.stringify(data2));
  assert.equal(data2.code, 'VERSION_CONFLICT');
});
