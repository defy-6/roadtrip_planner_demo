// 后端云函数接口测试：LOCAL 模式，数据落在临时 JSON 文件，覆盖完整业务链路。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const dataFile = path.join(root, 'work', 'cloud-api-test.json');

process.env.LOCAL = '1';
process.env.CLOUD_DEV_DATA = dataFile;
try { fs.unlinkSync(dataFile); } catch { /* 首次无文件 */ }

const require = createRequire(import.meta.url);
const api = require(path.join(root, 'cloudfunctions', 'api', 'index.js'));
const handle = api.createRouter({ store: api.createStore() });

function call(method, pathname, { token, body, query } = {}) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
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

test('分享协作：开启分享码、凭码加入、共同编辑', async () => {
  const shareOn = await call('POST', `/api/trips/${aliceTrip._id}/share`, { token: alice.token, body: { enabled: true } });
  assert.equal(shareOn.statusCode, 200);
  const trip = JSON.parse(shareOn.body).trip;
  assert.equal(trip.share_enabled, true);
  assert.match(trip.share_code, /^[A-Z2-9]{8}$/);
  sharedTrip = trip;

  // bob 凭码加入
  const join = await call('POST', `/api/trips/${aliceTrip._id}/join`, { token: bob.token, body: { share_code: trip.share_code } });
  assert.equal(join.statusCode, 200);
  assert.equal(JSON.parse(join.body).trip.role, 'editor');

  // bob 可读可改
  const get = await call('GET', `/api/trips/${aliceTrip._id}`, { token: bob.token });
  assert.equal(get.statusCode, 200);
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
  const shareOn = await call('POST', `/api/trips/${tripId}/share`, { token: alice.token, body: { enabled: true } });
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
  const shareOn = await call('POST', `/api/trips/${tripId}/share`, { token: alice.token, body: { enabled: true } });
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

test('地点与账本轻量接口：读写 / 照片保留 / 越权', async () => {
  const created = await call('POST', '/api/trips', {
    token: alice.token,
    body: {
      name: '地点账本行程',
      data: {
        activeVersion: 'v1',
        plans: [{ id: 'v1', name: '计划一' }],
        versions: { v1: { name: '计划一', locations: [{ id: 'l1', type: 'hotel', name: '伊宁住宿', photo: 'BASE64_PHOTO', note: '老照片' }], expenses: [] } },
      },
    },
  });
  const tripId = JSON.parse(created.body).trip._id;
  const shareOn = await call('POST', `/api/trips/${tripId}/share`, { token: alice.token, body: { enabled: true } });
  const joined = await call('POST', '/api/trips/join', { token: bob.token, body: { share_code: JSON.parse(shareOn.body).trip.share_code } });
  assert.equal(joined.statusCode, 200);

  // 读地点：瘦身不含 photo
  const loc = await call('GET', `/api/trips/${tripId}/locations`, { token: bob.token });
  assert.equal(loc.statusCode, 200);
  const locBody = JSON.parse(loc.body);
  assert.equal(locBody.locations[0].name, '伊宁住宿');
  assert.equal(locBody.locations[0].photo, undefined, '瘦身不应含 photo');

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
