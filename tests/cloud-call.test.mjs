// 云函数 exports.main 的 wx.cloud.callFunction 直调分支测试（event.__http 协议）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const dataFile = path.join(root, 'work', 'cloud-call-test.json');

process.env.LOCAL = '1';
process.env.CLOUD_DEV_DATA = dataFile;
try { fs.unlinkSync(dataFile); } catch { /* 首次无文件 */ }

const require = createRequire(import.meta.url);
const { main } = require(path.join(root, 'cloudfunctions', 'api', 'index.js'));

async function call(method, p, { token, body } = {}) {
  return main({
    __http: {
      method,
      path: p,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body,
    },
  });
}

const parse = res => JSON.parse(res.body);

test('callFunction 分支：注册→登录→建行程→鉴权', async () => {
  // 注册
  const reg = await call('POST', '/api/auth/register', { body: { username: 'cfuser', password: 'pass123456' } });
  assert.equal(reg.statusCode, 200);
  const token = parse(reg).token;
  assert.ok(token, '应返回 token');

  // 鉴权：无 token 401
  const noAuth = await call('GET', '/api/trips');
  assert.equal(noAuth.statusCode, 401);

  // 带 token：me + 建行程
  const me = await call('GET', '/api/auth/me', { token });
  assert.equal(me.statusCode, 200);
  assert.equal(parse(me).user.username, 'cfuser');

  const create = await call('POST', '/api/trips', { token, body: { name: 'callFunction 行程' } });
  assert.equal(create.statusCode, 200);
  assert.equal(parse(create).trip.role, 'owner');

  const list = await call('GET', '/api/trips', { token });
  assert.equal(parse(list).trips.mine.length, 1);

  // 密码错误 401（登录类接口不应触发 token 清除逻辑）
  const badLogin = await call('POST', '/api/auth/login', { body: { username: 'cfuser', password: 'wrong' } });
  assert.equal(badLogin.statusCode, 401);
});

test('callFunction 分支：HTTP 风格 event 仍兼容', async () => {
  const res = await main({
    httpMethod: 'POST',
    path: '/api/auth/register',
    headers: {},
    body: '{"username":"httpuser","password":"pass123456"}',
  });
  assert.equal(res.statusCode, 200);
  assert.ok(parse(res).token);
});
