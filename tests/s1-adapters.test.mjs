import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import { PlannerFile } from '../server/planner-file.mjs';
const require = createRequire(import.meta.url);
const { LocalStore, CloudStore } = require('../cloudfunctions/api/store.js');

function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), 'roadtrip-adapter-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, 'synthetic.json');
}

test('local database parse/shape errors never replace the original file with an empty database', t => {
  const file = temporary(t);
  for (const source of ['{broken', '{}', 'null']) {
    writeFileSync(file, source);
    assert.throws(() => new LocalStore(file));
    assert.equal(readFileSync(file, 'utf8'), source);
  }
});

test('planner file uses a hash for legacy data and refuses stale, empty and unsupported writes', t => {
  const file = temporary(t);
  const original = { versions: { a: { schedule: [] } }, extension: { kept: true } };
  writeFileSync(file, JSON.stringify(original));
  const a = new PlannerFile(file), b = new PlannerFile(file);
  const first = a.read();
  assert.match(first.revision, /^sha256:/);
  assert.throws(() => a.write({}, first.revision), error => error.code === 'INVALID_PLANNER_DATA');
  const saved = a.write(original, first.revision);
  assert.ok(saved.updatedAt);
  assert.deepEqual(a.read().data.extension, { kept: true });
  assert.throws(() => b.write(original, first.revision), error => error.code === 'VERSION_CONFLICT');
  assert.throws(() => b.write({ ...original, schemaVersion: 99 }, saved.updatedAt), error => error.code === 'SCHEMA_UNSUPPORTED');
  assert.throws(() => b.write(original, ''), error => error.code === 'VERSION_REQUIRED');
  writeFileSync(file, '{broken');
  assert.throws(() => b.write(original, saved.updatedAt));
  assert.equal(readFileSync(file, 'utf8'), '{broken');
});

test('generated single-file cloud function boots its safety modules in an isolated local database', async t => {
  const file = temporary(t);
  const oldLocal = process.env.LOCAL, oldData = process.env.CLOUD_DEV_DATA;
  process.env.LOCAL = '1'; process.env.CLOUD_DEV_DATA = file;
  t.after(() => {
    if (oldLocal === undefined) delete process.env.LOCAL; else process.env.LOCAL = oldLocal;
    if (oldData === undefined) delete process.env.CLOUD_DEV_DATA; else process.env.CLOUD_DEV_DATA = oldData;
  });
  const bundled = require('../cloudfunctions/api-single/index.js');
  const response = await bundled.main({ __http: { method: 'POST', path: '/api/auth/register',
    body: { username: 'bundle_safety', password: 'synthetic-password' } } });
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).user.username, 'bundle_safety');
});

test('local conditional multi-document commit rolls back memory and disk on persistence failure', async t => {
  const file = temporary(t);
  const store = new LocalStore(file);
  await store.insert('trips', { _id: 't', updated_at: 'v1', name: 'old' });
  await store.insert('users', { _id: 'u', place_library: [{ id: 'old' }] });
  const original = readFileSync(file, 'utf8');
  store._persist = () => { throw Error('synthetic disk failure'); };
  await assert.rejects(store.updateIfMatches('trips', { _id: 't', updated_at: 'v1' }, { name: 'new' }, [
    { collection: 'users', query: { _id: 'u' }, patch: { place_library: [] } }
  ]));
  assert.equal((await store.findOne('trips', { _id: 't' })).name, 'old');
  assert.deepEqual((await store.findOne('users', { _id: 'u' })).place_library, [{ id: 'old' }]);
  assert.equal(readFileSync(file, 'utf8'), original);
});

test('independent local-store instances reread under a file lock and refuse a stale write', async t => {
  const file = temporary(t);
  const a = new LocalStore(file);
  await a.insert('trips', { _id: 't', updated_at: 'v1', name: 'old' });
  const b = new LocalStore(file);
  assert.equal((await a.updateIfMatches('trips', { _id: 't', updated_at: 'v1' }, { updated_at: 'v2', name: 'A' })).updated, 1);
  assert.equal((await b.updateIfMatches('trips', { _id: 't', updated_at: 'v1' }, { updated_at: 'v3', name: 'B' })).updated, 0);
  assert.equal((await b.findOne('trips', { _id: 't' })).name, 'A');
  writeFileSync(`${file}.lock`, 'synthetic other-process lock');
  await assert.rejects(a.update('trips', { _id: 't' }, { name: 'unsafe' }), error => error.code === 'LOCAL_STORE_BUSY');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).trips[0].name, 'A');
});

