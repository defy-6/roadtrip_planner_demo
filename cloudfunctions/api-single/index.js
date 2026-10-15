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
  const COLLECTIONS = ['users', 'sessions', 'trips', 'trip_members', 'trip_backups'];
// 数据访问层：本地 JSON 文件适配器（LOCAL=1 时用于开发测试）+ 微信云开发适配器。
// 两个实现暴露同一套异步接口：
//   findOne(collection, query) / find(collection, query)
//   insert(collection, doc) / update(collection, query, patch) / remove(collection, query)
//   updateIfMatches(collection, query, patch) → { updated, doc } 条件（乐观并发）更新
// query 为等值匹配对象；文档统一使用 _id 字符串主键。
//
// updateIfMatches 是"版本前置条件 + 写入"的原子载体：
//   - 本地 JSON 适配器：文件锁下重读、条件匹配，临时文件 fsync 后替换；
//     不以实例的旧内存作为权威，不作为云数据库多实例安全的替代。
//   - 云数据库适配器：where(...).update() 由数据库做单文档条件更新，
//     只有仍匹配 query（含 updated_at）时才写入，stats.updated === 0 即判定为版本冲突。

'use strict';

// Database payloads are JSON; remain compatible with older cloud Node runtimes.
const structuredClone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));


// ---------- 本地 JSON 适配器 ----------
class LocalStore {
  constructor(file) {
    this.file = path.resolve(file);
    this.data = {};
    for (const name of COLLECTIONS) this.data[name] = [];
    this._withLock(() => { if (!this._load()) this._persist(); });
  }

