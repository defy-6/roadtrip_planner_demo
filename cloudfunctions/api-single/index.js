// 行远途记后端云函数（单文件版，由 scripts/build-cloud-single.mjs 生成）
// 部署：云开发控制台 → 云函数 api → index.js 整体替换本文件内容；
//       package.json 替换为 {"dependencies":{"wx-server-sdk":"~2.6.3"}}；然后保存并部署。
'use strict';

const http = require('node:http');

// ===== store.js（内联） =====
const storeModule = (() => {
  const fs = require('node:fs');
  const path = require('node:path');
  const crypto = require('node:crypto');
  const COLLECTIONS = ['users', 'sessions', 'trips', 'trip_members'];
// 数据访问层：本地 JSON 文件适配器（LOCAL=1 时用于开发测试）+ 微信云开发适配器。
// 两个实现暴露同一套异步接口：
//   findOne(collection, query) / find(collection, query)
//   insert(collection, doc) / update(collection, query, patch) / remove(collection, query)
// query 为等值匹配对象；文档统一使用 _id 字符串主键。

'use strict';



// ---------- 本地 JSON 适配器 ----------
class LocalStore {
  constructor(file) {
    this.file = file;
    this.data = {};
    for (const name of COLLECTIONS) this.data[name] = [];
    this._load();
    this._persist();
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const name of COLLECTIONS) {
        if (Array.isArray(raw[name])) this.data[name] = raw[name];
      }
    } catch {
      // 首次启动尚无数据文件
    }
  }

  _persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
  }

  _matches(doc, query) {
    return Object.entries(query || {}).every(([k, v]) => doc[k] === v);
  }

  async findOne(collection, query) {
    return this.data[collection].find(d => this._matches(d, query)) || null;
  }

  async find(collection, query) {
    return this.data[collection].filter(d => this._matches(d, query));
  }

  async insert(collection, doc) {
    const record = { _id: crypto.randomBytes(16).toString('hex'), ...doc };
    this.data[collection].push(record);
    this._persist();
    return record;
  }

  async update(collection, query, patch) {
    const doc = this.data[collection].find(d => this._matches(d, query));
    if (!doc) return null;
    Object.assign(doc, patch);
    this._persist();
    return doc;
  }

  async remove(collection, query) {
    const before = this.data[collection].length;
    this.data[collection] = this.data[collection].filter(d => !this._matches(d, query));
    const removed = before - this.data[collection].length;
    if (removed > 0) this._persist();
    return removed;
  }
}

// ---------- 微信云开发适配器 ----------
class CloudStore {
  constructor(cloud, env) {
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV || env });
    this.db = cloud.database();
  }

  async findOne(collection, query) {
    const res = await this.db.collection(collection).where(query).limit(1).get();
    return res.data[0] || null;
  }

  async find(collection, query) {
    const res = await this.db.collection(collection).where(query).limit(1000).get();
    return res.data;
  }

  async insert(collection, doc) {
    const record = { _id: crypto.randomBytes(16).toString('hex'), ...doc };
    await this.db.collection(collection).add({ data: record });
    return record;
  }

  async update(collection, query, patch) {
    const doc = await this.findOne(collection, query);
    if (!doc) return null;
    await this.db.collection(collection).doc(doc._id).update({ data: patch });
    return this.findOne(collection, query);
  }

  async remove(collection, query) {
    const docs = await this.find(collection, query);
    for (const d of docs) {
      await this.db.collection(collection).doc(d._id).remove();
    }
    return docs.length;
  }
}

// ---------- 工厂 ----------
let instance = null;

function createStore() {
  if (instance) return instance;

  // 本地开发（LOCAL=1）或无法加载 wx-server-sdk 时，使用 JSON 文件适配器
  const isLocal = process.env.LOCAL === '1' || process.env.LOCAL === 'true';
  if (isLocal) {
    const file = process.env.CLOUD_DEV_DATA
      ? path.resolve(process.env.CLOUD_DEV_DATA)
      : path.join(__dirname, '..', '..', 'work', 'cloud-dev.json');
    instance = new LocalStore(file);
    return instance;
  }

  let cloud;
  try {
    // eslint-disable-next-line global-require
    cloud = require('wx-server-sdk');
  } catch (err) {
    // 云端必须能加载 wx-server-sdk；失败说明依赖未安装，直接抛出便于定位
    throw new Error(`无法加载 wx-server-sdk：${err.message}。请确认云函数 package.json 含 "wx-server-sdk": "~2.6.3" 并选择「云端安装依赖」后重新部署。`);
  }
  instance = new CloudStore(cloud, process.env.SCF_CLOUD_ENV);
  return instance;
}


  return { createStore, COLLECTIONS };
})();

// ===== security.js（内联） =====
const securityModule = (() => {
  const crypto = require('node:crypto');
// 安全原语：scrypt 密码哈希（Node 内置 crypto，无需第三方依赖）+ 会话 token。
'use strict';


const SCRYPT_KEYLEN = 64;
const TOKEN_BYTES = 32;
const SESSION_DAYS = 30;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

function sessionTtlMs() {
  return SESSION_DAYS * 24 * 60 * 60 * 1000;
}


  return { hashPassword, verifyPassword, generateToken, sessionTtlMs };
})();

