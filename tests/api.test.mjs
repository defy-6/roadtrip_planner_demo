// 后端云函数接口测试：LOCAL 模式，数据落在临时 JSON 文件，覆盖完整业务链路。
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
const dataFile = isolatedDataFile('api');

process.env.LOCAL = '1';
process.env.CLOUD_DEV_DATA = dataFile;
try { fs.unlinkSync(dataFile); } catch { /* 首次无文件 */ }

const require = createRequire(import.meta.url);
const api = require(path.join(root, 'cloudfunctions', 'api', 'index.js'));
const handle = api.createRouter({ store: api.createStore() });

async function call(method, pathname, { token, body, query } = {}) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  body = await withCurrentBaseline(api.createStore(), method, pathname, body, token);
  return handle({ method, path: pathname, headers, body, query });
}

async function register(username, password = 'pass123456') {
  const res = await call('POST', '/api/auth/register', { body: { username, password, nickname: username } });
  assert.equal(res.statusCode, 200, `注册 ${username} 失败: ${res.body}`);
  return JSON.parse(res.body);
}

let alice, bob, carol, aliceTrip, sharedTrip;

test('注册与参数校验', async () => {
  const bad = await call('POST', '/api/auth/register', { body: { username: 'a', password: '123' } });
  assert.equal(bad.statusCode, 400);
  const first = await call('POST', '/api/auth/register', { body: { username: 'alice', password: 'pass123456', nickname: 'alice' } });
  assert.equal(first.statusCode, 200, '首次注册应成功');
  const dup = await call('POST', '/api/auth/register', { body: { username: 'alice', password: 'pass123456' } });
  assert.equal(dup.statusCode, 409);
});

test('登录取得 token', async () => {
  const login = await call('POST', '/api/auth/login', { body: { username: 'alice', password: 'wrong-pass' } });
  assert.equal(login.statusCode, 401);
  const ok = await call('POST', '/api/auth/login', { body: { username: 'alice', password: 'pass123456' } });
  assert.equal(ok.statusCode, 200);
  alice = JSON.parse(ok.body);
});

test('鉴权：无 token 拒绝，有效 token 通过 me', async () => {
  const noAuth = await call('GET', '/api/auth/me');
  assert.equal(noAuth.statusCode, 401);
  const me = await call('GET', '/api/auth/me', { token: alice.token });
  assert.equal(me.statusCode, 200);
  assert.equal(JSON.parse(me.body).user._id, alice.user._id);
});

test('创建行程与数据隔离', async () => {
  const res = await call('POST', '/api/trips', { token: alice.token, body: { name: '川西环线', data: { places: [{ name: '四姑娘山' }] } } });
  assert.equal(res.statusCode, 200);
  aliceTrip = JSON.parse(res.body).trip;
  assert.equal(aliceTrip.role, 'owner');

  bob = await register('bob');
  const bobList = await call('GET', '/api/trips', { token: bob.token });
  const list = JSON.parse(bobList.body).trips;
  assert.equal(list.mine.length, 0, 'bob 不应看到 alice 的行程');
  assert.equal(list.shared.length, 0);
});