  _withLock(action) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const lock = `${this.file}.lock`;
    let descriptor;
    try { descriptor = fs.openSync(lock, 'wx', 0o600); }
    catch (error) {
      if (error.code === 'EEXIST') { error.code = 'LOCAL_STORE_BUSY'; error.message = '本地存储正在被另一进程使用，请重试；不会覆盖已有数据'; }
      throw error;
    }
    try { return action(); }
    finally { fs.closeSync(descriptor); fs.unlinkSync(lock); }
  }

  _refresh() { if (!this._load()) throw new Error('本地数据文件缺失，已停止写入，请恢复备份'); }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)
        || ['users', 'sessions', 'trips', 'trip_members'].some(name => !Array.isArray(raw[name]))
        || (raw.trip_backups !== undefined && !Array.isArray(raw.trip_backups))) {
        throw new Error('本地账号数据格式错误，已停止写入');
      }
      for (const name of COLLECTIONS) {
        if (Array.isArray(raw[name])) this.data[name] = raw[name];
      }
      this.data = { ...raw, ...this.data };
      return true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return false; // Only a genuinely absent database may be initialized.
    }
  }

  _persist(next = this.data) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    try {
      const descriptor = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(descriptor, JSON.stringify(next, null, 2), 'utf8'); fs.fsyncSync(descriptor); }
      finally { fs.closeSync(descriptor); }
      fs.renameSync(temporary, this.file);
    } catch (error) {
      try { fs.unlinkSync(temporary); } catch { /* only this attempt's temporary file */ }
      throw error;
    }
    this.data = next;
  }

  _matches(doc, query) {
    return Object.entries(query || {}).every(([k, v]) => doc[k] === v);
  }

  async findOne(collection, query) {
    this._refresh();
    return structuredClone(this.data[collection].find(d => this._matches(d, query)) || null);
  }

  async find(collection, query) {
    this._refresh();
    return structuredClone(this.data[collection].filter(d => this._matches(d, query)));
  }

  async insert(collection, doc) {
    return this._withLock(() => {
    this._refresh();
    const record = { _id: crypto.randomBytes(16).toString('hex'), ...doc };
    const next = structuredClone(this.data);
    next[collection].push(structuredClone(record));
    this._persist(next);
    return structuredClone(record);
    });
  }

  async update(collection, query, patch) {
    return this._withLock(() => {
    this._refresh();
    const next = structuredClone(this.data);
    const doc = next[collection].find(d => this._matches(d, query));
    if (!doc) return null;
    Object.assign(doc, patch);
    this._persist(next);
    return structuredClone(doc);
    });
  }

  // 条件更新：仅当文档仍匹配 query 时写入，否则返回 updated: 0（版本前置条件失败）。
  async updateIfMatches(collection, query, patch, related = []) {
    return this._withLock(() => {
    this._refresh();
    const next = structuredClone(this.data);
    const changes = [{ collection, query, patch }, ...related];
    const docs = changes.map(change => next[change.collection].find(d => this._matches(d, change.query)));
    if (docs.some(doc => !doc)) return { updated: 0, doc: null };
    changes.forEach((change, index) => {
      if (change.action === 'remove') next[change.collection] = next[change.collection].filter(doc => doc._id !== docs[index]._id);
      else if (change.action !== 'check') Object.assign(docs[index], structuredClone(change.patch));
    });
    this._persist(next);
    return { updated: 1, doc: structuredClone(docs[0]) };
    });
  }

  async remove(collection, query) {
    return this._withLock(() => {
    this._refresh();
    const next = structuredClone(this.data);
    const before = next[collection].length;
    next[collection] = next[collection].filter(d => !this._matches(d, query));
    const removed = before - next[collection].length;
    if (removed > 0) this._persist(next);
    return removed;
    });
  }

  async removeIfMatches(collection, query) { return this.remove(collection, query); }
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

  // 条件更新：由数据库原子执行，避免"先读后写"之间被其它实例/请求插入造成静默覆盖。
  // 注意：这里不使用进程内锁，多实例部署下唯一可靠的是数据库的单文档条件更新。
  async updateIfMatches(collection, query, patch, related = []) {
    const replacement = value => Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, item && typeof item === 'object' ? this.db.command.set(item) : item]));
    if (related.length || Object.values(query).some(value => value === undefined)) {
      try {
        const result = await this.db.runTransaction(async transaction => {
          const changes = [{ collection, query, patch }, ...related];
          const docs = [];
          for (const change of changes) {
            const result = await transaction.collection(change.collection).doc(change.query._id).get();
            const doc = Array.isArray(result.data) ? result.data[0] : result.data;
            if (!doc || !Object.entries(change.query).every(([key, value]) => doc[key] === value)) {
              const conflict = new Error('版本前置条件不匹配'); conflict.code = 'ATOMIC_CONFLICT'; throw conflict;
            }
            docs.push(doc);
          }
          for (const change of changes) {
            const target = transaction.collection(change.collection).doc(change.query._id);
            if (change.action === 'remove') await target.remove();
            else if (change.action !== 'check') await target.update({ data: replacement(change.patch) });
          }
          return { updated: 1, doc: { ...docs[0], ...structuredClone(patch) } };
        });
        return result.result || result;
      } catch (error) {
        if (error.code === 'ATOMIC_CONFLICT') return { updated: 0, doc: null };
        throw error;
      }
    }
    const before = await this.findOne(collection, query);
    if (!before) return { updated: 0, doc: null };
    const res = await this.db.collection(collection).where(query).update({ data: replacement(patch) });
    const updated = Number((res && res.stats && res.stats.updated) || 0);
    if (!updated) return { updated: 0, doc: null };
    // Return this commit's version, never a subsequent writer's version from a reread.
    return { updated, doc: { ...before, ...structuredClone(patch) } };
  }

  async removeIfMatches(collection, query) {
    const result = await this.db.collection(collection).where(query).remove();
    return Number(result.stats?.removed || 0);
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

const tripWriteSafetyModule = (() => {
'use strict';

function nextRevision(previous) {
  const prior = Date.parse(previous || '');
  return new Date(Math.max(Date.now(), Number.isFinite(prior) ? prior + 1 : 0)).toISOString();
}

function versionConflict(trip) {
  return { statusCode: 409, data: { ok: false, code: 'VERSION_CONFLICT',
    error: '云端数据已更新，本次修改未写入，请保留本地修改并核对后重试',
    current_updated_at: trip?.updated_at || '' } };
}

function guardVersion(trip, baseline) {
  if (!supportedSchema(trip.data || {})) return { statusCode: 409, data: { ok: false,
    code: 'SCHEMA_UNSUPPORTED', error: '当前客户端不支持该行程版本，已禁止降级写入' } };
  if (typeof baseline !== 'string' || !baseline.trim()) {
    return { statusCode: 428, data: { ok: false, code: 'VERSION_REQUIRED',
      error: '缺少读取时的版本，请升级客户端并重新读取；本次修改未写入' } };
  }
  return baseline !== trip.updated_at ? versionConflict(trip) : null;
}

function libraryChange(user, locations) {
  return { collection: 'users', query: { _id: user._id, place_library_revision: user.place_library_revision },
    patch: { place_library: JSON.parse(JSON.stringify(locations)),
      place_library_revision: Number(user.place_library_revision || 0) + 1 } };
}

function supportedSchema(data) {
  const supported = value => value?.schemaVersion === undefined
    || (Number.isInteger(Number(value.schemaVersion)) && Number(value.schemaVersion) >= 0 && Number(value.schemaVersion) <= 4);
  return supported(data) && Object.values(data?.versions || {}).every(supported);
}

function hasPlannerData(data) {
  const snapshot = value => value && (Array.isArray(value.schedule) || Array.isArray(value.items));
  return Boolean(snapshot(data) || Object.values(data?.versions || {}).some(snapshot));
}


return { nextRevision, versionConflict, guardVersion, libraryChange, supportedSchema, hasPlannerData };
})();
// ===== backup-format.js（内联） =====
const backupFormatModule = (() => {
  const { supportedSchema } = tripWriteSafetyModule;
  const crypto = require('node:crypto');
// 旅行备份格式（纯规则）：不访问数据库、网络、DOM 或 wx，便于在 node --test 中直接验证。
//
// 备份范围（完整行程，而非"当前方案 JSON"）：
//   - 行程文档 trip.data（全部方案 plans/versions、事件 schedule、费用 expenses、
//     方案地点 locations 及其 photo/poiDetails、路线 routes、偏好 preferences、自定义类别 placeCategories）
//   - 账号通用地点库 place_library（跨行程复用，且携带 photo/poiDetails 等大字段）
//   - 资源清单 assets（明确区分"已内嵌图片"与"仅网络 URL"，不得把网络链接说成已完整保存图片）
//
// 完整性：integrity = sha256(stableStringify({ data, place_library }))，键排序后序列化，
// 因此备份在不同存储/不同字段顺序下仍能校验一致。


// 备份信封格式版本。恢复时若遇到更高版本一律拒绝，禁止降级重写。
const BACKUP_FORMAT_VERSION = 1;

function stableStringify(value) {
  const seen = new WeakSet();
  const walk = input => {
    if (input === null || typeof input !== 'object') return input;
    if (seen.has(input)) return null;
    seen.add(input);
    if (Array.isArray(input)) return input.map(walk);
    return Object.keys(input).sort().reduce((acc, key) => { acc[key] = walk(input[key]); return acc; }, {});
  };
  return JSON.stringify(walk(value));
}

function computeIntegrity(payload) {
  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

// 资源清单：递归统计 photo 字段，区分内嵌（data:）与网络链接（http(s):）。
function summarizeAssets(...roots) {
  const photos = { total: 0, embedded: 0, remote: 0, other: 0 };
  const seen = new WeakSet();
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { node.forEach(walk); return; }
    Object.entries(node).forEach(([key, value]) => {
      if (key === 'photo' && typeof value === 'string' && value) {
        photos.total += 1;
        if (value.startsWith('data:')) photos.embedded += 1;
        else if (/^https?:\/\//i.test(value)) photos.remote += 1;
        else photos.other += 1;
      } else if (value && typeof value === 'object') {
        walk(value);
      }
    });
  };
  roots.forEach(walk);
  const notes = [];
  if (photos.remote > 0) notes.push(`${photos.remote} 张地点图片仅保存了网络链接，无法离线还原图片本体`);
  if (photos.other > 0) notes.push(`${photos.other} 张图片引用来源未知`);
  return { photos, notes, images_fully_embedded: photos.remote === 0 && photos.other === 0 };
}

function sourceVersionOf(data = {}, tripUpdatedAt = '') {
  return {
    updated_at: tripUpdatedAt || data.updatedAt || '',
    schema_version: Number(data.schemaVersion || 0) || null,
    event_category_version: Number(data.eventCategoryVersion || 0) || null,
    place_model_version: Number(data.placeModelVersion || 0) || null,
    route_link_mode_version: Number(data.routeLinkModeVersion || 0) || null,
  };
}

// 生成备份信封。data 必须为行程文档数据；placeLibrary 为账号通用地点库。
function buildBackupEnvelope({ data, placeLibrary = [], createdBy = '', createdAt, tripName = '', planName = '', sequence = 0, tripUpdatedAt = '' }) {
  const payload = { data: clone(data) || {}, place_library: clone(placeLibrary) || [] };
  return {
    format_version: BACKUP_FORMAT_VERSION,
    source: sourceVersionOf(payload.data, tripUpdatedAt),
    created_at: createdAt || new Date().toISOString(),
    created_by: createdBy,
    sequence,
    trip_name: tripName,
    plan_name: planName,
    data: payload.data,
    place_library: payload.place_library,
    assets: summarizeAssets(payload.data, payload.place_library),
    integrity: computeIntegrity(payload),
  };
}

// 校验信封本身：格式版本可识别、完整性匹配。
function verifyBackupEnvelope(backup) {
  if (!backup || typeof backup !== 'object') return { ok: false, reason: '备份记录缺失或格式不正确' };
  const version = Number(backup.format_version || 0);
  if (!version) return { ok: false, reason: '该备份缺少格式版本，无法安全校验（可能是旧版或损坏的记录）' };
  if (version > BACKUP_FORMAT_VERSION) {
    return { ok: false, reason: `备份格式版本 ${version} 高于当前支持的 ${BACKUP_FORMAT_VERSION}，禁止降级重写，请先升级应用` };
  }
  if (!backup.integrity) return { ok: false, reason: '该备份缺少完整性校验值，无法确认内容未被破坏' };
  const expected = computeIntegrity({ data: backup.data || {}, place_library: backup.place_library || [] });
  if (expected !== backup.integrity) return { ok: false, reason: '备份完整性校验失败，内容可能已损坏，已拒绝恢复' };
  return { ok: true, format_version: version };
}

const PLACE_REF_KEYS = ['locationId', 'departurePlaceId', 'stopoverPlaceId', 'arrivalPlaceId', 'originPlaceId', 'destinationPlaceId'];
const EVENT_REF_KEYS = ['locationId'];

// 结构 + 关联校验。
// 返回 { ok, errors, linkIssues, warnings }：
//   - errors：结构性问题，任何情况下都禁止恢复（损坏/空方案集/格式错误）。
//   - linkIssues：关联缺失（地点/路线引用悬空），默认禁止恢复，仅在用户显式确认后允许忽略。
function validateBackupContent(data, placeLibrary = []) {
  const errors = [];
  const linkIssues = [];
  const warnings = [];
  if (!supportedSchema(data)) errors.push('当前客户端不支持备份中的行程 schema 版本，禁止降级恢复');
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ['行程数据不是有效对象'], linkIssues, warnings };
  }
  const versions = data.versions;
  if (!versions || typeof versions !== 'object' || Array.isArray(versions)) {
    errors.push('备份缺少方案集合（versions），无法恢复');
  } else if (Object.keys(versions).length === 0) {
    errors.push('备份中的方案集合为空，恢复会清空行程');
  }
  if (data.plans !== undefined && !Array.isArray(data.plans)) errors.push('方案列表（plans）格式错误');
  if (Array.isArray(data.plans)) {
    const ids = new Set(Object.keys(versions || {}));
    const missing = data.plans.map(plan => plan?.id).filter(id => id && !ids.has(id));
    if (missing.length) errors.push(`方案列表引用了不存在的方案快照：${missing.slice(0, 3).join('、')}`);
  }
  if (data.activeVersion && versions && typeof versions === 'object' && !versions[data.activeVersion]) {
    errors.push(`当前方案 ${data.activeVersion} 在备份中不存在`);
  }

  const libraryIds = new Set((Array.isArray(placeLibrary) ? placeLibrary : []).map(place => place?.id).filter(Boolean));

  Object.entries(versions && typeof versions === 'object' ? versions : {}).forEach(([planKey, version]) => {
    if (!version || typeof version !== 'object') { errors.push(`方案 ${planKey} 的快照格式错误`); return; }
    if (version.schedule !== undefined && !Array.isArray(version.schedule)) errors.push(`方案 ${planKey} 的时间表格式错误`);
    if (version.expenses !== undefined && !Array.isArray(version.expenses)) errors.push(`方案 ${planKey} 的费用数据格式错误`);
    if (version.placeCategories !== undefined && !Array.isArray(version.placeCategories)) errors.push(`方案 ${planKey} 的地点类别格式错误`);
    if (version.preferences !== undefined && (typeof version.preferences !== 'object' || Array.isArray(version.preferences))) errors.push(`方案 ${planKey} 的偏好设置格式错误`);
    if (version.routes !== undefined && !Array.isArray(version.routes)) errors.push(`方案 ${planKey} 的路线数据格式错误`);
    if (version.locations !== undefined && !Array.isArray(version.locations)) errors.push(`方案 ${planKey} 的地点数据格式错误`);

    const planLocationIds = new Set((Array.isArray(version.locations) ? version.locations : []).map(place => place?.id).filter(Boolean));
    const known = new Set([...planLocationIds, ...libraryIds]);
    const routeIds = new Set([...(Array.isArray(version.routes) ? version.routes : []), ...(Array.isArray(data.routes) ? data.routes : [])].map(route => route?.id).filter(Boolean));

    const missingLocations = new Set();
    const missingRoutes = new Set();
    (Array.isArray(version.schedule) ? version.schedule : []).forEach(event => {
      if (!event || typeof event !== 'object') return;
      const collect = target => {
        if (!target || typeof target !== 'object') return;
        [
          ...EVENT_REF_KEYS.map(key => target[key]),
          ...PLACE_REF_KEYS.map(key => target.flightInfo?.[key]),
          ...PLACE_REF_KEYS.map(key => target.routeLinks?.[key]),
          ...PLACE_REF_KEYS.map(key => target.routeInfo?.[key]),
        ].forEach(id => { if (id && !known.has(id)) missingLocations.add(String(id)); });
        (target.routeLinks?.viaPlaceIds || []).forEach(id => { if (id && !known.has(id)) missingLocations.add(String(id)); });
        const routeId = target.routeLinks?.routeId;
        if (routeId && !routeIds.has(routeId)) missingRoutes.add(String(routeId));
      };
      collect(event);
    });
    if (missingLocations.size) {
      linkIssues.push(`方案 ${planKey} 有 ${missingLocations.size} 个关联地点在备份中缺失：${[...missingLocations].slice(0, 3).join('、')}`);
    }
    if (missingRoutes.size) {
      linkIssues.push(`方案 ${planKey} 有 ${missingRoutes.size} 条关联路线在备份中缺失：${[...missingRoutes].slice(0, 3).join('、')}`);
    }
  });

  if (!errors.length && !libraryIds.size) warnings.push('备份未包含账号通用地点库，恢复后我的地点库保持原样');
  return { ok: errors.length === 0 && linkIssues.length === 0, errors, linkIssues, warnings };
}


  return { BACKUP_FORMAT_VERSION, stableStringify, computeIntegrity, summarizeAssets, sourceVersionOf, buildBackupEnvelope, verifyBackupEnvelope, validateBackupContent };
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
  const backupFormat = backupFormatModule;
  const { nextRevision, versionConflict, guardVersion, libraryChange, supportedSchema, hasPlannerData } = tripWriteSafetyModule;
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
    share_readonly: !!trip.share_readonly,
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
    share_readonly: !!trip.share_readonly,
    updated_at: trip.updated_at,
    role,
  };
}

