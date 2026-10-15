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

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
// Database payloads are JSON; remain compatible with older cloud Node runtimes.
const structuredClone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

const COLLECTIONS = ['users', 'sessions', 'trips', 'trip_members', 'trip_backups'];

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

module.exports = { createStore, COLLECTIONS, LocalStore, CloudStore };
