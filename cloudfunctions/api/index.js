// 「行远途记」后端云函数入口。
// 同一份代码两种运行形态：
//   1. 本地开发：LOCAL=1 node index.js → 启动 HTTP 服务（默认 3100 端口），数据落在 work/cloud-dev.json
//   2. 微信云开发：导出 main，由云函数 HTTP 触发器调用，数据落在云数据库
'use strict';

const http = require('node:http');

const { createStore } = require('./store');
const { createAuthRoutes } = require('./routes/auth');
const { createTripsRoutes } = require('./routes/trips');
const { createAmapRoutes } = require('./routes/amap');
const security = require('./security');

// 网页端跨域（公用 HTTP 触发器域名被浏览器直连时需要）
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Max-Age': '86400',
};
const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS };

// ---------- 鉴权 ----------
async function getOpenId(code) {
  // 本地开发：mock 身份；云端：wx-server-sdk 从请求上下文取微信 openid
  const isLocal = process.env.LOCAL === '1' || process.env.LOCAL === 'true';
  if (isLocal) return `mock_openid_${code}`;
  try {
    // eslint-disable-next-line global-require
    const cloud = require('wx-server-sdk');
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
    const { OPENID } = cloud.getWXContext();
    return OPENID || null;
  } catch {
    return `mock_openid_${code}`;
  }
}

async function authenticate(store, headers) {
  const header = headers && (headers.authorization || headers.Authorization);
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  if (!token) return null;
  const session = await store.findOne('sessions', { token });
  if (!session) return null;
  if (session.expires_at && new Date(session.expires_at).getTime() < Date.now()) {
    await store.remove('sessions', { token });
    return null;
  }
  const user = await store.findOne('users', { _id: session.user_id });
  if (user) user.provider = session.provider; // 登录来源：password / wx（bind 判定用）
  return user;
}

// ---------- 路由分发 ----------
function createRouter({ store, amapKey, qweatherKey }) {
  const auth = createAuthRoutes({ store, security, getOpenId });
  const trips = createTripsRoutes({ store });
  const amap = createAmapRoutes({ amapKey, qweatherKey });

  function match(path) {
    const segs = path.split('/').filter(Boolean); // e.g. ['api','trips','abc123','join']
    return segs;
  }

  async function dispatch(method, segs, body, user, { query = {}, headers = {} } = {}) {
    const [api, resource, id, action, sub] = segs;
    if (api !== 'api') return { statusCode: 404, data: { ok: false, error: '接口不存在' } };

    // 网页端复用：高德/天气查询（GET 取 query，路线取 body）与预览模式。
    // 公网域名暴露时高德类接口必须登录，防止未授权消耗配额。
    if (['geocode', 'place-photos', 'place-details', 'route', 'weather'].includes(resource)) {
      if (!user) return { statusCode: 401, data: { ok: false, error: '未登录' } };
    }
    try {
      if (resource === 'geocode') return await amap.geocode(query);
      if (resource === 'place-photos') return await amap.placePhotos(query);
      if (resource === 'place-details') return await amap.placeDetails(query);
      if (resource === 'route' && method === 'POST') return await amap.calculateRoute(body);
      if (resource === 'weather') return await amap.weather({ ...query, ...(body && typeof body === 'object' ? body : {}) });
      if (resource === 'preview-mode') return await amap.previewMode(headers);
    } catch (error) {
      return { statusCode: 400, data: { ok: false, error: error.message || '查询失败' } };
    }

    if (resource === 'auth') {
      if (method === 'POST' && id === 'register') return auth.register(body);
      if (method === 'POST' && id === 'login') return auth.login(body);
      if (method === 'POST' && id === 'wx-login') return auth.wxLogin(body);
      if (method === 'GET' && id === 'me' && user) return auth.me(user);
      if (method === 'POST' && id === 'bind' && user) return auth.bind(user, body);
      if (method === 'POST' && id === 'bind') return { statusCode: 401, data: { ok: false, error: '未登录' } };
      if (id === 'me') return { statusCode: 401, data: { ok: false, error: '未登录' } };
      return { statusCode: 404, data: { ok: false, error: '接口不存在' } };
    }

    if (resource === 'trips') {
      if (!user) return { statusCode: 401, data: { ok: false, error: '未登录' } };
      if (!id) {
        if (method === 'GET') return trips.list(user._id);
        if (method === 'POST') return trips.create(user._id, body);
        return { statusCode: 405, data: { ok: false, error: '方法不允许' } };
      }
      // 加入协作只需要分享码，允许无行程 id 的语义化路径
      if (id === 'join' && method === 'POST') return trips.join(user._id, body);
      if (action === 'join' && method === 'POST') return trips.join(user._id, body);
      // 轻量时间表接口（小程序端避免回传大体积 data）
      if (action === 'schedule' && method === 'GET') return trips.getSchedule(user._id, id);
      if (action === 'schedule' && method === 'PUT') return trips.updateSchedule(user._id, id, body);
      // 轻量计划接口：查看/切换/新建/复制/删除
      if (action === 'plan' && method === 'GET') return trips.getPlan(user._id, id);
      if (action === 'plan' && method === 'PUT') return trips.switchPlan(user._id, id, body);
      if (action === 'plans' && sub === 'copy' && method === 'POST') return trips.copyPlan(user._id, id);
      if (action === 'plans' && method === 'POST') return trips.createPlan(user._id, id, body);
      if (action === 'plans' && method === 'DELETE') return trips.removePlan(user._id, id, body);
      // 地点 / 账本轻量接口
      if (action === 'locations' && method === 'GET') return trips.getLocations(user._id, id);
      if (action === 'locations' && method === 'PUT') return trips.updateLocations(user._id, id, body);
      if (action === 'expenses' && method === 'GET') return trips.getExpenses(user._id, id);
      if (action === 'expenses' && method === 'PUT') return trips.updateExpenses(user._id, id, body);
      if (action === 'share' && method === 'POST') return trips.share(user._id, id, body);
      if (action === 'members' && method === 'GET') return trips.members(user._id, id);
      if (method === 'GET') return trips.get(user._id, id);
      if (method === 'PUT') return trips.update(user._id, id, body);
      if (method === 'DELETE') return trips.remove(user._id, id);
      return { statusCode: 405, data: { ok: false, error: '方法不允许' } };
    }

    return { statusCode: 404, data: { ok: false, error: '接口不存在' } };
  }

  return async function handle({ method, path, headers, body, query }) {
    const user = await authenticate(store, headers);
    const result = await dispatch(method || 'GET', match(path || '/'), body || {}, user, { query: query || {}, headers: headers || {} });
    return { statusCode: result.statusCode, body: JSON.stringify(result.data) };
  };
}