function createTripsRoutes({ store }) {
  const canonicalEventCategory = type => ({ service: 'supply', fuel: 'supply', flight: 'transport' }[type] || type || 'spot');

  function normalizeEventCategories(data) {
    if (!data || typeof data !== 'object') return { data, changed: false };
    const next = JSON.parse(JSON.stringify(data));
    let changed = next.eventCategoryVersion !== 1;
    const normalizeList = list => {
      if (!Array.isArray(list)) return;
      list.forEach(event => {
        if (!event || typeof event !== 'object') return;
        const category = canonicalEventCategory(event.type);
        if (event.category !== category) { event.category = category; changed = true; }
      });
    };
    normalizeList(next.schedule);
    normalizeList(next.items);
    Object.values(next.versions || {}).forEach(version => {
      normalizeList(version?.schedule);
      normalizeList(version?.items);
    });
    next.eventCategoryVersion = 1;
    return { data: next, changed };
  }

  async function migrateTripEventCategories(trip) {
    if (!supportedSchema(trip?.data || {})) return trip;
    const normalized = normalizeEventCategories(trip?.data || {});
    if (!trip || !normalized.changed) return trip;
    // 目录迁移是尽力而为的内部修复：条件更新失败（并发写入抢先）不报错，下次读取再迁移。
    const migration = await store.updateIfMatches('trips', { _id: trip._id, updated_at: trip.updated_at }, { data: normalized.data, updated_at: nextRevision(trip.updated_at) });
    return migration.doc || { ...trip, data: normalized.data };
  }

  async function accountPlaceLibrary(userId, legacyLocations = [], attempt = 0) {
    const user = await store.findOne('users', { _id: userId });
    if (!user) return [];
    // 账号本人每次打开旧行程时增量承接该行程遗留的顶层地点，支持多个旧行程逐步迁移；
    // 协作者传入空数组，因此不会继承行程所有者的私有库。
    const library = JSON.parse(JSON.stringify(Array.isArray(user.place_library) ? user.place_library : []));
    const ids = new Set(library.map(place => place?.id).filter(Boolean));
    let changed = !Array.isArray(user.place_library);
    (legacyLocations || []).forEach(place => {
      if (!place?.id || ids.has(place.id)) return;
      library.push(JSON.parse(JSON.stringify(place))); ids.add(place.id); changed = true;
    });
    let revision = Number(user.place_library_revision || 0);
    if (changed) {
      const change = libraryChange(user, library);
      const saved = await store.updateIfMatches('users', change.query, change.patch);
      if (!saved.updated) {
        if (attempt < 3) return accountPlaceLibrary(userId, legacyLocations, attempt + 1);
        throw new Error('地点库正在更新，请重试读取');
      }
      revision = change.patch.place_library_revision;
    }
    Object.defineProperty(library, 'revision', { value: revision });
    return library;
  }

  async function findMember(tripId, userId) {
    return store.findOne('trip_members', { trip_id: tripId, user_id: userId });
  }

  // ---------- 版本前置条件与冲突契约（网页 / 小程序 / 后端一致） ----------
  // 业务码 VERSION_CONFLICT + HTTP 409；所有写入入口都必须带可核对的版本前置条件。
  // 关键字：
  //   - 不能只靠客户端"先 GET 再 PUT"：服务端把"版本检查 + 写入"合并为一次条件更新（原子）。
  //   - 客户端带 baseUpdatedAt 时，与当前版本不一致即冲突（检测"基于旧版本覆盖"）。
  //   - 旧客户端不带读取基线必须拒绝（428），不能用服务端当前版本替旧草稿背书。
  async function commitTrip(tripId, expectedUpdatedAt, patch, related = []) {
    return store.updateIfMatches(
      'trips',
      { _id: tripId, updated_at: expectedUpdatedAt },
      { ...patch, updated_at: nextRevision(expectedUpdatedAt) },
      related,
    );
  }

  // 统一的版本前置条件入口：先快速失败，再用条件更新保证原子。

  async function list(userId) {
    const members = await store.find('trip_members', { user_id: userId });
    const mine = [];
    const shared = [];
    for (const m of members) {
      const trip = await store.findOne('trips', { _id: m.trip_id });
      if (!trip) continue;
      if (m.role === 'owner') mine.push(tripSummary(trip, 'owner'));
      else shared.push(tripSummary(trip, m.role));
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
      data: normalizeEventCategories(data && typeof data === 'object' ? data : {}).data,
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

  // 递归把 data 中所有 photo URL 转 https（web 端通过 GET /trips/:id 加载完整 data，Mixed Content 修复）
  function sanitizePhotos(data) {
    if (!data || typeof data !== 'object') return data;
    if (Array.isArray(data)) { data.forEach(sanitizePhotos); return data; }
    Object.entries(data).forEach(([k, v]) => {
      if (k === 'photo' && typeof v === 'string') data[k] = v.replace(/^http:\/\//, 'https://');
      else if (v && typeof v === 'object') sanitizePhotos(v);
    });
    return data;
  }

  async function get(userId, tripId) {
    let trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权访问该行程' } };
    trip = await migrateTripEventCategories(trip);
    const tripOut = publicTrip(trip, member.role);
    // publicTrip 与底层 store 共享 data 引用；本地 JSON store 的 findOne 返回的是活对象，
    // 直接改写会把"注入给客户端的通用地点库"回写进行程文档。这里先深拷贝再加工。
    tripOut.data = JSON.parse(JSON.stringify(tripOut.data || {}));
    tripOut.data = sanitizePhotos(tripOut.data);
    tripOut.data.locations = await accountPlaceLibrary(userId, member.role === 'owner' ? tripOut.data.locations : []);
    tripOut.place_library_revision = tripOut.data.locations.revision;
    return { statusCode: 200, data: { ok: true, trip: tripOut } };
  }

  async function update(userId, tripId, { name, data, preserve_large_fields: preserveLargeFields, baseUpdatedAt, baseLibraryRevision }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    if (member && member.role === 'viewer') return { statusCode: 403, data: { ok: false, error: '只读分享，无法编辑' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;

    const patch = {};
    const related = [];
    if (name !== undefined) {
      if (!String(name).trim()) return { statusCode: 400, data: { ok: false, error: '行程名称不能为空' } };
      patch.name = String(name).trim();
    }
    if (data !== undefined) {
      if (!data || typeof data !== 'object') return { statusCode: 400, data: { ok: false, error: '行程数据格式错误' } };
      if (!supportedSchema(data) || (hasPlannerData(trip.data) && !hasPlannerData(data))) return { statusCode: 400,
        data: { ok: false, code: 'INVALID_PLANNER_DATA', error: '写入会丢失方案或使用不支持的数据版本，已拒绝' } };
      const accountLocations = Array.isArray(data.locations) ? data.locations : null;
      if (accountLocations) {
        const user = await store.findOne('users', { _id: userId });
        if (!user || baseLibraryRevision !== Number(user.place_library_revision || 0)) return versionConflict(trip);
        related.push(libraryChange(user, accountLocations));
      }
      delete data.locations;
      if (preserveLargeFields) {
        const previousData = trip.data || {};
        data.routes = previousData.routes || [];
        Object.entries(data.versions || {}).forEach(([versionId, version]) => {
          const previous = previousData.versions?.[versionId] || {};
          version.schedule = previous.schedule || [];
          version.locations = previous.locations || [];
          version.routes = previous.routes || [];
          version.expenses = previous.expenses || [];
          version.placeCategories = previous.placeCategories || [];
        });
      }
      patch.data = normalizeEventCategories(data).data;
    }
    const saved = await commitTrip(tripId, baseUpdatedAt, patch, related);
    if (!saved.updated) return versionConflict(trip);
    return { statusCode: 200, data: { ok: true, trip: publicTrip(saved.doc, member.role),
      ...(related.length ? { place_library_revision: related[0].patch.place_library_revision } : {}) } };
  }

  async function remove(userId, tripId, { baseUpdatedAt, base_updated_at: baseUpdatedAtSnake } = {}) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member || member.role !== 'owner') {
      return { statusCode: 403, data: { ok: false, error: '仅创建者可删除行程' } };
    }
    // 删除同样受版本前置条件约束：基于旧版本的删除不得静默执行。
    const conflict = guardVersion(trip, baseUpdatedAt || baseUpdatedAtSnake);
    if (conflict) return conflict;
    const removed = await store.removeIfMatches('trips', { _id: tripId, updated_at: baseUpdatedAt || baseUpdatedAtSnake });
    if (!removed) return versionConflict(await store.findOne('trips', { _id: tripId }) || trip);
    await store.remove('trip_members', { trip_id: tripId });
    await store.remove('trip_backups', { trip_id: tripId });
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
        role: trip.share_readonly ? 'viewer' : 'editor',
        joined_at: new Date().toISOString(),
      });
    }
    return { statusCode: 200, data: { ok: true, trip: publicTrip(trip, member.role) } };
  }

  async function share(userId, tripId, { enabled, readonly, baseUpdatedAt }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member || member.role !== 'owner') {
      return { statusCode: 403, data: { ok: false, error: '仅创建者可管理分享' } };
    }
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;
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
    // 新分享码默认只读；拥有者可在协作者加入后单独授予编辑权限。
    const saved = await commitTrip(tripId, baseUpdatedAt || trip.updated_at, { share_code: shareCode, share_enabled: wantEnabled, share_readonly: wantEnabled ? readonly !== false : false });
    if (!saved.updated) return versionConflict(trip);
    return { statusCode: 200, data: { ok: true, trip: publicTrip(saved.doc, member.role), updated_at: saved.doc.updated_at } };
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
        nickname: u ? (u.nickname || u.username) : '未知用户',
        username: u ? u.username : '',
        role: row.role,
        joined_at: row.joined_at,
      });
    }
    return { statusCode: 200, data: { ok: true, members: list } };
  }

  async function updateMember(userId, tripId, { user_id: targetUserId, role, baseUpdatedAt }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const owner = await findMember(tripId, userId);
    if (!owner || owner.role !== 'owner') return { statusCode: 403, data: { ok: false, error: '仅创建者可管理协作者权限' } };
    if (!['editor', 'viewer'].includes(role)) return { statusCode: 400, data: { ok: false, error: '权限只能设置为可编辑或只读' } };
    const target = await findMember(tripId, String(targetUserId || ''));
    if (!target) return { statusCode: 404, data: { ok: false, error: '协作者不存在' } };
    if (target.role === 'owner') return { statusCode: 400, data: { ok: false, error: '不能修改创建者权限' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;
    const saved = await commitTrip(tripId, baseUpdatedAt, {}, [{ collection: 'trip_members',
      query: { _id: target._id, role: target.role }, patch: { role } }]);
    if (!saved.updated) return versionConflict(trip);
    return { statusCode: 200, data: { ok: true, member: { user_id: target.user_id, role }, updated_at: saved.doc.updated_at } };
  }

  async function removeMember(userId, tripId, { user_id: targetUserId, baseUpdatedAt }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const owner = await findMember(tripId, userId);
    if (!owner || owner.role !== 'owner') return { statusCode: 403, data: { ok: false, error: '仅创建者可移除协作者' } };
    const target = await findMember(tripId, String(targetUserId || ''));
    if (!target) return { statusCode: 404, data: { ok: false, error: '协作者不存在' } };
    if (target.role === 'owner') return { statusCode: 400, data: { ok: false, error: '不能移除创建者' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;
    const saved = await commitTrip(tripId, baseUpdatedAt, {}, [{ collection: 'trip_members',
      query: { _id: target._id, role: target.role }, action: 'remove' }]);
    if (!saved.updated) return versionConflict(trip);
    return { statusCode: 200, data: { ok: true, updated_at: saved.doc.updated_at } };
  }

  // ---------- 旅行备份（完整行程，而非"当前方案 JSON"） ----------
  // 备份只写入 trip_backups 集合（仅行程成员可读），不写入任何公开目录/静态资源。
  // 完整范围 = trip.data（全部方案/事件/费用/方案地点/路线/偏好/类别）+ 账号通用地点库 + 资源清单。
  async function nextBackupSequence(tripId) {
    const rows = await store.find('trip_backups', { trip_id: tripId });
    return Math.max(0, ...rows.map(row => Number(row.sequence || 0))) + 1;
  }

  async function insertBackupEnvelope({ tripId, userId, trip, library, now }) {
    const data = JSON.parse(JSON.stringify(trip.data || {}));
    const active = data.activeVersion && data.versions?.[data.activeVersion];
    const envelope = backupFormat.buildBackupEnvelope({
      data,
      placeLibrary: Array.isArray(library) ? library : [],
      createdBy: userId,
      createdAt: now,
      tripName: trip.name || '',
      planName: active?.name || '',
      sequence: await nextBackupSequence(tripId),
      tripUpdatedAt: trip.updated_at || '',
    });
    return store.insert('trip_backups', { trip_id: tripId, ...envelope });
  }

  async function pruneBackups(tripId, keep = 3) {
    const rows = await store.find('trip_backups', { trip_id: tripId });
    const newest = rows.sort((a, b) => Number(b.sequence || 0) - Number(a.sequence || 0) || String(b.created_at).localeCompare(String(a.created_at)));
    for (const stale of newest.slice(keep)) await store.remove('trip_backups', { _id: stale._id });
    return newest.slice(0, keep);
  }

  async function listBackups(userId, tripId) {
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权访问该行程' } };
    const rows = await store.find('trip_backups', { trip_id: tripId });
    const backups = rows.sort((a, b) => Number(b.sequence || 0) - Number(a.sequence || 0) || String(b.created_at).localeCompare(String(a.created_at))).slice(0, 3).map(row => ({
      _id: row._id,
      created_at: row.created_at,
      created_by: row.created_by,
      plan_name: row.plan_name || '',
      trip_name: row.trip_name || '',
      format_version: Number(row.format_version || 0),
      source_updated_at: (row.source && row.source.updated_at) || '',
      assets: row.assets || null,
    }));
    return { statusCode: 200, data: { ok: true, backups } };
  }

  async function createBackup(userId, tripId) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member || member.role === 'viewer') return { statusCode: 403, data: { ok: false, error: '无权备份该行程' } };
    const now = new Date().toISOString();
    // 账号通用地点库只随"本人"归档：协作者不应把行程遗留地点并入自己的库。
    const library = member.role === 'owner' ? await accountPlaceLibrary(userId, trip.data?.locations) : [];
    const backup = await insertBackupEnvelope({ tripId, userId, trip, library, now });
    await pruneBackups(tripId, 3);
    const warnings = [];
    if (member.role !== 'owner') warnings.push('由协作者创建的备份不包含行程创建者的通用地点库');
    return {
      statusCode: 200,
      data: {
        ok: true,
        backup: {
          _id: backup._id,
          created_at: backup.created_at,
          plan_name: backup.plan_name,
          format_version: backup.format_version,
          source: backup.source,
          assets: backup.assets,
        },
        warnings,
      },
    };
  }

  async function restoreBackup(userId, tripId, { backup_id: backupId, allow_missing_links: allowMissingLinks, baseUpdatedAt } = {}) {
    const owner = await findMember(tripId, userId);
    if (!owner || owner.role !== 'owner') return { statusCode: 403, data: { ok: false, error: '仅创建者可恢复备份' } };
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;
    const backup = await store.findOne('trip_backups', { _id: String(backupId || ''), trip_id: tripId });
    if (!backup) return { statusCode: 404, data: { ok: false, error: '备份不存在' } };

    // 1) 信封校验：格式版本可识别 + 完整性匹配；未知更高版本禁止降级重写。
    const envelope = backupFormat.verifyBackupEnvelope(backup);
    if (!envelope.ok) return { statusCode: 409, data: { ok: false, code: 'BACKUP_UNVERIFIED', error: envelope.reason } };

    // 2) 结构与关联校验：损坏备份一律拒绝；关联缺失需用户显式确认后才可忽略。
    const content = backupFormat.validateBackupContent(backup.data || {}, backup.place_library || []);
    if (content.errors.length) {
      return { statusCode: 409, data: { ok: false, code: 'BACKUP_INVALID', error: `备份校验未通过：${content.errors.slice(0, 2).join('；')}`, errors: content.errors } };
    }
    if (content.linkIssues.length && !allowMissingLinks) {
      return { statusCode: 409, data: { ok: false, code: 'BACKUP_LINK_MISSING', error: `备份中存在关联缺失：${content.linkIssues.slice(0, 2).join('；')}。请确认后再恢复。`, link_issues: content.linkIssues } };
    }

    // 3) 恢复前保护当前数据：先落一份"恢复前快照"，任何失败都不会破坏原数据且可回退。
    const now = new Date().toISOString();
    const currentLibrary = await accountPlaceLibrary(userId, trip.data?.locations);
    const guard = await insertBackupEnvelope({ tripId, userId, trip, library: currentLibrary, now });

    // 4) 应用备份：store.update 仅在找到记录时写入；失败时原数据保持不变。
    const patch = { data: JSON.parse(JSON.stringify(backup.data || {})) };
    if (backup.trip_name) patch.name = backup.trip_name;
    let saved;
    try {
      const user = await store.findOne('users', { _id: userId });
      const related = Array.isArray(backup.place_library) && user && backup.created_by === userId ? [libraryChange(user, backup.place_library)] : [];
      const committed = await commitTrip(tripId, baseUpdatedAt, patch, related);
      if (!committed.updated) return versionConflict(await store.findOne('trips', { _id: tripId }) || trip);
      saved = committed.doc;
    } catch (error) {
      return { statusCode: 500, data: { ok: false, code: 'RESTORE_FAILED', error: `恢复失败，原行程数据保持不变：${error.message}`, guard_backup_id: guard._id } };
    }

    // 5) 通用地点库单独恢复；失败只降级为警告，并如实反馈（部分成功不谎报全成功）。
    const warnings = [...(content.warnings || [])];
    if (backup.created_by !== userId) warnings.push('该备份由其他协作者创建，仅恢复共享行程，不替换本人的私人地点库');
    if (content.linkIssues.length) warnings.push(...content.linkIssues.map(issue => `已按确认忽略：${issue}`));
    await pruneBackups(tripId, 3);
    return { statusCode: 200, data: { ok: true, trip: publicTrip(saved, owner.role), guard_backup_id: guard._id, warnings } };
  }

  // 轻量时间表：只返回 activeVersion 与其 schedule（避免小程序端回传大体积 data）
  async function getSchedule(userId, tripId) {
    let trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权访问该行程' } };
    trip = await migrateTripEventCategories(trip);
    const data = trip.data || {};
    const versions = data.versions || {};
    const activeVersion = data.activeVersion || Object.keys(versions)[0] || null;
    let schedule = activeVersion && versions[activeVersion] ? versions[activeVersion].schedule || [] : [];
    // 轨迹 polyline 降采样（避免大行程超 callFunction 限制）
    schedule = schedule.map(e => {
      const pl = e.routeInfo && Array.isArray(e.routeInfo.polyline) ? e.routeInfo.polyline : null;
      if (!pl || pl.length <= 240) return e;
      const sampled = pl.filter((_, i) => i % 10 === 0 || i === pl.length - 1);
      return { ...e, routeInfo: { ...e.routeInfo, polyline: sampled } };
    });
    return {
      statusCode: 200,
      data: {
        ok: true, name: trip.name, role: member.role, activeVersion, schedule,
        share_code: trip.share_code || null, share_enabled: !!trip.share_enabled, share_readonly: !!trip.share_readonly,
        updated_at: trip.updated_at,
      },
    };
  }

  async function updateSchedule(userId, tripId, { schedule, baseUpdatedAt }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    // 读取后立即固化版本字符串：LocalStore 的 findOne 返回活对象，任何 await 后的再次读取
    // 都可能已被并发写入改写，导致"基于旧版本写入"被误判为可写。
    const expectedUpdatedAt = String(baseUpdatedAt || trip.updated_at || '');
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    if (member && member.role === 'viewer') return { statusCode: 403, data: { ok: false, error: '只读分享，无法编辑' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;

    if (!Array.isArray(schedule)) return { statusCode: 400, data: { ok: false, error: '时间表数据格式错误' } };
    const data = JSON.parse(JSON.stringify(trip.data || {}));
    const versions = data.versions || {};
    const activeVersion = data.activeVersion || Object.keys(versions)[0];
    if (!activeVersion || !versions[activeVersion]) {
      return { statusCode: 400, data: { ok: false, error: '行程数据异常（无活动计划）' } };
    }
    versions[activeVersion].schedule = schedule.map(event => ({ ...event, category: canonicalEventCategory(event?.type) }));
    data.eventCategoryVersion = 1;
    versions[activeVersion].updatedAt = new Date().toISOString();
    const saved = await commitTrip(tripId, expectedUpdatedAt, { data });
    if (!saved.updated) return versionConflict(trip);
    return { statusCode: 200, data: { ok: true, updated_at: saved.doc.updated_at, count: schedule.length } };
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

  async function switchPlan(userId, tripId, { activeVersion, baseUpdatedAt }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    if (member && member.role === 'viewer') return { statusCode: 403, data: { ok: false, error: '只读分享，无法编辑' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;

    const data = trip.data || {};
    if (!activeVersion || !(data.versions || {})[activeVersion]) {
      return { statusCode: 400, data: { ok: false, error: '计划不存在' } };
    }
    const saved = await commitTrip(tripId, baseUpdatedAt || trip.updated_at, { data: { ...data, activeVersion } });
    if (!saved.updated) return versionConflict(trip);
    return { statusCode: 200, data: { ok: true, activeVersion, updated_at: saved.doc.updated_at } };
  }

  async function createPlan(userId, tripId, { name, baseUpdatedAt }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    if (member && member.role === 'viewer') return { statusCode: 403, data: { ok: false, error: '只读分享，无法编辑' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;

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
    const saved = await commitTrip(tripId, baseUpdatedAt || trip.updated_at, { data: newData });
    if (!saved.updated) return versionConflict(trip);
    return { statusCode: 200, data: { ok: true, activeVersion: id, plans: plans.map(p => ({ id: p.id, name: p.name })), updated_at: saved.doc.updated_at } };
  }

  async function copyPlan(userId, tripId, { baseUpdatedAt } = {}) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    if (member && member.role === 'viewer') return { statusCode: 403, data: { ok: false, error: '只读分享，无法编辑' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;

    const data = trip.data || {};
    const versions = data.versions || {};
    const av = activeVersionOf(data);
    if (!av || !versions[av]) return { statusCode: 400, data: { ok: false, error: '无活动计划' } };
    const base = versions[av];
    const id = planIdFromName(`${base.name} 副本`);
    versions[id] = { ...JSON.parse(JSON.stringify(base)), name: `${base.name} 副本`, planKey: id, updatedAt: new Date().toISOString() };
    const plans = [...(data.plans || []), { id, name: `${base.name} 副本` }];
    const newData = { ...data, activeVersion: id, plans, versions };
    const saved = await commitTrip(tripId, baseUpdatedAt || trip.updated_at, { data: newData });
    if (!saved.updated) return versionConflict(trip);
    return { statusCode: 200, data: { ok: true, activeVersion: id, plans: plans.map(p => ({ id: p.id, name: p.name })), updated_at: saved.doc.updated_at } };
  }

  async function removePlan(userId, tripId, { id, baseUpdatedAt }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    if (member && member.role === 'viewer') return { statusCode: 403, data: { ok: false, error: '只读分享，无法编辑' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;

    const data = trip.data || {};
    const plans = (data.plans || []).filter(p => p.id !== id);
    if (plans.length === 0) return { statusCode: 400, data: { ok: false, error: '至少保留一个计划' } };
    const versions = { ...(data.versions || {}) };
    delete versions[id];
    const newData = {
      ...data, plans, versions,
      activeVersion: data.activeVersion === id ? plans[0].id : data.activeVersion,
    };
    const saved = await commitTrip(tripId, baseUpdatedAt || trip.updated_at, { data: newData });
    if (!saved.updated) return versionConflict(trip);
    return { statusCode: 200, data: { ok: true, activeVersion: newData.activeVersion, plans: plans.map(p => ({ id: p.id, name: p.name })), updated_at: saved.doc.updated_at } };
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
      data: { ok: true, activeVersion: av, locations: locations.map(l => ({ id: l.id, type: l.type, name: l.name, address: l.address || '', note: l.note || '', resolved: l.resolved || null, photo: String(l.photo || '').replace(/^http:\/\//, 'https://'), poiDetails: l.poiDetails || null })) },
    };
  }

  async function updateLocations(userId, tripId, { locations, deleted = [], baseUpdatedAt }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const expectedUpdatedAt = String(baseUpdatedAt || trip.updated_at || '');
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    if (member && member.role === 'viewer') return { statusCode: 403, data: { ok: false, error: '只读分享，无法编辑' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;

    if (!Array.isArray(locations)) return { statusCode: 400, data: { ok: false, error: '地点数据格式错误' } };
    const data = JSON.parse(JSON.stringify(trip.data || {}));
    const versions = data.versions || {};
    const av = activeVersionOf(data);
    if (!av || !versions[av]) return { statusCode: 400, data: { ok: false, error: '行程数据异常（无活动计划）' } };
    // 增量合并：发送来的地点按 id 覆盖/新增，未发送的保留；deleted 中的 id 被移除。
    // 前端可只发“新增/变更”的地点，避免每次保存都全量重传所有地点图片。
    const previous = versions[av].locations || [];
    const byId = new Map(previous.map(p => [p.id, p]));
    const deleteSet = new Set(Array.isArray(deleted) ? deleted.filter(Boolean) : []);
    locations.forEach(l => {
      if (!l?.id || deleteSet.has(l.id)) return;
      const old = byId.get(l.id) || {};
      byId.set(l.id, { ...old, ...l, resolved: l.resolved || old.resolved || null });
    });
    const merged = [...byId.values()].filter(p => !deleteSet.has(p.id));
    versions[av].locations = merged;
    versions[av].updatedAt = new Date().toISOString();
    const saved = await commitTrip(tripId, expectedUpdatedAt, { data });
    if (!saved.updated) return versionConflict(trip);
    return { statusCode: 200, data: { ok: true, updated_at: saved.doc.updated_at, count: merged.length } };
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

  async function updateExpenses(userId, tripId, { expenses, schedule, baseUpdatedAt }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const expectedUpdatedAt = String(baseUpdatedAt || trip.updated_at || '');
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    if (member && member.role === 'viewer') return { statusCode: 403, data: { ok: false, error: '只读分享，无法编辑' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;

    if (!Array.isArray(expenses)) return { statusCode: 400, data: { ok: false, error: '账目数据格式错误' } };
    if (schedule !== undefined && !Array.isArray(schedule)) return { statusCode: 400, data: { ok: false, error: '关联事件数据格式错误' } };
    const data = JSON.parse(JSON.stringify(trip.data || {}));
    const versions = data.versions || {};
    const av = activeVersionOf(data);
    if (!av || !versions[av]) return { statusCode: 400, data: { ok: false, error: '行程数据异常（无活动计划）' } };
    versions[av].expenses = expenses;
    if (schedule !== undefined) versions[av].schedule = schedule;
    versions[av].updatedAt = new Date().toISOString();
    const saved = await commitTrip(tripId, expectedUpdatedAt, { data });
    if (!saved.updated) return versionConflict(trip);
    return { statusCode: 200, data: { ok: true, updated_at: saved.doc.updated_at, count: expenses.length } };
  }

  // 我的地点库（users.place_library，账号下跨行程复用且不向协作者公开）
  async function getUniversal(userId, tripId) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权访问该行程' } };
    const universal = await accountPlaceLibrary(userId, member.role === 'owner' ? trip.data?.locations : []);
    return {
      statusCode: 200,
      data: { ok: true, locations: universal.map(l => ({ id: l.id, type: l.type, name: l.name, address: l.address || '' })) },
    };
  }

  // 把账号“我的地点库”地点添加到当前行程方案（保留 photo/poiDetails 等大字段）
  async function addUniversalToPlan(userId, tripId, { locationId, baseUpdatedAt }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const expectedUpdatedAt = String(baseUpdatedAt || trip.updated_at || '');
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    if (member && member.role === 'viewer') return { statusCode: 403, data: { ok: false, error: '只读分享，无法编辑' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;

    const data = JSON.parse(JSON.stringify(trip.data || {}));
    const library = await accountPlaceLibrary(userId, member.role === 'owner' ? data.locations : []);
    const source = library.find(l => l.id === locationId);
    if (!source) return { statusCode: 404, data: { ok: false, error: '我的地点库中不存在该地点' } };
    const versions = data.versions || {};
    const av = activeVersionOf(data);
    if (!av || !versions[av]) return { statusCode: 400, data: { ok: false, error: '行程数据异常（无活动计划）' } };
    const planLocs = versions[av].locations || [];
    if (!planLocs.some(l => l.id === source.id)) {
      planLocs.push({ ...JSON.parse(JSON.stringify(source)) });
      versions[av].locations = planLocs;
      versions[av].updatedAt = new Date().toISOString();
      const saved = await commitTrip(tripId, expectedUpdatedAt, { data });
      if (!saved.updated) return versionConflict(trip);
      return { statusCode: 200, data: { ok: true, updated_at: saved.doc.updated_at } };
    }
    return { statusCode: 200, data: { ok: true, updated_at: trip.updated_at } };
  }

  // 自定义地点类别（versions[av].placeCategories）
  async function getCategories(userId, tripId) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权访问该行程' } };
    const data = trip.data || {};
    const versions = data.versions || {};
    const av = activeVersionOf(data);
    const categories = av && versions[av] ? versions[av].placeCategories || [] : [];
    return { statusCode: 200, data: { ok: true, categories } };
  }

  async function updateCategories(userId, tripId, { categories, baseUpdatedAt }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const expectedUpdatedAt = String(baseUpdatedAt || trip.updated_at || '');
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    if (member && member.role === 'viewer') return { statusCode: 403, data: { ok: false, error: '只读分享，无法编辑' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;

    if (!Array.isArray(categories)) return { statusCode: 400, data: { ok: false, error: '类别数据格式错误' } };
    const data = JSON.parse(JSON.stringify(trip.data || {}));
    const versions = data.versions || {};
    const av = activeVersionOf(data);
    if (!av || !versions[av]) return { statusCode: 400, data: { ok: false, error: '行程数据异常（无活动计划）' } };
    versions[av].placeCategories = categories;
    versions[av].updatedAt = new Date().toISOString();
    const saved = await commitTrip(tripId, expectedUpdatedAt, { data });
    if (!saved.updated) return versionConflict(trip);
    return { statusCode: 200, data: { ok: true, updated_at: saved.doc.updated_at, count: categories.length } };
  }

  // 导出完整 JSON 到云存储（返回 fileID，小程序下载/分享；避免 callFunction 数据量限制）
  async function exportJson(userId, tripId) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权访问该行程' } };
    try {
      const cloud = require('wx-server-sdk');
      cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
      const safeName = String(trip.name || '行程').replace(/[^\w\u4e00-\u9fa5-]+/g, '_');
      const up = await cloud.uploadFile({
        cloudPath: `exports/${tripId}-${Date.now()}-${safeName}.json`,
        fileContent: Buffer.from(JSON.stringify(trip.data || {}, null, 2), 'utf8'),
      });
      return { statusCode: 200, data: { ok: true, fileID: up.fileID } };
    } catch (err) {
      return { statusCode: 500, data: { ok: false, error: `导出失败：${err.message}` } };
    }
  }

  // 轻量路线（web 端保存拆分用，避免单文档超限）
  async function getRoutes(userId, tripId) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权访问该行程' } };
    const data = trip.data || {};
    const versions = data.versions || {};
    const av = activeVersionOf(data);
    const routes = av && versions[av] ? versions[av].routes || [] : [];
    return { statusCode: 200, data: { ok: true, routes } };
  }

  async function updateRoutes(userId, tripId, { routes, baseUpdatedAt }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const expectedUpdatedAt = String(baseUpdatedAt || trip.updated_at || '');
    const member = await findMember(tripId, userId);
    if (!member || member.role === 'viewer') return { statusCode: 403, data: { ok: false, error: member && member.role === 'viewer' ? '只读分享，无法编辑' : '无权编辑该行程' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;
    if (!Array.isArray(routes)) return { statusCode: 400, data: { ok: false, error: '路线数据格式错误' } };
    const data = JSON.parse(JSON.stringify(trip.data || {}));
    const versions = data.versions || {};
    const av = activeVersionOf(data);
    if (!av || !versions[av]) return { statusCode: 400, data: { ok: false, error: '行程数据异常（无活动计划）' } };
    versions[av].routes = routes;
    versions[av].updatedAt = new Date().toISOString();
    const saved = await commitTrip(tripId, expectedUpdatedAt, { data });
    if (!saved.updated) return versionConflict(trip);
    return { statusCode: 200, data: { ok: true, updated_at: saved.doc.updated_at, count: routes.length } };
  }

  async function updateRoute(userId, tripId, { route, baseUpdatedAt }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const expectedUpdatedAt = String(baseUpdatedAt || trip.updated_at || '');
    const member = await findMember(tripId, userId);
    if (!member || member.role === 'viewer') return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;
    if (!route || typeof route !== 'object' || !String(route.id || '').trim()) {
      return { statusCode: 400, data: { ok: false, error: '路线数据格式错误' } };
    }
    const routeId = String(route.id);
    const data = JSON.parse(JSON.stringify(trip.data || {}));
    const av = activeVersionOf(data);
    if (!av || !data.versions?.[av]) return { statusCode: 400, data: { ok: false, error: '行程数据异常（无活动计划）' } };
    const upsert = list => {
      const next = Array.isArray(list) ? [...list] : [];
      const index = next.findIndex(item => String(item?.id) === routeId);
      if (index >= 0) next[index] = route;
      else next.push(route);
      return next;
    };
    data.versions[av].routes = upsert(data.versions[av].routes);
    data.routes = upsert(data.routes);
    const saved = await commitTrip(tripId, expectedUpdatedAt, { data });
    if (!saved.updated) return versionConflict(trip);
    return { statusCode: 200, data: { ok: true, updated_at: saved.doc.updated_at, route_id: routeId } };
  }

  async function syncRoutes(userId, tripId, { routeIds, baseUpdatedAt }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const expectedUpdatedAt = String(baseUpdatedAt || trip.updated_at || '');
    const member = await findMember(tripId, userId);
    if (!member || member.role === 'viewer') return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;
    if (!Array.isArray(routeIds)) return { statusCode: 400, data: { ok: false, error: '路线 ID 格式错误' } };
    const ids = new Set(routeIds.map(String));
    const data = JSON.parse(JSON.stringify(trip.data || {}));
    const av = activeVersionOf(data);
    if (!av || !data.versions?.[av]) return { statusCode: 400, data: { ok: false, error: '行程数据异常（无活动计划）' } };
    const retain = routes => (routes || []).filter(route => ids.has(String(route?.id)));
    data.versions[av].routes = retain(data.versions[av].routes);
    data.routes = retain(data.routes);
    const saved = await commitTrip(tripId, expectedUpdatedAt, { data });
    if (!saved.updated) return versionConflict(trip);
    return { statusCode: 200, data: { ok: true, updated_at: saved.doc.updated_at, count: ids.size } };
  }

  return { list, create, get, update, remove, join, share, members, updateMember, removeMember, listBackups, createBackup, restoreBackup, getSchedule, updateSchedule, getPlan, switchPlan, createPlan, copyPlan, removePlan, getLocations, updateLocations, getExpenses, updateExpenses, getUniversal, addUniversalToPlan, getCategories, updateCategories, exportJson, getRoutes, updateRoutes, updateRoute, syncRoutes };
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

function httpsGetImage(url, redirects = 0) {
  const parsed = new URL(String(url || ''));
  const allowed = parsed.protocol === 'https:' && (parsed.hostname.endsWith('.autonavi.com') || parsed.hostname.endsWith('.amap.com'));
  if (!allowed) return Promise.reject(new Error('只允许读取高德地图资源'));
  return new Promise((resolve, reject) => {
    const req = https.get(parsed, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 3) {
        res.resume(); resolve(httpsGetImage(new URL(res.headers.location, parsed).href, redirects + 1)); return;
      }
      const type = String(res.headers['content-type'] || '').split(';')[0];
      if (res.statusCode !== 200 || !type.startsWith('image/')) { res.resume(); reject(new Error(`地图图片读取失败（HTTP ${res.statusCode}）`)); return; }
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 2 * 1024 * 1024) req.destroy(new Error('地图图片超过 2MB')); else chunks.push(chunk); });
      res.on('end', () => resolve({ type, buffer: Buffer.concat(chunks) }));
    });
    req.setTimeout(12000, () => req.destroy(new Error('地图图片读取超时')));
    req.on('error', reject);
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

  const localMinute = value => {
    const match = /T(\d{2}):(\d{2})/.exec(String(value || ''));
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const daylight = (time, sunrise, sunset) => {
    const clock = localMinute(`T${String(time || '12:00').slice(0, 5)}`), rise = localMinute(sunrise), set = localMinute(sunset);
    return clock === null || rise === null || set === null ? null : clock >= rise && clock < set;
  };
  async function qweatherSun(latitude, longitude, date) {
    const key = `sun:${Number(latitude).toFixed(2)},${Number(longitude).toFixed(2)}:${date}`;
    if (cache.has(key)) return cache.get(key);
    try {
      const query = new URLSearchParams({ location: `${Number(longitude).toFixed(2)},${Number(latitude).toFixed(2)}`, date: date.replaceAll('-', ''), key: qweatherKey });
      const data = await httpsGetJson(`https://devapi.qweather.com/v7/astronomy/sun?${query}`);
      const result = data.code === '200' ? { sunrise: data.sunrise || null, sunset: data.sunset || null } : { sunrise: null, sunset: null };
      cache.set(key, result); return result;
    } catch { return { sunrise: null, sunset: null }; }
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

  async function mapImage({ url } = {}) {
    const image = await httpsGetImage(url);
    return { statusCode: 200, data: { dataUrl: `data:${image.type};base64,${image.buffer.toString('base64')}` } };
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
          const sun = await qweatherSun(latitude, longitude, date);
          const isDay = daylight(time, sun.sunrise, sun.sunset);
          const result = {
            source: 'QWeather', provider: 'qweather', latitude, longitude, time: hourly.fxTime,
            conditionCode: String(hourly.icon || ''), conditionText: hourly.text, isNight: isDay === null ? null : !isDay,
            sunrise: sun.sunrise, sunset: sun.sunset,
            temperature: Number(hourly.temp), apparentTemperature: Number(hourly.feelsLike), precipitationProbability: Number(hourly.pop), precipitation: Number(hourly.precip),
            humidity: Number(hourly.humidity), pressure: Number(hourly.pressure), visibility: Number(hourly.vis), cloudCover: Number(hourly.cloud), dewPoint: Number(hourly.dew),
            windDirection: hourly.windDir || '', windDirectionDegree: Number(hourly.wind360), windSpeed: Number(hourly.windSpeed), windGusts: Number(hourly.windGust), queriedAt: new Date().toISOString(),
          };
          cache.set(cacheKey, result);
          return { statusCode: 200, data: { ...result, cached: false } };
        }
      } catch { /* 和风不可用时使用下方全球格点备选 */ }
    }
    const query = new URLSearchParams({
      latitude: String(latitude), longitude: String(longitude), timezone: 'Asia/Shanghai', start_date: date, end_date: date,
      hourly: 'temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m',
      daily: 'sunrise,sunset',
    });
    const data = await httpsGetJson(`https://api.open-meteo.com/v1/forecast?${query}`);
    const hour = `${date}T${time.slice(0, 2).padStart(2, '0')}:00`;
    const index = data.hourly && data.hourly.time ? data.hourly.time.indexOf(hour) : -1;
    if (index < 0) throw new Error('该日期暂未提供逐小时天气预报；请临近出发时再查询');
    const result = {
      source: 'Open-Meteo', provider: 'open-meteo', latitude: data.latitude, longitude: data.longitude, time: hour,
      conditionCode: String((data.hourly.weather_code && data.hourly.weather_code[index]) ?? ''),
      temperature: data.hourly.temperature_2m && data.hourly.temperature_2m[index],
      apparentTemperature: data.hourly.apparent_temperature && data.hourly.apparent_temperature[index],
      precipitationProbability: data.hourly.precipitation_probability && data.hourly.precipitation_probability[index],
      precipitation: data.hourly.precipitation && data.hourly.precipitation[index],
      weatherCode: data.hourly.weather_code && data.hourly.weather_code[index],
      windSpeed: data.hourly.wind_speed_10m && data.hourly.wind_speed_10m[index],
      windGusts: data.hourly.wind_gusts_10m && data.hourly.wind_gusts_10m[index],
      queriedAt: new Date().toISOString(),
    };
    result.sunrise = data.daily?.sunrise?.[0] || null; result.sunset = data.daily?.sunset?.[0] || null;
    const isDay = daylight(time, result.sunrise, result.sunset); result.isNight = isDay === null ? null : !isDay;
    cache.set(cacheKey, result);
    return { statusCode: 200, data: { ...result, cached: false } };
  }

  // GET /api/preview-mode：云端无端口概念，按 UA 判断移动/桌面
  async function previewMode(headers = {}) {
    const ua = String(headers['user-agent'] || headers['User-Agent'] || '').toLowerCase();
    const isMobile = /mobile|android|iphone|ipad|phone|harmonyos/i.test(ua);
    return { statusCode: 200, data: { mode: isMobile ? 'mobile' : 'desktop' } };
  }

  return { geocode, placePhotos, placeDetails, mapImage, calculateRoute, weather, previewMode };
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

    // 本地文件接口在云端兜底：返回空数据（旧版前端未登录也会请求，避免 404 报错）
    if (resource === 'planner-data') {
      if (method === 'GET' || method === 'PUT') return { statusCode: 200, data: { data: null, savedAt: new Date().toISOString() } };
    }

    // 网页端复用：高德/天气查询（GET 取 query，路线取 body）与预览模式。
    // 公网域名暴露时高德类接口必须登录，防止未授权消耗配额。
    if (['geocode', 'place-photos', 'place-details', 'map-image', 'route', 'weather'].includes(resource)) {
      if (!user) return { statusCode: 401, data: { ok: false, error: '未登录' } };
    }
    try {
      if (resource === 'geocode') return await amap.geocode({ ...query, ...(body && typeof body === 'object' ? body : {}) });
      if (resource === 'place-photos') return await amap.placePhotos({ ...query, ...(body && typeof body === 'object' ? body : {}) });
      if (resource === 'place-details') return await amap.placeDetails({ ...query, ...(body && typeof body === 'object' ? body : {}) });
      if (resource === 'map-image') return await amap.mapImage({ ...query, ...(body && typeof body === 'object' ? body : {}) });
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
      if (action === 'plans' && sub === 'copy' && method === 'POST') return trips.copyPlan(user._id, id, body);
      if (action === 'plans' && method === 'POST') return trips.createPlan(user._id, id, body);
      if (action === 'plans' && method === 'DELETE') return trips.removePlan(user._id, id, body);
      // 地点 / 账本轻量接口
      if (action === 'locations' && method === 'GET') return trips.getLocations(user._id, id);
      if (action === 'locations' && method === 'PUT') return trips.updateLocations(user._id, id, body);
      if (action === 'expenses' && method === 'GET') return trips.getExpenses(user._id, id);
      if (action === 'expenses' && method === 'PUT') return trips.updateExpenses(user._id, id, body);
      // 轻量路线（web 保存拆分）
      if (action === 'routes' && method === 'GET') return trips.getRoutes(user._id, id);
      if (action === 'routes' && sub === 'sync' && method === 'PUT') return trips.syncRoutes(user._id, id, body);
      if (action === 'routes' && sub === 'item' && method === 'PUT') return trips.updateRoute(user._id, id, body);
      if (action === 'routes' && method === 'PUT') return trips.updateRoutes(user._id, id, body);
      // 通用地点库
      if (action === 'universal' && method === 'GET') return trips.getUniversal(user._id, id);
      if (action === 'universal' && method === 'POST') return trips.addUniversalToPlan(user._id, id, body);
      // 自定义地点类别
      if (action === 'categories' && method === 'GET') return trips.getCategories(user._id, id);
      if (action === 'categories' && method === 'PUT') return trips.updateCategories(user._id, id, body);
      // 导出 JSON 到云存储
      if (action === 'export' && method === 'POST') return trips.exportJson(user._id, id);
      if (action === 'share' && method === 'POST') return trips.share(user._id, id, body);
      if (action === 'members' && method === 'GET') return trips.members(user._id, id);
      if (action === 'members' && method === 'PUT') return trips.updateMember(user._id, id, body);
      if (action === 'members' && method === 'DELETE') return trips.removeMember(user._id, id, body);
      if (action === 'backups' && sub === 'restore' && method === 'POST') return trips.restoreBackup(user._id, id, body);
      if (action === 'backups' && method === 'GET') return trips.listBackups(user._id, id);
      if (action === 'backups' && method === 'POST') return trips.createBackup(user._id, id);
      if (method === 'GET') return trips.get(user._id, id);
      if (method === 'PUT') return trips.update(user._id, id, body);
      if (method === 'DELETE') return trips.remove(user._id, id, body);
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