// ===== routes/auth.js（内联） =====
const authModule = (() => {
// 账号接口：register / login / wx-login / me。
// 统一返回 { statusCode, data }，由入口层序列化。
'use strict';

const USERNAME_RE = /^[a-zA-Z0-9_\u4e00-\u9fa5]{2,20}$/;

function publicUser(user) {
  return {
    _id: user._id,
    username: user.username || null,
    nickname: user.nickname || '行远用户',
    created_at: user.created_at,
  };
}

function createAuthRoutes({ store, security, getOpenId }) {
  async function issueSession(userId, provider = 'password') {
    const token = security.generateToken();
    const session = await store.insert('sessions', {
      token,
      user_id: userId,
      provider,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + security.sessionTtlMs()).toISOString(),
    });
    return session.token;
  }

  async function register({ username, password, nickname }) {
    username = String(username || '').trim();
    password = String(password || '');
    if (!USERNAME_RE.test(username)) {
      return { statusCode: 400, data: { ok: false, error: '用户名需为 2-20 位字母、数字、下划线或中文' } };
    }
    if (password.length < 6) {
      return { statusCode: 400, data: { ok: false, error: '密码至少 6 位' } };
    }
    const existing = await store.findOne('users', { username });
    if (existing) {
      return { statusCode: 409, data: { ok: false, error: '用户名已被注册' } };
    }
    const user = await store.insert('users', {
      username,
      openid: null,
      nickname: (nickname || '').trim() || username,
      password_hash: security.hashPassword(password),
      created_at: new Date().toISOString(),
    });
    const token = await issueSession(user._id);
    return { statusCode: 200, data: { ok: true, token, user: publicUser(user) } };
  }

  async function login({ username, password }) {
    username = String(username || '').trim();
    password = String(password || '');
    const user = await store.findOne('users', { username });
    if (!user || !security.verifyPassword(password, user.password_hash)) {
      return { statusCode: 401, data: { ok: false, error: '用户名或密码错误' } };
    }
    const token = await issueSession(user._id);
    return { statusCode: 200, data: { ok: true, token, user: publicUser(user) } };
  }

  async function wxLogin({ code }) {
    if (!code) {
      return { statusCode: 400, data: { ok: false, error: '缺少 code' } };
    }
    const openid = await getOpenId(code);
    if (!openid) {
      return { statusCode: 401, data: { ok: false, error: '微信登录失败' } };
    }
    let user = await store.findOne('users', { openid });
    if (!user) {
      user = await store.insert('users', {
        username: null,
        openid,
        nickname: '微信用户',
        password_hash: null,
        created_at: new Date().toISOString(),
      });
    }
    const token = await issueSession(user._id, 'wx');
    return { statusCode: 200, data: { ok: true, token, user: publicUser(user), is_new: !user.username } };
  }

  async function me(user) {
    return { statusCode: 200, data: { ok: true, user: publicUser(user) } };
  }

  // 账号绑定：把当前 openid 身份关联到已有账号（web 端注册的用户名）。
  // 仅允许微信登录会话发起；账号密码登录（无论账号是否已绑定）都返回 400。
  async function bind(user, { username, password }) {
    if (user.provider !== 'wx') {
      return { statusCode: 400, data: { ok: false, error: '当前已是账号密码登录，无需绑定' } };
    }
    username = String(username || '').trim();
    password = String(password || '');
    const target = await store.findOne('users', { username });
    if (!target || !security.verifyPassword(password, target.password_hash)) {
      return { statusCode: 401, data: { ok: false, error: '用户名或密码错误' } };
    }
    if (target.openid && target.openid !== user.openid) {
      return { statusCode: 409, data: { ok: false, error: '该账号已绑定其他微信' } };
    }
    await store.update('users', { _id: target._id }, { openid: user.openid });
    const token = await issueSession(target._id, 'wx');
    return { statusCode: 200, data: { ok: true, token, user: publicUser(target) } };
  }

  return { register, login, wxLogin, me, bind };
}


  return { createAuthRoutes };
})();

