// 前端会话（account）与 API 云分流逻辑测试：不依赖浏览器，storage/fetch 均为注入 mock。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function memoryStorage() {
  const map = new Map();
  return {
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
  };
}

function fakeApi(overrides = {}) {
  const state = { activeTripId: null, token: null };
  const users = overrides.users || { alice: { _id: 'u1', username: 'alice', password: 'pass123456' } };
  const sessions = overrides.sessions || { token1: 'u1' };
  const trips = overrides.trips || [
    { _id: 't1', name: '川西环线', owner_id: 'u1', data: { name: '川西环线' }, role: 'owner', updated_at: '2026-01-02T00:00:00Z' },
  ];
  const members = overrides.members || [{ trip_id: 't1', user_id: 'u1', role: 'owner' }];

  function userForToken(token) {
    const uid = sessions[token];
    return uid ? users[Object.keys(users).find(k => users[k]._id === uid)] : null;
  }
  function authed(token) {
    if (!token) return null;
    const user = userForToken(token);
    if (!user) throw Object.assign(new Error('未登录'), { status: 401 });
    return user;
  }
  function asUser(user) { return { _id: user._id, username: user.username, nickname: user.username }; }

  return {
    state,
    setToken: token => { state.token = token; },
    setActiveTrip: id => { state.activeTripId = id; },
    authMe: async () => {
      const user = authed(state.token);
      return { user: asUser(user) };
    },
    authLogin: async ({ username, password }) => {
      const user = Object.values(users).find(u => u.username === username);
      if (!user || user.password !== password) throw Object.assign(new Error('用户名或密码错误'), { status: 401 });
      return { token: 'token1', user: asUser(user) };
    },
    authRegister: async ({ username, password }) => {
      if (Object.values(users).some(u => u.username === username)) throw new Error('用户名已被注册');
      users[username] = { _id: `u${Object.keys(users).length + 1}`, username, password };
      return { token: 'token1', user: asUser(users[username]) };
    },
    listTrips: async () => ({ trips: { mine: trips.filter(t => t.owner_id === 'u1'), shared: [] } }),
    createTrip: async ({ name, data }) => {
      const trip = { _id: `t${trips.length + 1}`, name, data, owner_id: 'u1', role: 'owner', updated_at: '2026-01-03T00:00:00Z' };
      trips.push(trip);
      return { trip };
    },
    joinTrip: async shareCode => {
      const trip = trips.find(t => t.share_code === shareCode && t.share_enabled);
      if (!trip) throw new Error('分享码无效或已关闭');
      return { trip: { ...trip, role: 'editor' } };
    },
    ...overrides.api,
  };
}

test('restore：无 token 返回 null，有 token 恢复用户并选定活动行程', async () => {
  const storage = memoryStorage();
  const api = fakeApi();
  const { createAccount } = await import(path.join(root, 'public', 'services', 'account.js'));

  const account = createAccount({ api, storage });
  assert.equal(await account.restore(), null, '无 token 不应登录');

  storage.setItem('roadtrip-token', 'token1');
  storage.setItem('roadtrip-active-trip', 't1');
  const user = await account.restore();
  assert.equal(user.username, 'alice');
  assert.equal(account.getActiveTripId(), 't1');
  assert.equal(api.state.activeTripId, 't1');
});

test('restore：token 失效时清 token 并回退本地模式', async () => {
  const storage = memoryStorage();
  storage.setItem('roadtrip-token', 'expired');
  const api = fakeApi();
  const { createAccount } = await import(path.join(root, 'public', 'services', 'account.js'));

  const account = createAccount({ api, storage });
  assert.equal(await account.restore(), null);
  assert.equal(storage.getItem('roadtrip-token'), null, '失效 token 应被清除');
  assert.equal(api.state.activeTripId, null);
});

test('login / register / logout 完整流转', async () => {
  const storage = memoryStorage();
  const api = fakeApi();
  const { createAccount } = await import(path.join(root, 'public', 'services', 'account.js'));

  const account = createAccount({ api, storage });
  await account.register('bob', 'pass123456');
  assert.ok(storage.getItem('roadtrip-token'));
  assert.equal(account.getUser().username, 'bob');
  assert.ok(account.getActiveTripId(), '注册后应选中一个行程');

  await account.logout();
  assert.equal(account.getUser(), null);
  assert.equal(storage.getItem('roadtrip-token'), null);
  assert.equal(account.getActiveTripId(), null);
});

test('createTrip / joinTrip 更新活动行程', async () => {
  const storage = memoryStorage();
  const api = fakeApi();
  const { createAccount } = await import(path.join(root, 'public', 'services', 'account.js'));

  const account = createAccount({ api, storage });
  storage.setItem('roadtrip-token', 'token1');
  await account.restore();

  const trip = await account.createTrip('新行程', { name: '新行程' });
  assert.equal(account.getActiveTripId(), trip._id);
  assert.equal(storage.getItem('roadtrip-active-trip'), trip._id);
});

test('api 云分流：有活动行程走 trips API，否则走本地文件', async () => {
  const storage = memoryStorage();
  storage.setItem('roadtrip-token', 'token1');
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', auth: options.headers?.Authorization || null });
    if (url.startsWith('/api/trips/')) {
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ ok: true, trip: { _id: 't1', data: { name: '云端行程' }, updated_at: '2026-02-01T00:00:00Z' } }) };
    }
    if (url === '/api/planner-data') {
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: { name: '本地行程' } }) };
    }
    throw new Error(`unexpected url ${url}`);
  };
  try {
    const { createApi } = await import(path.join(root, 'public', 'services', 'api.js'));
    const api = createApi({ storage });
    assert.deepEqual((await api.getPlannerData()).data, { name: '本地行程' }, '未选行程时读本地');
    assert.equal(calls.at(-1).url, '/api/planner-data');

    api.setActiveTrip('t1');
    const cloud = await api.getPlannerData();
    assert.deepEqual(cloud.data, { name: '云端行程' }, '选行程后读云端');
    assert.equal(calls.at(-1).url, '/api/trips/t1');
    assert.equal(calls.at(-1).auth, 'Bearer token1', '应附带 token');

    const saved = await api.savePlannerData({ name: '保存' });
    assert.equal(saved.updatedAt, '2026-02-01T00:00:00Z', '云保存返回时间戳');
    assert.equal(calls.at(-1).method, 'PUT');
  } finally {
    delete globalThis.fetch;
  }
});

test('api 云分流：401 触发 onUnauthorized（非登录接口）', async () => {
  const storage = memoryStorage();
  storage.setItem('roadtrip-token', 'token1');
  let unauthorized = 0;
  globalThis.fetch = async url => ({
    ok: false, status: 401, headers: { get: () => 'application/json' },
    json: async () => ({ ok: false, error: '未登录' }),
  });
  try {
    const { createApi } = await import(path.join(root, 'public', 'services', 'api.js'));
    const api = createApi({ storage, onUnauthorized: () => { unauthorized += 1; } });
    api.setActiveTrip('t1');
    await assert.rejects(() => api.getPlannerData(), /未登录/);
    assert.equal(unauthorized, 1);
  } finally {
    delete globalThis.fetch;
  }
});
