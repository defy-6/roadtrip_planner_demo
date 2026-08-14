import assert from 'node:assert/strict';
import test from 'node:test';
import { createSession } from '../public/core/session.js';

const normalizeLookup = value => String(value || '').toLowerCase().replace(/[\s·，,。；;：:（）()→\-—_/]/g, '');
const fakeEl = () => ({ value: '', innerHTML: '', textContent: '', hidden: false, dataset: {} });

function setup(overrides = {}) {
  const state = { plans: [], versionKey: '', schedule: [], locations: [], universalLocations: [], routes: [], placeCategories: [], preferences: {}, selectedIndex: null, dayFilter: '' };
  const queueCalls = [];
  const history = { commit: () => { history.commits = (history.commits || 0) + 1; } };
  const selectedIndexes = new Set();
  let fileRevision = '';
  const persistence = { read: () => ({}), write: () => {}, queueFileSave: payload => queueCalls.push(payload), autoSaveEnabled: true };
  const setPlanCatalog = container => {
    state.plans = (container.plans || []).length ? container.plans : [{ id: 'p1', name: '默认计划' }];
    state.versionKey = container.activeVersion && state.plans.some(plan => plan.id === container.activeVersion) ? container.activeVersion : state.plans[0].id;
    return container;
  };
  const session = createSession({
    state, $: fakeEl, itemsEl: { children: [], innerHTML: '' }, values: () => ({}), persistence,
    isShareMode: false, shareData: null, defaultPlanId: 'p1',
    migrate: data => data,
    renderPlanSelect: () => {}, setPlanCatalog,
    utils: {
      normalizeCategoryColor: color => color, normalizePlaceLookup: normalizeLookup,
      findMatchingLocation: () => null, suggestedPlaceName: (address, resolved, name) => name, syncUniversalPlace: place => place,
      versionStorageKey: key => `roadtrip-version-${key}`, sharedScheduleStorageKey: 'roadtrip-shared',
      typeForTitle: title => 'spot', presetNodeTimes: {}, PRESET_PLANS: {}, PRESET_SCHEDULES: {}
    },
    routes: { upsertUniversalRoute: (name, links) => ({ id: 'route-new', ...links, name }), routeForScheduleEvent: () => null, mergeUniversalRoutes: data => data },
    render: {
      addItem: () => {}, renderLocations: () => {}, renderSchedule: () => {}, renderManualSchedule: () => {},
      applyDayFilter: () => {}, showDayOverview: () => {}, renderRouteTotals: () => {}, showStopsOnMap: () => {}
    },
    history, selectedIndexes,
    getFileRevision: () => fileRevision, setFileRevision: value => { fileRevision = value; },
    ...overrides
  });
  return { session, state, queueCalls, history };
}

test('loadFileContainer registers top-level catalog and load uses it for universal locations', () => {
  const { session, state } = setup();
  const topLocations = [{ id: 'top-1', name: '顶层通用地点', address: '某地' }];
  const planLocations = [{ id: 'plan-1', name: '计划地点', address: '某处' }];
  session.loadFileContainer({
    activeVersion: 'p1',
    plans: [{ id: 'p1', name: 'A' }],
    versions: { p1: { name: 'A', schedule: [], locations: planLocations, routes: [] } },
    locations: topLocations,
    routes: []
  });
  session.load({ name: 'A', schedule: [], locations: planLocations, routes: [] }, 'p1');
  assert.deepEqual(state.locations, planLocations, '计划内地点保持计划快照');
  assert.deepEqual(state.universalLocations, topLocations, '顶层通用地点不被计划地点覆盖');
});

test('load without catalog falls back to plan snapshot locations', () => {
  const { session, state } = setup();
  const planLocations = [{ id: 'plan-1', name: '计划地点', address: '某处' }];
  session.load({ name: 'A', schedule: [], locations: planLocations, routes: [] }, 'p1');
  assert.deepEqual(state.universalLocations, planLocations);
});

test('save stores snapshot, commits history and queues file save', () => {
  const { session, state, queueCalls, history } = setup();
  state.plans = [{ id: 'p1', name: 'A' }];
  state.versionKey = 'p1';
  state.schedule = [{ date: '2026-08-15', start: '09:00', title: '出发' }];
  session.save();
  assert.equal(history.commits, 1);
  assert.equal(queueCalls.length, 1);
  assert.equal(session.snapshotForPlan('p1').schedule.length, 1, '快照已存储');
});

test('save is skipped in share mode or when autosave disabled', () => {
  const { session, state, queueCalls } = setup({ isShareMode: true });
  state.plans = [{ id: 'p1', name: 'A' }];
  state.versionKey = 'p1';
  session.save();
  assert.equal(queueCalls.length, 0);
});

test('planIdFromName normalizes to kebab-case id with suffix', () => {
  const { session } = setup();
  const id = session.planIdFromName('新疆 北疆·方案A');
  assert.match(id, /^新疆-北疆-方案a-[0-9a-f]{8}$/);
  assert.match(session.planIdFromName(''), /^plan-[0-9a-f]{8}$/);
});