test('分享协作：分享码默认只读，拥有者可授予编辑权限', async () => {
  const shareOn = await call('POST', `/api/trips/${aliceTrip._id}/share`, { token: alice.token, body: { enabled: true } });
  assert.equal(shareOn.statusCode, 200);
  const trip = JSON.parse(shareOn.body).trip;
  assert.equal(trip.share_enabled, true);
  assert.match(trip.share_code, /^[A-Z2-9]{8}$/);
  sharedTrip = trip;

  // bob 凭码加入
  const join = await call('POST', `/api/trips/${aliceTrip._id}/join`, { token: bob.token, body: { share_code: trip.share_code } });
  assert.equal(join.statusCode, 200);
  assert.equal(JSON.parse(join.body).trip.role, 'viewer');

  // bob 默认可读不可改；拥有者授权后才可编辑
  const get = await call('GET', `/api/trips/${aliceTrip._id}`, { token: bob.token });
  assert.equal(get.statusCode, 200);
  const denied = await call('PUT', `/api/trips/${aliceTrip._id}`, { token: bob.token, body: { data: { places: [] } } });
  assert.equal(denied.statusCode, 403);
  const grant = await call('PUT', `/api/trips/${aliceTrip._id}/members`, { token: alice.token, body: { user_id: bob.user._id, role: 'editor' } });
  assert.equal(grant.statusCode, 200);
  const put = await call('PUT', `/api/trips/${aliceTrip._id}`, { token: bob.token, body: { data: { places: [{ name: '四姑娘山' }, { name: '稻城亚丁' }] } } });
  assert.equal(put.statusCode, 200);
  assert.equal(JSON.parse(put.body).trip.data.places.length, 2);

  // bob 无权删除 / 无权管理分享
  const del = await call('DELETE', `/api/trips/${aliceTrip._id}`, { token: bob.token });
  assert.equal(del.statusCode, 403);
  const shareByEditor = await call('POST', `/api/trips/${aliceTrip._id}/share`, { token: bob.token, body: { enabled: false } });
  assert.equal(shareByEditor.statusCode, 403);

  // 协作列表里双方都在
  const members = await call('GET', `/api/trips/${aliceTrip._id}/members`, { token: alice.token });
  const rows = JSON.parse(members.body).members;
  assert.equal(rows.length, 2);
  assert.ok(rows.some(m => m.role === 'owner' && m.nickname === 'alice'));
  assert.ok(rows.some(m => m.role === 'editor' && m.nickname === 'bob'));

  // bob 的行程列表出现 shared
  const bobList = await call('GET', '/api/trips', { token: bob.token });
  const list = JSON.parse(bobList.body).trips;
  assert.equal(list.mine.length, 0);
  assert.equal(list.shared.length, 1);
  assert.equal(list.shared[0]._id, aliceTrip._id);
});

test('创建者管理协作者权限，并保留最近三次手动备份', async () => {
  const readonly = await call('PUT', `/api/trips/${aliceTrip._id}/members`, { token: alice.token, body: { user_id: bob.user._id, role: 'viewer' } });
  assert.equal(readonly.statusCode, 200);
  const denied = await call('PUT', `/api/trips/${aliceTrip._id}`, { token: bob.token, body: { name: '不应成功' } });
  assert.equal(denied.statusCode, 403);
  const editable = await call('PUT', `/api/trips/${aliceTrip._id}/members`, { token: alice.token, body: { user_id: bob.user._id, role: 'editor' } });
  assert.equal(editable.statusCode, 200);

  // 真实行程数据始终带 plans/versions；这里用有结构的数据，避免用无方案的空壳数据
  // 触发 S1 新增的"恢复前结构校验"（空方案集禁止恢复），保持该用例原本要验证的语义。
  const markerTripData = marker => ({
    marker,
    activeVersion: 'plan-a',
    plans: [{ id: 'plan-a', name: '主方案' }],
    versions: {
      'plan-a': { planKey: 'plan-a', schedule: [], locations: [], routes: [], expenses: [], placeCategories: [], preferences: {} },
    },
  });
  for (let index = 1; index <= 4; index += 1) {
    await call('PUT', `/api/trips/${aliceTrip._id}`, { token: alice.token, body: { data: markerTripData(index) } });
    const backup = await call('POST', `/api/trips/${aliceTrip._id}/backups`, { token: alice.token });
    assert.equal(backup.statusCode, 200);
  }
  const listed = await call('GET', `/api/trips/${aliceTrip._id}/backups`, { token: alice.token });
  const backups = JSON.parse(listed.body).backups;
  assert.equal(backups.length, 3);
  await call('PUT', `/api/trips/${aliceTrip._id}`, { token: alice.token, body: { data: markerTripData(99) } });
  const restored = await call('POST', `/api/trips/${aliceTrip._id}/backups/restore`, { token: alice.token, body: { backup_id: backups[0]._id } });
  assert.equal(restored.statusCode, 200);
  assert.equal(JSON.parse(restored.body).trip.data.marker, 4);
});

test('越权访问与分享码关闭', async () => {
  carol = await register('carol');
  const forbidden = await call('GET', `/api/trips/${aliceTrip._id}`, { token: carol.token });
  assert.equal(forbidden.statusCode, 403, '未加入者不能看行程');

  const off = await call('POST', `/api/trips/${aliceTrip._id}/share`, { token: alice.token, body: { enabled: false } });
  assert.equal(JSON.parse(off.body).trip.share_code, null);

  const carolJoin = await call('POST', `/api/trips/${aliceTrip._id}/join`, { token: carol.token, body: { share_code: sharedTrip.share_code } });
  assert.equal(carolJoin.statusCode, 404, '关闭后分享码失效');
});

