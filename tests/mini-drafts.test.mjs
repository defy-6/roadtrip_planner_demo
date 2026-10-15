import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function fixture() {
  const storage = new Map([['roadtrip-user', { id: 'synthetic-a' }]]);
  let modal;
  const context = { module: { exports: {} }, wx: {
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key), showModal: value => { modal = value; }
  } };
  vm.runInNewContext(readFileSync(new URL('../miniprogram/utils/drafts.js', import.meta.url), 'utf8'), context);
  return { drafts: context.module.exports, storage, context, modal: () => modal };
}
test('mini recovery retains source arrays and the original revision, never another account draft', () => {
  const f = fixture();
  const page = { route: 'pages/event-edit/event-edit', data: { index: 0, form: { title: 'unsaved' } },
    schedule: [{ title: 'unsaved' }], __tripReadVersions: { t: 'old' }, setData(value) { this.data = value; } };
  assert.equal(f.drafts.retain(page, 't', { path: '/api/trips/t/schedule', method: 'PUT', data: { schedule: page.schedule } }), true);
  page.schedule = []; page.__tripReadVersions.t = 'fresh';
  f.drafts.offerRestore(page, 't'); f.modal().success({ confirm: true });
  assert.equal(page.schedule[0].title, 'unsaved');
  assert.equal(page.__tripReadVersions.t, 'old');
  f.drafts.acknowledge(page, { path: '/api/trips/t/expenses', method: 'PUT' });
  assert.equal(f.storage.size, 2, 'unrelated successful mutation cannot delete recovery');
  f.storage.set('roadtrip-user', { id: 'synthetic-b' });
  const previousModal = f.modal(); f.drafts.offerRestore(page, 't');
  assert.equal(f.modal(), previousModal, 'another actor sees no recovery prompt');
});
test('mini recovery does not claim durability after storage failure', () => {
  const f = fixture(); f.context.wx.setStorageSync = () => { throw new Error('quota'); };
  assert.equal(f.drafts.retain({ route: 'page', data: {} }, 't', { path: '/api/trips/t', method: 'PUT' }), false);
});

test('leaving a dirty mini editor retains a local-only draft without sending a request', () => {
  const f = fixture();
  const definition = f.drafts.withDraftLifecycle({ onInput() { this.data.form.title = 'typed'; } }, 'schedule');
  const page = { ...definition, route: 'pages/event-edit/event-edit', data: { id: 't', index: 0, form: {} }, __tripReadVersions: { t: 'original' } };
  page.onInput(); page.onHide();
  const draft = JSON.parse([...f.storage.values()].find(value => typeof value === 'string'));
  assert.equal(draft.data.form.title, 'typed');
  assert.equal(draft.request.localOnly, true);
  assert.equal(draft.revisions.t, 'original');
});