// ===== routes/trips.js（内联） =====
const tripsModule = (() => {
// 行程接口：trips CRUD / join（分享码协作）/ share（owner 开关分享）/ members。
// 权限模型：owner 全权；editor 可读可改；未加入者 403。统一返回 { statusCode, data }。
'use strict';

const crypto = require('node:crypto');

const SHARE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 排除 0/O/1/I
const SHARE_CODE_LEN = 8;

function generateShareCode() {
  const bytes = crypto.randomBytes(SHARE_CODE_LEN);
  let code = '';
  for (let i = 0; i < SHARE_CODE_LEN; i += 1) {
    code += SHARE_CODE_ALPHABET[bytes[i] % SHARE_CODE_ALPHABET.length];
  }
  return code;
}

function publicTrip(trip, role) {
  return {
    _id: trip._id,
    name: trip.name,
    owner_id: trip.owner_id,
    data: trip.data || {},
    share_code: trip.share_code || null,
    share_enabled: !!trip.share_enabled,
    created_at: trip.created_at,
    updated_at: trip.updated_at,
    role,
  };
}

// 列表专用瘦身投影：不携带大体积 data（图片 Base64 可达 MB 级）
function tripSummary(trip, role) {
  return {
    _id: trip._id,
    name: trip.name,
    share_code: trip.share_code || null,
    share_enabled: !!trip.share_enabled,
    updated_at: trip.updated_at,
    role,
  };
}

function createTripsRoutes({ store }) {
  async function findMember(tripId, userId) {
    return store.findOne('trip_members', { trip_id: tripId, user_id: userId });
  }

  async function list(userId) {
    const members = await store.find('trip_members', { user_id: userId });
    const mine = [];
    const shared = [];
    for (const m of members) {
      const trip = await store.findOne('trips', { _id: m.trip_id });
      if (!trip) continue;
      if (m.role === 'owner') mine.push(tripSummary(trip, 'owner'));
      else shared.push(tripSummary(trip, 'editor'));
    }
    const byUpdated = (a, b) => String(b.updated_at).localeCompare(String(a.updated_at));
    mine.sort(byUpdated);
    shared.sort(byUpdated);
    return { statusCode: 200, data: { ok: true, trips: { mine, shared } } };
  }

  async function create(userId, { name, data }) {
    name = String(name || '').trim();
    if (!name) return { statusCode: 400, data: { ok: false, error: '行程名称不能为空' } };
    const now = new Date().toISOString();
    const trip = await store.insert('trips', {
      name,
      owner_id: userId,
      data: data && typeof data === 'object' ? data : {},
      share_code: null,
      share_enabled: false,
      created_at: now,
      updated_at: now,
    });
    await store.insert('trip_members', {
      trip_id: trip._id,
      user_id: userId,
      role: 'owner',
      joined_at: now,
    });
    return { statusCode: 200, data: { ok: true, trip: publicTrip(trip, 'owner') } };
  }

  async function get(userId, tripId) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权访问该行程' } };
    return { statusCode: 200, data: { ok: true, trip: publicTrip(trip, member.role) } };
  }

  async function update(userId, tripId, { name, data }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    const patch = { updated_at: new Date().toISOString() };
    if (name !== undefined) {
      if (!String(name).trim()) return { statusCode: 400, data: { ok: false, error: '行程名称不能为空' } };
      patch.name = String(name).trim();
    }
    if (data !== undefined) {
      if (!data || typeof data !== 'object') return { statusCode: 400, data: { ok: false, error: '行程数据格式错误' } };
      patch.data = data;
    }
    const saved = await store.update('trips', { _id: tripId }, patch);
    return { statusCode: 200, data: { ok: true, trip: publicTrip(saved, member.role) } };
  }

  async function remove(userId, tripId) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member || member.role !== 'owner') {
      return { statusCode: 403, data: { ok: false, error: '仅创建者可删除行程' } };
    }
    await store.remove('trips', { _id: tripId });
    await store.remove('trip_members', { trip_id: tripId });
    return { statusCode: 200, data: { ok: true } };
  }

  async function join(userId, { share_code }) {
    share_code = String(share_code || '').trim().toUpperCase();
    if (!share_code) return { statusCode: 400, data: { ok: false, error: '请输入分享码' } };
    const trip = await store.findOne('trips', { share_code, share_enabled: true });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '分享码无效或已关闭' } };
    let member = await findMember(trip._id, userId);
    if (!member) {
      member = await store.insert('trip_members', {
        trip_id: trip._id,
        user_id: userId,
        role: 'editor',
        joined_at: new Date().toISOString(),
      });
    }
    return { statusCode: 200, data: { ok: true, trip: publicTrip(trip, member.role) } };
  }

  async function share(userId, tripId, { enabled }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member || member.role !== 'owner') {
      return { statusCode: 403, data: { ok: false, error: '仅创建者可管理分享' } };
    }
    const wantEnabled = !!enabled;
    let shareCode = trip.share_code;
    if (wantEnabled) {
      for (let i = 0; i < 5 && !shareCode; i += 1) {
        const candidate = generateShareCode();
        const dup = await store.findOne('trips', { share_code: candidate });
        if (!dup) shareCode = candidate;
      }
      if (!shareCode) return { statusCode: 500, data: { ok: false, error: '分享码生成失败，请重试' } };
    } else {
      shareCode = null;
    }
    const saved = await store.update('trips', { _id: tripId }, { share_code: shareCode, share_enabled: wantEnabled });
    return { statusCode: 200, data: { ok: true, trip: publicTrip(saved, member.role) } };
  }

  async function members(userId, tripId) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权访问该行程' } };
    const rows = await store.find('trip_members', { trip_id: tripId });
    const list = [];
    for (const row of rows) {
      const u = await store.findOne('users', { _id: row.user_id });
      list.push({
        user_id: row.user_id,
        nickname: u ? u.nickname : '未知用户',
        role: row.role,
        joined_at: row.joined_at,
      });
    }
    return { statusCode: 200, data: { ok: true, members: list } };
  }

  // 轻量时间表：只返回 activeVersion 与其 schedule（避免小程序端回传大体积 data）
  async function getSchedule(userId, tripId) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权访问该行程' } };
    const data = trip.data || {};
    const versions = data.versions || {};
    const activeVersion = data.activeVersion || Object.keys(versions)[0] || null;
    const schedule = activeVersion && versions[activeVersion] ? versions[activeVersion].schedule || [] : [];
    return {
      statusCode: 200,
      data: {
        ok: true, name: trip.name, role: member.role, activeVersion, schedule,
        share_code: trip.share_code || null, share_enabled: !!trip.share_enabled,
        updated_at: trip.updated_at,
      },
    };
  }

  async function updateSchedule(userId, tripId, { schedule }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    if (!Array.isArray(schedule)) return { statusCode: 400, data: { ok: false, error: '时间表数据格式错误' } };
    const data = trip.data || {};
    const versions = data.versions || {};
    const activeVersion = data.activeVersion || Object.keys(versions)[0];
    if (!activeVersion || !versions[activeVersion]) {
      return { statusCode: 400, data: { ok: false, error: '行程数据异常（无活动计划）' } };
    }
    versions[activeVersion].schedule = schedule;
    versions[activeVersion].updatedAt = new Date().toISOString();
    const saved = await store.update('trips', { _id: tripId }, { data, updated_at: new Date().toISOString() });
    return { statusCode: 200, data: { ok: true, updated_at: saved.updated_at, count: schedule.length } };
  }

  // 轻量 plan 数据：locations 去照片/详情大字段，route polyline 降采样（防 callFunction 超限）
  function downsamplePolyline(str, step = 10) {
    if (typeof str !== 'string' || !str) return '';
    const parts = str.split(';');
    if (parts.length <= 240) return str;
    const sampled = [];
    for (let i = 0; i < parts.length; i += step) sampled.push(parts[i]);
    const last = parts[parts.length - 1];
    if (sampled[sampled.length - 1] !== last) sampled.push(last);
    return sampled.join(';');
  }
  const sanitizeLocation = loc => ({ id: loc.id, type: loc.type, name: loc.name, resolved: loc.resolved || null });
  const sanitizeRoute = r => ({
    id: r.id,
    name: r.name,
    amap: {
      distance: r.amap && r.amap.distance || 0,
      duration: r.amap && r.amap.duration || 0,
      tolls: r.amap && r.amap.tolls || 0,
      steps: ((r.amap && r.amap.steps) || []).map(s => ({ polyline: downsamplePolyline(s.polyline) })),
    },
  });
  function planIdFromName(name) {
    const slug = String(name || 'plan').trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '') || 'plan';
    return `${slug}-${crypto.randomBytes(4).toString('hex')}`;
  }
  function activeVersionOf(data) {
    const versions = data.versions || {};
    return data.activeVersion && versions[data.activeVersion] ? data.activeVersion : Object.keys(versions)[0] || null;
  }

  async function getPlan(userId, tripId) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权访问该行程' } };
    const data = trip.data || {};
    const versions = data.versions || {};
    const av = activeVersionOf(data);
    const plan = av ? versions[av] : null;
    return {
      statusCode: 200,
      data: {
        ok: true,
        name: trip.name,
        role: member.role,
        activeVersion: av,
        plans: (data.plans || []).map(p => ({ id: p.id, name: p.name })),
        plan: plan ? {
          name: plan.name || '',
          locations: (plan.locations || []).map(sanitizeLocation),
          routes: (plan.routes || []).map(sanitizeRoute),
        } : null,
        updated_at: trip.updated_at,
      },
    };
  }

  async function switchPlan(userId, tripId, { activeVersion }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    const data = trip.data || {};
    if (!activeVersion || !(data.versions || {})[activeVersion]) {
      return { statusCode: 400, data: { ok: false, error: '计划不存在' } };
    }
    await store.update('trips', { _id: tripId }, { data: { ...data, activeVersion }, updated_at: new Date().toISOString() });
    return { statusCode: 200, data: { ok: true, activeVersion } };
  }

  async function createPlan(userId, tripId, { name }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    name = String(name || '').trim();
    if (!name) return { statusCode: 400, data: { ok: false, error: '计划名称不能为空' } };
    const data = trip.data || {};
    const versions = data.versions || {};
    const av = activeVersionOf(data);
    const id = planIdFromName(name);
    versions[id] = {
      name, items: [], schedule: [], locations: [], routes: [], expenses: {},
      placeCategories: [], preferences: JSON.parse(JSON.stringify((av && versions[av] && versions[av].preferences) || {})),
      placeModelVersion: 1, routeLinkModeVersion: 1, planKey: id, updatedAt: new Date().toISOString(),
    };
    const plans = [...(data.plans || []), { id, name }];
    const newData = { ...data, activeVersion: id, plans, versions };
    await store.update('trips', { _id: tripId }, { data: newData, updated_at: new Date().toISOString() });
    return { statusCode: 200, data: { ok: true, activeVersion: id, plans: plans.map(p => ({ id: p.id, name: p.name })) } };
  }

  async function copyPlan(userId, tripId) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    const data = trip.data || {};
    const versions = data.versions || {};
    const av = activeVersionOf(data);
    if (!av || !versions[av]) return { statusCode: 400, data: { ok: false, error: '无活动计划' } };
    const base = versions[av];
    const id = planIdFromName(`${base.name} 副本`);
    versions[id] = { ...JSON.parse(JSON.stringify(base)), name: `${base.name} 副本`, planKey: id, updatedAt: new Date().toISOString() };
    const plans = [...(data.plans || []), { id, name: `${base.name} 副本` }];
    const newData = { ...data, activeVersion: id, plans, versions };
    await store.update('trips', { _id: tripId }, { data: newData, updated_at: new Date().toISOString() });
    return { statusCode: 200, data: { ok: true, activeVersion: id, plans: plans.map(p => ({ id: p.id, name: p.name })) } };
  }

  async function removePlan(userId, tripId, { id }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    const data = trip.data || {};
    const plans = (data.plans || []).filter(p => p.id !== id);
    if (plans.length === 0) return { statusCode: 400, data: { ok: false, error: '至少保留一个计划' } };
    const versions = { ...(data.versions || {}) };
    delete versions[id];
    const newData = {
      ...data, plans, versions,
      activeVersion: data.activeVersion === id ? plans[0].id : data.activeVersion,
    };
    await store.update('trips', { _id: tripId }, { data: newData, updated_at: new Date().toISOString() });
    return { statusCode: 200, data: { ok: true, activeVersion: newData.activeVersion, plans: plans.map(p => ({ id: p.id, name: p.name })) } };
  }

  // 轻量地点：仅返回编辑所需字段（photo/poiDetails 大字段不传输，更新时按 id 保留）
  async function getLocations(userId, tripId) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权访问该行程' } };
    const data = trip.data || {};
    const versions = data.versions || {};
    const av = activeVersionOf(data);
    const locations = av && versions[av] ? versions[av].locations || [] : [];
    return {
      statusCode: 200,
      data: { ok: true, activeVersion: av, locations: locations.map(l => ({ id: l.id, type: l.type, name: l.name, address: l.address || '', note: l.note || '', resolved: l.resolved || null })) },
    };
  }

  async function updateLocations(userId, tripId, { locations }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    if (!Array.isArray(locations)) return { statusCode: 400, data: { ok: false, error: '地点数据格式错误' } };
    const data = trip.data || {};
    const versions = data.versions || {};
    const av = activeVersionOf(data);
    if (!av || !versions[av]) return { statusCode: 400, data: { ok: false, error: '行程数据异常（无活动计划）' } };
    // 保留原有 photo/poiDetails 等大字段
    const previous = versions[av].locations || [];
    const merged = locations.map(l => {
      const old = previous.find(p => p.id === l.id) || {};
      return { ...old, ...l, resolved: l.resolved || old.resolved || null };
    });
    versions[av].locations = merged;
    versions[av].updatedAt = new Date().toISOString();
    await store.update('trips', { _id: tripId }, { data, updated_at: new Date().toISOString() });
    return { statusCode: 200, data: { ok: true, count: merged.length } };
  }

  // 轻量账本：独立账目（versions[av].expenses）
  async function getExpenses(userId, tripId) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权访问该行程' } };
    const data = trip.data || {};
    const versions = data.versions || {};
    const av = activeVersionOf(data);
    const expenses = av && versions[av] ? versions[av].expenses || [] : [];
    return { statusCode: 200, data: { ok: true, activeVersion: av, expenses } };
  }

  async function updateExpenses(userId, tripId, { expenses }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    if (!Array.isArray(expenses)) return { statusCode: 400, data: { ok: false, error: '账目数据格式错误' } };
    const data = trip.data || {};
    const versions = data.versions || {};
    const av = activeVersionOf(data);
    if (!av || !versions[av]) return { statusCode: 400, data: { ok: false, error: '行程数据异常（无活动计划）' } };
    versions[av].expenses = expenses;
    versions[av].updatedAt = new Date().toISOString();
    await store.update('trips', { _id: tripId }, { data, updated_at: new Date().toISOString() });
    return { statusCode: 200, data: { ok: true, count: expenses.length } };
  }

  return { list, create, get, update, remove, join, share, members, getSchedule, updateSchedule, getPlan, switchPlan, createPlan, copyPlan, removePlan, getLocations, updateLocations, getExpenses, updateExpenses };
}


  return { createTripsRoutes };
})();