function cloudFixture() {
  let records = { trips: { t: { _id: 't', updated_at: 'v1', data: { removed: true } } },
    users: { u: { _id: 'u', place_library: [{ id: 'old' }] } } };
  const matches = (row, query) => row && Object.entries(query).every(([k, v]) => row[k] === v);
  const apply = (row, patch) => {
    for (const [key, value] of Object.entries(patch)) {
      if (value && typeof value === 'object') assert.ok(Object.hasOwn(value, '__set'), 'nested object must replace, not merge');
      row[key] = value && typeof value === 'object' ? structuredClone(value.__set) : value;
    }
  };
  let afterUpdate = () => {};
  const collection = (all, name) => ({
    where: query => ({ limit() { return this; }, get: async () => ({ data: Object.values(all[name]).filter(row => matches(row, query)).map(row => structuredClone(row)) }),
      update: async ({ data }) => { const row = Object.values(all[name]).find(row => matches(row, query)); if (!row) return { stats: { updated: 0 } }; apply(row, data); afterUpdate(row); return { stats: { updated: 1 } }; } }),
    doc: id => ({ get: async () => ({ data: structuredClone(all[name][id]) }), update: async ({ data }) => apply(all[name][id], data),
      remove: async () => { delete all[name][id]; } })
  });
  const db = { command: { set: value => ({ __set: value }) }, collection: name => collection(records, name),
    async runTransaction(fn) {
      const draft = structuredClone(records);
      const result = await fn({ collection: name => collection(draft, name) });
      records = draft;
      return { result, errMsg: 'runTransaction:ok' };
    } };
  return { store: new CloudStore({ init() {}, database: () => db }),
    records: () => records, afterUpdate: fn => { afterUpdate = fn; } };
}

test('cloud CAS returns its own committed revision, not a later writer reread', async () => {
  const f = cloudFixture();
  f.afterUpdate(row => { row.updated_at = 'v3'; });
  const result = await f.store.updateIfMatches('trips', { _id: 't', updated_at: 'v1' }, { updated_at: 'v2', data: { new: true } });
  assert.equal(result.doc.updated_at, 'v2');
  assert.deepEqual(result.doc.data, { new: true });
  assert.equal(f.records().trips.t.updated_at, 'v3');
});

test('cloud transaction unwraps SDK result and commits library with the trip or neither', async () => {
  const f = cloudFixture();
  const related = [{ collection: 'users', query: { _id: 'u', place_library_revision: undefined },
    patch: { place_library: [], place_library_revision: 1 } }];
  const result = await f.store.updateIfMatches('trips', { _id: 't', updated_at: 'v1' }, { updated_at: 'v2' }, related);
  assert.equal(result.updated, 1);
  assert.deepEqual(f.records().users.u.place_library, []);
  assert.equal(f.records().users.u.place_library_revision, 1);
  assert.equal((await f.store.updateIfMatches('trips', { _id: 't', updated_at: 'v1' }, { updated_at: 'v3' }, related)).updated, 0);
  assert.equal(f.records().trips.t.updated_at, 'v2');
});

test('mini-program versions belong to the reading page, so a second page cannot freshen a stale draft', async () => {
  let activePage;
  let revision = 'v1';
  const writes = [];
  const context = { module: { exports: {} }, require: () => ({ retain: () => false, acknowledge() {} }), getCurrentPages: () => [activePage], wx: {
    getStorageSync: () => 'synthetic-token',
    cloud: { callFunction({ data, success }) {
      const request = data.__http;
      if (request.method === 'GET') { success({ result: { statusCode: 200, body: JSON.stringify({ updated_at: revision, schedule: [] }) } }); return; }
      writes.push(request.body.baseUpdatedAt);
      const ok = request.body.baseUpdatedAt === revision;
      if (ok) revision = 'v2';
      success({ result: { statusCode: ok ? 200 : 409, body: JSON.stringify(ok ? { updated_at: revision } : { code: 'VERSION_CONFLICT', error: 'conflict' }) } });
    } }
  } };
  vm.runInNewContext(readFileSync(new URL('../miniprogram/utils/request.js', import.meta.url), 'utf8'), context);
  const { request } = context.module.exports;
  const a = {}, b = {};
  activePage = a; await request('/api/trips/t/schedule');
  activePage = b; await request('/api/trips/t/schedule');
  await request('/api/trips/t/schedule', { method: 'PUT', data: { schedule: [] } });
  activePage = a;
  await assert.rejects(request('/api/trips/t/schedule', { method: 'PUT', data: { schedule: [] } }), error => error.code === 'VERSION_CONFLICT' && error.status === 409);
  assert.deepEqual(writes, ['v1', 'v1']);
  assert.equal(a.__tripReadVersions.t, 'v1');
});