// ---------- 本地 HTTP 服务（开发测试用） ----------
function createServer() {
  const store = createStore();
  const handle = createRouter({ store });
  return http.createServer(async (req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', async () => {
      let body = {};
      if (raw) {
        try { body = JSON.parse(raw); } catch { /* 忽略非 JSON body */ }
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
      }
      try {
        const parsedUrl = new URL(req.url, 'http://localhost');
        const result = await handle({
          method: req.method,
          path: parsedUrl.pathname,
          headers: req.headers,
          body,
          query: Object.fromEntries(parsedUrl.searchParams),
        });
        res.writeHead(result.statusCode, jsonHeaders);
        res.end(result.body);
      } catch (err) {
        res.writeHead(500, jsonHeaders);
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
  });
}

// ---------- 云函数入口（兼容两种调用） ----------
// 1) HTTP 触发器：event 含 httpMethod / path / headers / body
// 2) 小程序 wx.cloud.callFunction 直调：event.__http = { method, path, headers, body }
let cachedHandle = null;
function getHandle() {
  if (!cachedHandle) {
    cachedHandle = createRouter({
      store: createStore(),
      amapKey: process.env.AMAP_WEB_SERVICE_KEY,
      qweatherKey: process.env.QWEATHER_API_KEY,
    });
  }
  return cachedHandle;
}

exports.main = async (event = {}) => {
  const http = event.__http || event;
  const method = http.httpMethod || http.method || 'GET';
  // 浏览器跨域预检：直接返回 204，不进入业务路由
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  let body = {};
  try {
    const raw = http.body;
    if (typeof raw === 'string') {
      body = JSON.parse(http.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw);
    } else if (raw && typeof raw === 'object') {
      body = raw; // wx.cloud.callFunction 直调时 body 为对象
    }
  } catch { /* 忽略非法 body */ }
  try {
    const result = await getHandle()({
      method,
      path: http.path || '/',
      headers: http.headers || {},
      body,
      query: http.queryStringParameters || http.query || {},
    });
    return {
      statusCode: result.statusCode,
      headers: jsonHeaders,
      body: result.body,
    };
  } catch (err) {
    // 内部错误透传，便于小程序端显示定位（不静默失败）
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ ok: false, error: `云函数内部错误：${err.message || err}` }),
    };
  }
};

// ---------- 本地直接运行：node index.js ----------
if (require.main === module && (process.env.LOCAL === '1' || process.env.LOCAL === 'true')) {
  const port = Number(process.env.CLOUD_API_PORT || 3100);
  createServer().listen(port, () => {
    console.log(`[roadtrip-api] 本地云函数已启动: http://localhost:${port}`);
    console.log(`[roadtrip-api] 数据文件: ${process.env.CLOUD_DEV_DATA || 'work/cloud-dev.json'}（LOCAL 模式）`);
  });
}

// 供测试脚本使用
exports.createStore = createStore;
exports.createRouter = createRouter;
exports.createServer = createServer;