test('轻量时间表接口：getSchedule / updateSchedule / 越权', async () => {
  // 建一个带 versions/activeVersion 结构的行程
  const created = await call('POST', '/api/trips', {
    token: alice.token,
    body: {
      name: '时间表行程',
      data: {
        activeVersion: 'plan-a',
        versions: { 'plan-a': { name: '计划A', schedule: [{ date: '2026-10-01', start: '09:00', end: '10:00', title: '原有事件', type: 'spot' }] } },
      },
    },
  });
  const tripId = JSON.parse(created.body).trip._id;

  // alice 开启分享 → bob 凭码加入（editor）
  const shareOn = await call('POST', `/api/trips/${tripId}/share`, { token: alice.token, body: { enabled: true, readonly: false } });
  const code = JSON.parse(shareOn.body).trip.share_code;
  const joined = await call('POST', '/api/trips/join', { token: bob.token, body: { share_code: code } });
  assert.equal(joined.statusCode, 200);

  // bob（editor）读取 schedule
  const get = await call('GET', `/api/trips/${tripId}/schedule`, { token: bob.token });
  assert.equal(get.statusCode, 200);
  const body = JSON.parse(get.body);
  assert.equal(body.ok, true);
  assert.equal(body.activeVersion, 'plan-a', '应返回活动计划 id');
  assert.equal(body.schedule.length, 1);

  // bob（editor）更新 schedule
  const newSchedule = [{ date: '2026-10-02', start: '09:00', end: '10:00', title: '新增事件', type: 'spot' }];
  const put = await call('PUT', `/api/trips/${tripId}/schedule`, { token: bob.token, body: { schedule: newSchedule } });
  assert.equal(put.statusCode, 200);
  assert.equal(JSON.parse(put.body).count, 1);

  // 验证已落库
  const after = await call('GET', `/api/trips/${tripId}/schedule`, { token: alice.token });
  assert.equal(JSON.parse(after.body).schedule[0].title, '新增事件');
  assert.equal(JSON.parse(after.body).schedule[0].date, '2026-10-02');

  // 未加入者（carol）403
  const denied = await call('GET', `/api/trips/${tripId}/schedule`, { token: carol.token });
  assert.equal(denied.statusCode, 403);

  // 非法格式 400
  const bad = await call('PUT', `/api/trips/${tripId}/schedule`, { token: bob.token, body: { schedule: 'not-array' } });
  assert.equal(bad.statusCode, 400);
});