// ===== routes/amap.js（内联） =====
const amapModule = (() => {
// 高德 / 天气查询路由：供网页端复用云开发公用域名。
// - 高德 Web 服务 Key 从环境变量 AMAP_WEB_SERVICE_KEY 读取（云端控制台配置，不落代码）
// - 天气优先和风（需 QWEATHER_API_KEY，可选），否则回退 Open-Meteo（免 Key）
// - 无新增 npm 依赖：请求用 node:https 实现；缓存为实例内内存 Map（云函数无持久磁盘）
// 统一返回 { statusCode, data }，与 trips.js 一致。
'use strict';

const https = require('node:https');

const PROVINCES = ['新疆', '西藏', '内蒙古', '宁夏', '广西', '北京', '上海', '天津', '重庆', '河北', '山西', '辽宁', '吉林', '黑龙江', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '海南', '四川', '贵州', '云南', '陕西', '甘肃', '青海', '台湾', '香港', '澳门'];

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, res => {
      let raw = '';
      res.setTimeout(15000, () => req.destroy(new Error('上游服务超时')));
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          resolve(data);
        } catch (error) {
          reject(new Error(`上游返回无效 JSON（HTTP ${res.statusCode}）`));
        }
      });
    });
    req.setTimeout(15000, () => req.destroy(new Error('上游服务超时')));
    req.on('error', error => reject(new Error(`上游服务请求失败：${error.message}`)));
  });
}

