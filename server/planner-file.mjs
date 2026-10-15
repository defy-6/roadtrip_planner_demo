import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import safety from '../cloudfunctions/api/trip-write-safety.js';

// File adapter, not a cloud database substitute. Never initialize on read failure.
export class PlannerFile {
  constructor(file) { this.file = path.resolve(file); }
  read() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('行程文件格式错误');
      const revision = typeof data.updatedAt === 'string' && data.updatedAt
        ? data.updatedAt : `sha256:${createHash('sha256').update(raw).digest('hex')}`;
      return { data, revision };
    } catch (error) {
      if (error.code === 'ENOENT') return { data: null, revision: '' };
      throw error;
    }
  }
  write(payload, baseline) {
    const fail = (statusCode, code, message) => { const error = new Error(message); Object.assign(error, { statusCode, code }); throw error; };
    if (typeof baseline !== 'string' || !baseline) fail(428, 'VERSION_REQUIRED', '缺少读取时的版本，未写入本地文件');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail(400, 'INVALID_PLANNER_DATA', '无效行程数据');
    if (!safety.hasPlannerData(payload)) fail(400, 'INVALID_PLANNER_DATA', '缺少可恢复的方案内容，未写入');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const lock = `${this.file}.lock`;
    let descriptor;
    try { descriptor = fs.openSync(lock, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') fail(503, 'LOCAL_STORE_BUSY', '本地文件正在保存，请稍后重试'); throw error; }
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      const current = this.read();
      if (!current.data) fail(409, 'VERSION_CONFLICT', '原行程文件缺失，请先恢复备份');
      if (baseline !== current.revision) fail(409, 'VERSION_CONFLICT', '本地行程已更新，本次修改未写入');
      if (!safety.supportedSchema(current.data) || !safety.supportedSchema(payload)) fail(409, 'SCHEMA_UNSUPPORTED', '当前客户端不支持该行程版本，未写入');
      const updatedAt = safety.nextRevision(current.data.updatedAt);
      const data = { ...payload, updatedAt, savedAt: updatedAt };
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(data, null, 2), 'utf8'); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      fs.renameSync(temporary, this.file);
      return { ok: true, updatedAt, savedAt: updatedAt };
    } finally {
      try { fs.unlinkSync(temporary); } catch { /* only this attempt's temporary file */ }
      fs.closeSync(descriptor); fs.unlinkSync(lock);
    }
  }
}