test('计划接口：getPlan / switchPlan / create / copy / remove', async () => {
  const created = await call('POST', '/api/trips', {
    token: alice.token,
    body: {
      name: '计划行程',
      data: {
        activeVersion: 'p1',
        plans: [{ id: 'p1', name: '计划一' }],
        versions: {
          p1: {
            name: '计划一',
            locations: [{ id: 'l1', type: 'spot', name: '景点A', resolved: { location: '82.8,43.3' }, photo: 'BIG_DATA' }],
            routes: [{ id: 'r1', name: '路线1', amap: { distance: 1000, duration: 60, tolls: 0, steps: [{ polyline: '82.0,43.0;82.1,43.1;82.2,43.2' }] } }],
          },
        },
      },
    },
  });
  const tripId = JSON.parse(created.body).trip._id;
  const shareOn = await call('POST', `/api/trips/${tripId}/share`, { token: alice.token, body: { enabled: true, readonly: false } });
  const joined = await call('POST', '/api/trips/join', { token: bob.token, body: { share_code: JSON.parse(shareOn.body).trip.share_code } });
  assert.equal(joined.statusCode, 200);

  // getPlan：瘦身（不含 photo 大字段）+ polyline 保留
  const plan = await call('GET', `/api/trips/${tripId}/plan`, { token: bob.token });
  assert.equal(plan.statusCode, 200);
  const p = JSON.parse(plan.body);
  assert.equal(p.activeVersion, 'p1');
  assert.equal(p.plans.length, 1);
  assert.equal(p.plan.locations[0].name, '景点A');
  assert.equal(p.plan.locations[0].photo, undefined, '瘦身应剔除大字段');
  assert.equal(p.plan.routes[0].amap.steps[0].polyline, '82.0,43.0;82.1,43.1;82.2,43.2');

  // 新建计划
  const create = await call('POST', `/api/trips/${tripId}/plans`, { token: bob.token, body: { name: '计划二' } });
  assert.equal(create.statusCode, 200);
  const createdBody = JSON.parse(create.body);
  assert.equal(createdBody.plans.length, 2);
  assert.notEqual(createdBody.activeVersion, 'p1');

  // 切换回 p1
  const sw = await call('PUT', `/api/trips/${tripId}/plan`, { token: bob.token, body: { activeVersion: 'p1' } });
  assert.equal(sw.statusCode, 200);
  assert.equal(JSON.parse(sw.body).activeVersion, 'p1');

  // 复制当前计划
  const copy = await call('POST', `/api/trips/${tripId}/plans/copy`, { token: bob.token });
  assert.equal(copy.statusCode, 200);
  assert.equal(JSON.parse(copy.body).plans.length, 3);

  // 删除复制的计划
  const del = await call('DELETE', `/api/trips/${tripId}/plans`, { token: bob.token, body: { id: JSON.parse(copy.body).activeVersion } });
  assert.equal(del.statusCode, 200);
  assert.equal(JSON.parse(del.body).plans.length, 2);

  // 越权 403
  const denied = await call('GET', `/api/trips/${tripId}/plan`, { token: carol.token });
  assert.equal(denied.statusCode, 403);
});

test('路线逐条保存：保留主数据、支持 upsert，并在最后同步删除', async () => {
  const initialData = {
    activeVersion: 'v1',
    plans: [{ id: 'v1', name: '路线测试' }],
    versions: { v1: { name: '路线测试', schedule: [{ id: 's1' }], locations: [{ id: 'l1' }], routes: [{ id: 'old' }] } },
    routes: [{ id: 'old' }],
  };
  const created = await call('POST', '/api/trips', { token: alice.token, body: { name: '逐条路线', data: initialData } });
  const tripId = JSON.parse(created.body).trip._id;
  const slim = structuredClone(initialData);
  slim.versions.v1.schedule = [];
  slim.versions.v1.locations = [];
  slim.versions.v1.routes = [];
  slim.routes = [];
  const main = await call('PUT', `/api/trips/${tripId}`, { token: alice.token, body: { data: slim, preserve_large_fields: true } });
  assert.equal(main.statusCode, 200);
  assert.equal(JSON.parse(main.body).trip.data.versions.v1.schedule[0].id, 's1', '轻字段保存不得覆盖已有大字段');

  const route = { id: 'new/route', name: '新路线', amap: { steps: [{ polyline: '80,40;81,41' }] } };
  const upsert = await call('PUT', `/api/trips/${tripId}/routes/item`, { token: alice.token, body: { route } });
  assert.equal(upsert.statusCode, 200);
  const sync = await call('PUT', `/api/trips/${tripId}/routes/sync`, { token: alice.token, body: { routeIds: ['new/route'] } });
  assert.equal(sync.statusCode, 200);
  const saved = await call('GET', `/api/trips/${tripId}`, { token: alice.token });
  const savedData = JSON.parse(saved.body).trip.data;
  assert.deepEqual(savedData.versions.v1.routes.map(item => item.id), ['new/route']);
  assert.deepEqual(savedData.routes.map(item => item.id), ['new/route']);
});