// 拼接完整地址：省市区县 + 地址 + 名称
const poiFullAddress = poi => {
  const base = `${poi.pname || ''}${poi.cityname || ''}${poi.adname || ''}${poi.address || ''}`.trim();
  const name = String(poi.name || '').trim();
  return name && !base.includes(name) ? `${base}${base ? '·' : ''}${name}` : (base || name);
};

// 同一 POI 名称/地址的候选打分（与网页端本地服务逻辑一致）
function scoreCandidate(poi, name, province, contextTokens) {
  const text = `${poi.name || ''}${poi.pname || ''}${poi.cityname || ''}${poi.adname || ''}${poi.address || ''}`;
  const publicPlaceIntent = /游客|景区|机场|车站|服务区|停车场|售票处|入口|出口/.test(name);
  const businessMismatch = publicPlaceIntent && /住宿服务|餐饮服务|购物服务/.test(poi.type || '') ? -40 : 0;
  const subtypeMismatch = !/停车场/.test(name) && /停车场/.test(`${poi.name || ''}${poi.type || ''}`) ? -18 : 0;
  const intentBonus = /游客/.test(name) && /游客中心|游客服务/.test(poi.name || '') && !/酒店|民宿|餐厅|商店/.test(poi.name || '') ? 24 : 0;
  const nameChars = new Set(String(name).replace(/[\s·()（）]/g, ''));
  const candidateChars = new Set(String(poi.name || '').replace(/[\s·()（）]/g, ''));
  const overlap = [...nameChars].filter(char => candidateChars.has(char)).length;
  const similarity = nameChars.size ? overlap / nameChars.size * 20 : 0;
  return contextTokens.reduce((total, token) => total + (text.includes(token) ? 8 : 0), 0)
    + (poi.name === name ? 20 : 0) + (poi.name && poi.name.includes(name) ? 8 : 0)
    + similarity + intentBonus + businessMismatch + subtypeMismatch;
}

