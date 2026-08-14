// 数据访问层：本地 JSON 文件适配器（LOCAL=1 时用于开发测试）+ 微信云开发适配器。
// 两个实现暴露同一套异步接口：
//   findOne(collection, query) / find(collection, query)
//   insert(collection, doc) / update(collection, query, patch) / remove(collection, query)
// query 为等值匹配对象；文档统一使用 _id 字符串主键。

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const COLLECTIONS = ['users', 'sessions', 'trips', 'trip_members'];

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

module.exports = { createStore, COLLECTIONS };