test('地点与账本轻量接口：读写 / 照片保留 / 越权', async () => {
  const created = await call('POST', '/api/trips', {
    token: alice.token,
    body: {
      name: '地点账本行程',
      data: {
        activeVersion: 'v1',
        plans: [{ id: 'v1', name: '计划一' }],
        versions: { v1: { name: '计划一', locations: [{ id: 'l1', type: 'hotel', name: '伊宁住宿', photo: 'BASE64_PHOTO', note: '老照片' }, { id: 'l2', type: 'spot', name: '应保留的旧地点' }], expenses: [] } },
      },
    },
  });
  const tripId = JSON.parse(created.body).trip._id;
  const shareOn = await call('POST', `/api/trips/${tripId}/share`, { token: alice.token, body: { enabled: true, readonly: false } });
  const joined = await call('POST', '/api/trips/join', { token: bob.token, body: { share_code: JSON.parse(shareOn.body).trip.share_code } });
  assert.equal(joined.statusCode, 200);

  // 读地点：photo 字段随接口返回（小程序地点列表显示缩略图）
  const loc = await call('GET', `/api/trips/${tripId}/locations`, { token: bob.token });
  assert.equal(loc.statusCode, 200);
  const locBody = JSON.parse(loc.body);
  assert.equal(locBody.locations[0].name, '伊宁住宿');
  assert.equal(locBody.locations[0].photo, 'BASE64_PHOTO', '应返回 photo 供列表展示');

  // 改地点（不含 photo）→ 照片应保留
  const updated = await call('PUT', `/api/trips/${tripId}/locations`, {
    token: bob.token,
    body: { locations: [{ id: 'l1', type: 'hotel', name: '伊宁酒店', note: '新备注' }] },
  });
  assert.equal(updated.statusCode, 200);
  const after = await call('GET', `/api/trips/${tripId}/locations`, { token: alice.token });
  const afterLoc = JSON.parse(after.body).locations[0];
  assert.equal(afterLoc.name, '伊宁酒店');
  assert.equal(afterLoc.note, '新备注');
  assert.equal(JSON.parse(after.body).locations.length, 2, '增量更新单个地点时不得覆盖计划中的其他地点');
  assert.equal(JSON.parse(after.body).locations[1].name, '应保留的旧地点');

  // 账本：写 + 读
  const expenses = [{ id: 'e1', date: '2026-08-15', category: '餐饮', note: '晚餐', amount: 128.5 }];
  const putExp = await call('PUT', `/api/trips/${tripId}/expenses`, { token: bob.token, body: { expenses } });
  assert.equal(putExp.statusCode, 200);
  const getExp = await call('GET', `/api/trips/${tripId}/expenses`, { token: alice.token });
  assert.equal(JSON.parse(getExp.body).expenses[0].amount, 128.5);

  // 越权 403
  assert.equal((await call('GET', `/api/trips/${tripId}/locations`, { token: carol.token })).statusCode, 403);
  assert.equal((await call('PUT', `/api/trips/${tripId}/expenses`, { token: carol.token, body: { expenses: [] } })).statusCode, 403);
});

test('账号级我的地点库：跨账号隔离，加入行程方案后的地点可协作共享', async () => {
  const created = await call('POST', '/api/trips', {
    token: alice.token,
    body: {
      name: '通用库行程',
      data: {
        activeVersion: 'p1',
        plans: [{ id: 'p1', name: '计划一' }],
        versions: { p1: { name: '计划一', locations: [] } },
        locations: [{ id: 'u1', type: 'spot', name: '赛里木湖', address: '博州', photo: 'PHOTO' }],
      },
    },
  });
  const tripId = JSON.parse(created.body).trip._id;
  const shareOn = await call('POST', `/api/trips/${tripId}/share`, { token: alice.token, body: { enabled: true, readonly: false } });
  const joined = await call('POST', '/api/trips/join', { token: bob.token, body: { share_code: JSON.parse(shareOn.body).trip.share_code } });
  assert.equal(joined.statusCode, 200);

  // 协作者不会看到创建者的账号级地点库
  const bobLibrary = await call('GET', `/api/trips/${tripId}/universal`, { token: bob.token });
  assert.equal(bobLibrary.statusCode, 200);
  assert.equal(JSON.parse(bobLibrary.body).locations.length, 0);

  // 创建者读取自己的地点库（瘦身不含 photo）
  const univ = await call('GET', `/api/trips/${tripId}/universal`, { token: alice.token });
  assert.equal(univ.statusCode, 200);
  const univBody = JSON.parse(univ.body);
  assert.equal(univBody.locations[0].name, '赛里木湖');
  assert.equal(univBody.locations[0].photo, undefined);

  // 添加到当前计划（photo 保留）
  const add = await call('POST', `/api/trips/${tripId}/universal`, { token: alice.token, body: { locationId: 'u1' } });
  assert.equal(add.statusCode, 200);
  const plan = await call('GET', `/api/trips/${tripId}/locations`, { token: alice.token });
  const locs = JSON.parse(plan.body).locations;
  assert.equal(locs.length, 1);
  assert.equal(locs[0].name, '赛里木湖');

  // 重复添加不重复
  await call('POST', `/api/trips/${tripId}/universal`, { token: alice.token, body: { locationId: 'u1' } });
  const again = await call('GET', `/api/trips/${tripId}/locations`, { token: bob.token });
  assert.equal(JSON.parse(again.body).locations.length, 1);

  // 越权 403
  assert.equal((await call('GET', `/api/trips/${tripId}/universal`, { token: carol.token })).statusCode, 403);
});

