import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createTripsRoutes } = require('../cloudfunctions/api/routes/trips.js');
const { buildBackupEnvelope } = require('../cloudfunctions/api/backup-format.js');
const clone = value => structuredClone(value);
const sample = () => ({ activeVersion: 'a', plans: [{ id: 'a', name: 'sample' }],
  versions: { a: { schedule: [], locations: [], expenses: [], routes: [], placeCategories: [], preferences: {} } } });

function fixture() {
  const db = { trips: [{ _id: 't', name: 'original', updated_at: '2020-01-01T00:00:00.000Z', data: sample() }],
    trip_members: [{ _id: 'm', trip_id: 't', user_id: 'u', role: 'owner' }],
    users: [{ _id: 'u', place_library: [{ id: 'kept', name: 'kept' }] }], trip_backups: [] };
  const matches = (doc, query) => Object.entries(query).every(([key, value]) => doc[key] === value);
  let hook = async () => {};
  const store = {
    findOne: async (c, q) => clone(db[c].find(d => matches(d, q)) || null),
    find: async (c, q) => clone(db[c].filter(d => matches(d, q))),
    insert: async (c, d) => { const row = { _id: `b${db[c].length}`, ...clone(d) }; db[c].push(row); return clone(row); },
    update: async (c, q, p) => { await hook(c); const row = db[c].find(d => matches(d, q)); if (!row) return null; Object.assign(row, clone(p)); return clone(row); },
    remove: async (c, q) => { await hook(c); const n = db[c].length; db[c] = db[c].filter(d => !matches(d, q)); return n - db[c].length; },
    removeIfMatches: async (c, q) => store.remove(c, q),
    updateIfMatches: async (c, q, p, related = []) => {
      await hook(c);
      const changes = [{ collection: c, query: q, patch: p }, ...related];
      const rows = changes.map(x => db[x.collection].find(d => matches(d, x.query)));
      if (rows.some(row => !row)) return { updated: 0, doc: null };
      changes.forEach((x, i) => {
        if (x.action === 'remove') db[x.collection] = db[x.collection].filter(row => row._id !== rows[i]._id);
        else if (x.action !== 'check') Object.assign(rows[i], clone(x.patch));
      });
      return { updated: 1, doc: clone(rows[0]) };
    }
  };
  const routes = createTripsRoutes({ store });
  return { db, store, routes, arm: fn => { hook = fn; } };
}

test('unversioned stale clients cannot overwrite a prior successful edit', async () => {
  const f = fixture();
  assert.equal((await f.routes.update('u', 't', { name: 'A', baseUpdatedAt: f.db.trips[0].updated_at })).statusCode, 200);
  const second = await f.routes.update('u', 't', { name: 'B stale' });
  assert.equal(second.statusCode, 428);
  assert.equal(f.db.trips[0].name, 'A');
});

test('revoking editor access advances the trip revision and fences an already-started write', async () => {
  const f = fixture();
  f.db.trip_members.push({ _id: 'editor', trip_id: 't', user_id: 'e', role: 'editor' });
  const previous = f.db.trips[0].updated_at;
  assert.equal((await f.routes.updateMember('u', 't', { user_id: 'e', role: 'viewer', baseUpdatedAt: previous })).statusCode, 200);
  assert.notEqual(f.db.trips[0].updated_at, previous);
  assert.equal(f.db.trip_members[1].role, 'viewer');
  assert.equal((await f.store.updateIfMatches('trips', { _id: 't', updated_at: previous }, { name: 'stale editor' })).updated, 0);
  assert.equal((await f.routes.removeMember('u', 't', { user_id: 'e', baseUpdatedAt: previous })).statusCode, 409);
  assert.equal(f.db.trip_members.length, 2);
  assert.equal((await f.routes.removeMember('u', 't', { user_id: 'e', baseUpdatedAt: f.db.trips[0].updated_at })).statusCode, 200);
  assert.equal(f.db.trip_members.length, 1);
});

test('revision always advances even when the clock stays in the same millisecond', async () => {
  const f = fixture();
  const OriginalDate = globalThis.Date;
  const fixed = '2026-10-14T00:00:00.000Z';
  globalThis.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return OriginalDate.parse(fixed); } };
  try {
    f.db.trips[0].updated_at = fixed;
    assert.equal((await f.routes.update('u', 't', { name: 'A', baseUpdatedAt: fixed })).statusCode, 200);
    assert.equal((await f.routes.update('u', 't', { name: 'B', baseUpdatedAt: fixed })).statusCode, 409);
    assert.equal(f.db.trips[0].name, 'A');
  } finally { globalThis.Date = OriginalDate; }
});

test('a rejected trip CAS cannot mutate the account place library', async () => {
  const f = fixture();
  const version = f.db.trips[0].updated_at;
  f.arm(async c => { if (c === 'trips') f.db.trips[0].updated_at = '2030-01-01T00:00:00.000Z'; });
  const data = sample(); data.locations = [{ id: 'stale' }];
  const result = await f.routes.update('u', 't', { data, baseUpdatedAt: version, baseLibraryRevision: 0 });
  assert.equal(result.statusCode, 409);
  assert.deepEqual(f.db.users[0].place_library, [{ id: 'kept', name: 'kept' }]);
});

test('restore refuses a concurrent edit instead of replacing it with the backup', async () => {
  const f = fixture();
  f.db.trip_backups.push({ _id: 'backup', trip_id: 't', ...buildBackupEnvelope({ data: sample(), placeLibrary: [], createdBy: 'u', tripName: 'backup' }) });
  const version = f.db.trips[0].updated_at;
  f.arm(async c => { if (c === 'trips') { f.db.trips[0].name = 'concurrent'; f.db.trips[0].updated_at = '2030-01-01T00:00:00.000Z'; } });
  const result = await f.routes.restoreBackup('u', 't', { backup_id: 'backup', baseUpdatedAt: version });
  assert.equal(result.statusCode, 409);
  assert.equal(f.db.trips[0].name, 'concurrent');
});

test('a valid empty library backup restores an empty library', async () => {
  const f = fixture();
  f.db.trip_backups.push({ _id: 'backup', trip_id: 't', ...buildBackupEnvelope({ data: sample(), placeLibrary: [], createdBy: 'u', tripName: 'backup' }) });
  const result = await f.routes.restoreBackup('u', 't', { backup_id: 'backup', baseUpdatedAt: f.db.trips[0].updated_at });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(f.db.users[0].place_library, []);
});

test('conditional deletion refuses a change in the read/delete window', async () => {
  const f = fixture();
  const version = f.db.trips[0].updated_at;
  f.arm(async c => { if (c === 'trips') f.db.trips[0].updated_at = '2030-01-01T00:00:00.000Z'; });
  assert.equal((await f.routes.remove('u', 't', { baseUpdatedAt: version })).statusCode, 409);
  assert.equal(f.db.trips.length, 1);
  assert.equal(f.db.trip_members.length, 1);
});