function createAmapRoutes({ amapKey, qweatherKey }) {
  // 实例内内存缓存：同一点位只保留最新响应
  const cache = new Map();
  const MAX_CACHE = 800;
  const cachePointKey = (endpoint, params) => {
    if (endpoint.includes('/direction/')) return `route:${endpoint}:${params.origin || ''}|${params.destination || ''}|${params.waypoints || ''}`;
    if (endpoint === '/v3/place/text' || endpoint === '/v3/geocode/geo') return `geo:${endpoint}:${params.keywords || params.address || ''}|${params.city || ''}`;
    if (endpoint === '/v5/place/text') return `place:${params.keywords || ''}|${params.region || ''}`;
    return null;
  };

  async function amap(endpoint, params, { withMeta = false } = {}) {
    if (!amapKey) throw new Error('未配置 AMAP_WEB_SERVICE_KEY。请在云开发控制台为云函数 api 配置环境变量后重新部署。');
    const sortedParams = Object.fromEntries(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)));
    const cacheKey = `${endpoint}?${new URLSearchParams(sortedParams)}`;
    if (cache.has(cacheKey)) return withMeta ? { data: cache.get(cacheKey), cached: true } : cache.get(cacheKey);
    const query = new URLSearchParams({ key: amapKey, ...sortedParams });
    const data = await httpsGetJson(`https://restapi.amap.com${endpoint}?${query}`);
    if (data.status !== '1') throw new Error(data.info || '高德服务请求失败');
    const pointKey = cachePointKey(endpoint, params);
    if (pointKey) {
      for (const existing of [...cache.keys()]) {
        if (existing === cacheKey) continue;
        const [existingEndpoint, queryString] = existing.split('?');
        const existingParams = Object.fromEntries(new URLSearchParams(queryString || ''));
        if (cachePointKey(existingEndpoint, existingParams) === pointKey) cache.delete(existing);
      }
    }
    cache.set(cacheKey, data);
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    return withMeta ? { data, cached: false } : data;
  }

  // GET /api/geocode?address=&keyword=&city=
  async function geocode({ address, keyword, city } = {}) {
    address = String(address || '');
    keyword = keyword || address;
    const addressText = address;
    const province = PROVINCES.find(alias => addressText.includes(alias)) || '';
    const regions = [...addressText.matchAll(/([\u4e00-\u9fa5]{2,}?(?:自治区|自治州|地区|市|县|区))/g)].map(match => match[1]);
    if (province && !regions.some(region => region.includes(province))) regions.unshift(province);
    city = city || regions[regions.length - 1] || province || '';
    const contextTokens = [province, ...regions, ...addressText.split(/[\s,，省市县区州]+/).filter(token => token.length >= 3)].filter(Boolean);
    const poi = await amap('/v3/place/text', { keywords: addressText, city, citylimit: city ? 'true' : 'false', offset: '10', page: '1', extensions: 'base' });
    if (poi.pois && poi.pois.some(item => item.location)) {
      const candidates = poi.pois.filter(item => item.location).filter(item => {
        if (!province) return true;
        const text = `${item.pname || ''}${item.cityname || ''}${item.adname || ''}${item.address || ''}`;
        return text.includes(province) || (province === '新疆' && text.includes('新疆维吾尔自治区'));
      });
      const ordered = (candidates.length ? candidates : poi.pois.filter(item => item.location)).sort((a, b) => {
        const score = item => scoreCandidate(item, keyword, province, contextTokens);
        return score(b) - score(a);
      });
      if (!province || candidates.length) {
        return {
          statusCode: 200,
          data: {
            status: '1', info: 'OK', infocode: '10000', count: String(ordered.length),
            geocodes: ordered.map(item => ({ formatted_address: poiFullAddress(item), location: item.location, level: '兴趣点', name: item.name, type: item.type })),
          },
        };
      }
    }
    return { statusCode: 200, data: await amap('/v3/geocode/geo', { address, city: city || '' }) };
  }

  // GET /api/place-photos?name=&address=
  async function placePhotos({ name, address } = {}) {
    name = String(name || '').trim();
    address = String(address || '').trim();
    if (!name || !address) throw new Error('请提供地点名称和完整地址');
    const province = PROVINCES.find(alias => address.includes(alias)) || '';
    const city = [...address.matchAll(/([\u4e00-\u9fa5]{2,}?(?:自治区|自治州|地区|市|县|区))/g)].map(match => match[1]).slice(-1)[0] || province;
    const result = await amap('/v5/place/text', { keywords: address, region: city, city_limit: city ? 'true' : 'false', page_size: '10', page_num: '1', show_fields: 'business,photos' }, { withMeta: true });
    const { data } = result;
    const poiPhotos = poi => Array.isArray(poi.photos) ? poi.photos : (poi.photos && poi.photos.url ? [poi.photos] : []);
    const candidates = (data.pois || []).filter(poi => poiPhotos(poi).length).map(poi => {
      const text = `${poi.name || ''}${poi.pname || ''}${poi.cityname || ''}${poi.adname || ''}${poi.address || ''}`;
      const nameScore = [...new Set(name.replace(/[\s·()（）]/g, ''))].filter(char => (poi.name || '').includes(char)).length;
      return { poi, score: (poi.name === name ? 100 : poi.name && poi.name.includes(name) ? 45 : 0) + nameScore + (province && text.includes(province) ? 25 : 0) };
    }).sort((a, b) => b.score - a.score).slice(0, 3);
    const photos = candidates.flatMap(({ poi }) => poiPhotos(poi).slice(0, 4).map(photo => ({ url: photo.url, title: photo.title || poi.name || name, poiName: poi.name || name, address: poiFullAddress(poi) }))).filter(photo => photo.url);
    return { statusCode: 200, data: { photos: photos.slice(0, 8), cached: result.cached } };
  }

  // GET /api/place-details?name=&address=
  async function placeDetails({ name, address } = {}) {
    name = String(name || '').trim();
    address = String(address || '').trim();
    if (!name || !address) throw new Error('请提供地点名称和完整地址');
    const province = PROVINCES.find(alias => address.includes(alias)) || '';
    const city = [...address.matchAll(/([\u4e00-\u9fa5]{2,}?(?:自治区|自治州|地区|市|县|区))/g)].map(match => match[1]).slice(-1)[0] || province;
    const result = await amap('/v5/place/text', { keywords: address, region: city, city_limit: city ? 'true' : 'false', page_size: '10', page_num: '1', show_fields: 'business,photos' }, { withMeta: true });
    const { data } = result;
    const pois = data.pois || [];
    const ranked = pois.map(poi => {
      const text = `${poi.name || ''}${poi.pname || ''}${poi.cityname || ''}${poi.adname || ''}${poi.address || ''}`;
      const nameScore = [...new Set(name.replace(/[\s·()（）]/g, ''))].filter(char => (poi.name || '').includes(char)).length;
      return { poi, score: (poi.name === name ? 100 : poi.name && poi.name.includes(name) ? 45 : 0) + nameScore + (province && text.includes(province) ? 25 : 0) };
    }).sort((a, b) => b.score - a.score);
    const poi = ranked[0] && ranked[0].poi;
    if (!poi) throw new Error('高德未找到对应地点');
    const ext = poi.business || poi.biz_ext || {};
    const text = value => Array.isArray(value) ? value.filter(Boolean).join('、') : String(value || '');
    return {
      statusCode: 200,
      data: {
        poi: {
          id: poi.id || '', name: poi.name || name, intro: text(poi.intro || poi.description),
          openTime: text(ext.opentime_week || ext.opentime_today || poi.opentime_week || poi.opentime || poi.opening_hours),
          rating: text(ext.rating || poi.rating), referenceCost: text(ext.cost || poi.cost),
          tags: text(ext.keytag || ext.rectag || poi.tag || poi.alias), ticketPrice: text(poi.price || ext.price),
          address: poiFullAddress(poi), location: poi.location || '',
        },
        cached: result.cached,
      },
    };
  }

  // POST /api/route { origin, destination, waypoints, strategy, mode, city, cityd }
  async function calculateRoute(params = {}) {
    const { origin, destination, waypoints = [], strategy = '32', mode = 'driving', city, cityd } = params;
    if (!origin || !destination) throw new Error('起点和终点不能为空');
    const normalizePath = path => ({
      ...path,
      duration: path.duration || (path.cost && path.cost.duration) || '0',
      tolls: (path.cost && path.cost.tolls) || '0',
      toll_distance: (path.cost && path.cost.toll_distance) || '0',
      traffic_lights: (path.cost && path.cost.traffic_lights) || '0',
      steps: (path.steps || []).map(step => ({ ...step, distance: step.step_distance || step.distance || '0', polyline: step.polyline || '' })),
    });
    if (mode === 'walking') {
      if (waypoints.length) throw new Error('高德步行路线暂不支持途经点，请拆分为多个路程事件');
      const data = await amap('/v3/direction/walking', { origin, destination });
      const paths = (data.route && data.route.paths || []).map(normalizePath);
      if (!paths.length) throw new Error('高德没有返回可用步行路线');
      return { statusCode: 200, data: { ...data, route: { ...data.route, paths } } };
    }
    if (mode === 'bicycling') {
      if (waypoints.length) throw new Error('高德骑行路线暂不支持途经点，请拆分为多个路程事件');
      const data = await amap('/v4/direction/bicycling', { origin, destination });
      const paths = ((data.data && data.data.paths) || []).map(normalizePath);
      if (!paths.length || Number(data.errcode || 0) !== 0) throw new Error(data.errdetail || data.errmsg || '高德没有返回可用骑行路线');
      return { statusCode: 200, data: { ...data, route: { origin, destination, paths } } };
    }
    if (mode === 'transit') {
      if (waypoints.length) throw new Error('高德公共交通路线暂不支持途经点，请拆分为多个路程事件');
      if (!city) throw new Error('公共交通需要填写公交起点城市');
      const data = await amap('/v3/direction/transit/integrated', { origin, destination, city, ...(cityd ? { cityd } : {}), strategy: '0', extensions: 'all' });
      const transit = data.route && data.route.transits && data.route.transits[0];
      if (!transit) throw new Error('高德没有返回可用公共交通方案');
      const steps = (transit.segments || []).flatMap(segment => [
        ...((segment.walking && segment.walking.steps) || []),
        ...((segment.bus && segment.bus.buslines) || []).map(line => ({ instruction: line.name || '公共交通', road: line.name || '', distance: line.distance || '0', duration: line.duration || '0', polyline: line.polyline || '' })),
        ...(segment.railway && segment.railway.trip ? [{ instruction: segment.railway.trip, road: segment.railway.name || '铁路', distance: segment.railway.distance || '0', duration: segment.railway.time || '0', polyline: segment.railway.polyline || '' }] : []),
      ]).filter(step => step.polyline || step.distance);
      const distance = Number(transit.distance || steps.reduce((sum, step) => sum + Number(step.distance || 0), 0));
      const paths = [{ distance, duration: transit.duration || '0', tolls: transit.cost || '0', toll_distance: '0', steps }];
      return { statusCode: 200, data: { ...data, route: { ...data.route, paths } } };
    }
    const amapParams = { origin, destination, strategy, show_fields: 'cost,polyline' };
    if (waypoints.length) amapParams.waypoints = waypoints.join(';');
    const data = await amap('/v5/direction/driving', amapParams);
    const paths = (data.route && data.route.paths || []).map(normalizePath);
    if (!paths.length) throw new Error('高德没有返回可用驾车路线');
    return { statusCode: 200, data: { ...data, route: { ...data.route, paths } } };
  }

  // GET /api/weather?latitude=&longitude=&date=&time=
  async function weather({ latitude, longitude, date, time = '12:00' } = {}) {
    latitude = Number(latitude);
    longitude = Number(longitude);
    date = String(date || '');
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error('请提供地点坐标和行程日期');
    }
    const cacheKey = `${qweatherKey ? 'qweather' : 'open-meteo'}:${latitude.toFixed(4)},${longitude.toFixed(4)}:${date}:${time.slice(0, 2)}`;
    if (cache.has(cacheKey)) return { statusCode: 200, data: { ...cache.get(cacheKey), cached: true } };
    if (qweatherKey) {
      try {
        const qweather = await httpsGetJson(`https://devapi.qweather.com/v7/grid-weather/1h?${new URLSearchParams({ location: `${longitude},${latitude}`, key: qweatherKey })}`);
        const targetHour = `${date}T${time.slice(0, 2).padStart(2, '0')}`;
        const hourly = qweather.hourly && qweather.hourly.find(item => String(item.fxTime || '').startsWith(targetHour));
        if (qweather.code === '200' && hourly) {
          const result = {
            source: 'QWeather', latitude, longitude, time: hourly.fxTime, conditionText: hourly.text,
            temperature: Number(hourly.temp), apparentTemperature: Number(hourly.feelsLike), precipitationProbability: Number(hourly.pop), precipitation: Number(hourly.precip),
            windSpeed: Number(hourly.windSpeed), windGusts: Number(hourly.windGust), queriedAt: new Date().toISOString(),
          };
          cache.set(cacheKey, result);
          return { statusCode: 200, data: { ...result, cached: false } };
        }
      } catch { /* 和风不可用时使用下方全球格点备选 */ }
    }
    const query = new URLSearchParams({
      latitude: String(latitude), longitude: String(longitude), timezone: 'Asia/Shanghai', start_date: date, end_date: date,
      hourly: 'temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m',
    });
    const data = await httpsGetJson(`https://api.open-meteo.com/v1/forecast?${query}`);
    const hour = `${date}T${time.slice(0, 2).padStart(2, '0')}:00`;
    const index = data.hourly && data.hourly.time ? data.hourly.time.indexOf(hour) : -1;
    if (index < 0) throw new Error('该日期暂未提供逐小时天气预报；请临近出发时再查询');
    const result = {
      source: 'Open-Meteo', latitude: data.latitude, longitude: data.longitude, time: hour,
      temperature: data.hourly.temperature_2m && data.hourly.temperature_2m[index],
      apparentTemperature: data.hourly.apparent_temperature && data.hourly.apparent_temperature[index],
      precipitationProbability: data.hourly.precipitation_probability && data.hourly.precipitation_probability[index],
      precipitation: data.hourly.precipitation && data.hourly.precipitation[index],
      weatherCode: data.hourly.weather_code && data.hourly.weather_code[index],
      windSpeed: data.hourly.wind_speed_10m && data.hourly.wind_speed_10m[index],
      windGusts: data.hourly.wind_gusts_10m && data.hourly.wind_gusts_10m[index],
      queriedAt: new Date().toISOString(),
    };
    cache.set(cacheKey, result);
    return { statusCode: 200, data: { ...result, cached: false } };
  }

  // GET /api/preview-mode：云端无端口概念，按 UA 判断移动/桌面
  async function previewMode(headers = {}) {
    const ua = String(headers['user-agent'] || headers['User-Agent'] || '').toLowerCase();
    const isMobile = /mobile|android|iphone|ipad|phone|harmonyos/i.test(ua);
    return { statusCode: 200, data: { mode: isMobile ? 'mobile' : 'desktop' } };
  }

  return { geocode, placePhotos, placeDetails, calculateRoute, weather, previewMode };
}


  return { createAmapRoutes };
})();

// ===== index.js（主逻辑，require 已指向内联模块） =====
const { createStore } = storeModule;
const { createAuthRoutes } = authModule;
const { createTripsRoutes } = tripsModule;
const { createAmapRoutes } = amapModule;
const security = securityModule;

// 「行远途记」后端云函数入口。
// 同一份代码两种运行形态：
//   1. 本地开发：LOCAL=1 node index.js → 启动 HTTP 服务（默认 3100 端口），数据落在 work/cloud-dev.json
//   2. 微信云开发：导出 main，由云函数 HTTP 触发器调用，数据落在云数据库



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

if (require.main === module && (process.env.LOCAL === '1' || process.env.LOCAL === 'true')) {
  const port = Number(process.env.CLOUD_API_PORT || 3100);
  createServer().listen(port, () => {
    console.log(`[roadtrip-api] 本地云函数已启动: http://localhost:${port}`);
    console.log(`[roadtrip-api] 数据文件: ${process.env.CLOUD_DEV_DATA || 'work/cloud-dev.json'}（LOCAL 模式）`);
  });
}

// 供测试脚本使用