test('只读分享：viewer 角色可读不可写', async () => {
  const created = await call('POST', '/api/trips', {
    token: alice.token,
    body: { name: '只读行程', data: { activeVersion: 'p1', plans: [{ id: 'p1', name: 'P1' }], versions: { p1: { name: 'P1', schedule: [], locations: [] } } } },
  });
  const tripId = JSON.parse(created.body).trip._id;
  const shareOn = await call('POST', `/api/trips/${tripId}/share`, { token: alice.token, body: { enabled: true, readonly: true } });
  const viewer = await register('vieweruser');
  const joined = await call('POST', '/api/trips/join', { token: viewer.token, body: { share_code: JSON.parse(shareOn.body).trip.share_code } });
  assert.equal(joined.statusCode, 200);
  assert.equal(JSON.parse(joined.body).trip.role, 'viewer', '只读分享应授予 viewer 角色');
  // 读 OK
  assert.equal((await call('GET', `/api/trips/${tripId}/schedule`, { token: viewer.token })).statusCode, 200);
  // 写 403（schedule / 计划 / 地点 / 分享）
  assert.equal((await call('PUT', `/api/trips/${tripId}/schedule`, { token: viewer.token, body: { schedule: [] } })).statusCode, 403);
  assert.equal((await call('POST', `/api/trips/${tripId}/plans`, { token: viewer.token, body: { name: 'X' } })).statusCode, 403);
  assert.equal((await call('PUT', `/api/trips/${tripId}/locations`, { token: viewer.token, body: { locations: [] } })).statusCode, 403);
  assert.equal((await call('POST', `/api/trips/${tripId}/share`, { token: viewer.token, body: { enabled: false } })).statusCode, 403);
  // editor（非只读）分享可写
  const shareEditor = await call('POST', `/api/trips/${tripId}/share`, { token: alice.token, body: { enabled: true, readonly: false } });
  const editorUser = await register('editoruser');
  await call('POST', '/api/trips/join', { token: editorUser.token, body: { share_code: JSON.parse(shareEditor.body).trip.share_code } });
  assert.equal((await call('PUT', `/api/trips/${tripId}/schedule`, { token: editorUser.token, body: { schedule: [] } })).statusCode, 200);
});

test('自定义分类读写与导出接口', async () => {
  const created = await call('POST', '/api/trips', { token: alice.token, body: { name: '分类行程', data: { activeVersion: 'p1', plans: [{ id: 'p1', name: 'P1' }], versions: { p1: { name: 'P1', locations: [] } } } } });
  const tripId = JSON.parse(created.body).trip._id;
  const shareOn = await call('POST', `/api/trips/${tripId}/share`, { token: alice.token, body: { enabled: true, readonly: false } });
  const joined = await call('POST', '/api/trips/join', { token: bob.token, body: { share_code: JSON.parse(shareOn.body).trip.share_code } });
  assert.equal(joined.statusCode, 200);

  // categories 读写
  const put = await call('PUT', `/api/trips/${tripId}/categories`, { token: bob.token, body: { categories: [{ id: 'c1', name: '加油站', color: '#c8a438' }] } });
  assert.equal(put.statusCode, 200);
  const get = await call('GET', `/api/trips/${tripId}/categories`, { token: alice.token });
  assert.equal(JSON.parse(get.body).categories[0].name, '加油站');

  // exportJson：本地无 wx-server-sdk → 业务 500（不崩溃）
  const exp = await call('POST', `/api/trips/${tripId}/export`, { token: alice.token });
  assert.equal(exp.statusCode, 500);
});

test('账号绑定与天气接口', async () => {
  // 天气走 amap.weather 转发：未登录 → 401（防公网配额滥用）；带 token 缺参数 → 400
  assert.equal((await call('GET', '/api/weather', { body: {} })).statusCode, 401);
  assert.equal((await call('GET', '/api/weather', { token: alice.token, body: {} })).statusCode, 400);
  // 带坐标日期：本地无 key 时回退 Open-Meteo（成功 200）或网络失败 400，都应是业务响应
  const w = await call('GET', '/api/weather', {
    token: alice.token,
    query: { latitude: '43.3', longitude: '82.8', date: '2026-08-15' },
  });
  assert.ok([200, 400].includes(w.statusCode), `weather 应返回 200 或 400，实际 ${w.statusCode}`);

  // openid 用户（wx-login mock）
  const wx = await call('POST', '/api/auth/wx-login', { body: { code: 'bind-test' } });
  assert.equal(wx.statusCode, 200);
  const wxToken = JSON.parse(wx.body).token;

  // 错误密码 401
  const bad = await call('POST', '/api/auth/bind', { token: wxToken, body: { username: 'alice', password: 'wrong' } });
  assert.equal(bad.statusCode, 401);

  // 正确绑定 → 返回 alice 的 token
  const ok = await call('POST', '/api/auth/bind', { token: wxToken, body: { username: 'alice', password: 'pass123456' } });
  assert.equal(ok.statusCode, 200);
  const bound = JSON.parse(ok.body);
  assert.equal(bound.user.username, 'alice');
  assert.ok(bound.token);

  // 账号密码登录用户调用 bind → 400
  const again = await call('POST', '/api/auth/bind', { token: alice.token, body: { username: 'bob', password: 'pass123456' } });
  assert.equal(again.statusCode, 400);
});

test('HTTP 链路：本地 server 注册→登录→建行程', async () => {
  const server = api.createServer();
  await new Promise(resolve => server.listen(0, resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const reg = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'httpuser', password: 'pass123456' }),
    });
    assert.equal(reg.status, 200);
    const { token } = await reg.json();

    const create = await fetch(`${base}/api/trips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'HTTP 链路测试' }),
    });
    assert.equal(create.status, 200);
    const { trip } = await create.json();
    assert.equal(trip.name, 'HTTP 链路测试');

    const list = await fetch(`${base}/api/trips`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(list.status, 200);
    assert.equal((await list.json()).trips.mine.length, 1);
  } finally {
    server.close();
  }
});

test('网页端复用：preview-mode / 高德类接口鉴权 / CORS 预检', async () => {
  // preview-mode 按 UA 判断，无需登录
  const mobile = await call('GET', '/api/preview-mode', {});
  assert.equal(mobile.statusCode, 200);
  assert.equal(JSON.parse(mobile.body).mode, 'desktop'); // 测试环境 UA 无移动端特征
  const mobileUa = await handle({ method: 'GET', path: '/api/preview-mode', headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }, body: {} });
  assert.equal(JSON.parse(mobileUa.body).mode, 'mobile');

  // 高德类接口：未登录 401（防公网配额滥用）
  for (const path of ['/api/geocode', '/api/place-photos', '/api/place-details', '/api/weather']) {
    const res = await call('GET', path, { body: {} });
    assert.equal(res.statusCode, 401, `${path} 未登录应 401`);
  }
  assert.equal((await call('POST', '/api/route', { body: {} })).statusCode, 401);

  // 已登录但缺参数/缺 Key → 业务 400（而非崩溃）
  const geo = await call('GET', '/api/geocode', { token: alice.token, body: {} });
  assert.equal(geo.statusCode, 400);
  const photos = await call('GET', '/api/place-photos', { token: alice.token, query: { name: '赛里木湖', address: '新疆' } });
  assert.equal(photos.statusCode, 400);

  // exports.main：OPTIONS 预检 204 + CORS 头；业务响应带 CORS 头
  const preflight = await api.main({ httpMethod: 'OPTIONS', path: '/api/trips', headers: {}, body: '' });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers['Access-Control-Allow-Origin'], '*');
  const resp = await api.main({ httpMethod: 'GET', path: '/api/preview-mode', headers: {}, queryStringParameters: {}, body: '' });
  assert.equal(resp.statusCode, 200);
  assert.ok(resp.headers['Access-Control-Allow-Origin'], '业务响应应带 CORS 头');
});
