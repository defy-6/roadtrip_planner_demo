import assert from 'node:assert/strict';
import test from 'node:test';
import { createRouteModel } from '../public/features/routes/model.js';

const TRANSPORT_MODES = {
  driving: { label: '自驾' }, walking: { label: '步行' }, bicycling: { label: '骑行' }, transit: { label: '公共交通' }
};
const DRIVE_TRAVEL_MODES = { recommended: { label: '高德推荐', strategy: 10 }, highway: { label: '高速优先', strategy: 4 }, fastest: { label: '速度最快', strategy: 2 }, lowToll: { label: '少收费', strategy: 3 }, avoidHighway: { label: '不走高速', strategy: 9 }, mainRoad: { label: '大路优先', strategy: 8 } };
const normalize = value => String(value || '').toLowerCase();

function setup(routes = [], locations = []) {
  const state = { routes, locations };
  return { model: createRouteModel({ state, transportModes: TRANSPORT_MODES, driveTravelModes: DRIVE_TRAVEL_MODES, normalizeLookup: normalize }), state };
}

test('route model normalizes transport and travel modes with defaults', () => {
  const { model } = setup();
  assert.equal(model.normalizedTransportMode('walking'), 'walking');
  assert.equal(model.normalizedTransportMode('unknown'), 'driving');
  assert.equal(model.normalizedTravelMode('highway'), 'highway');
  assert.equal(model.normalizedTravelMode('unknown'), 'recommended');
  assert.equal(model.driveTravelMeta('highway').strategy, 4);
  assert.equal(model.transportModeMeta('transit').label, '公共交通');
});

test('route upsert reuses same-signature route and fills name', () => {
  const { model, state } = setup();
  const links = { originPlaceId: 'a', destinationPlaceId: 'b', viaPlaceIds: ['v'], transportMode: 'driving', travelMode: 'recommended' };
  const first = model.upsert('伊宁 → 赛里木湖', links);
  const second = model.upsert('', links);
  assert.equal(first, second, '同签名应复用同一路线对象');
  assert.equal(state.routes.length, 1);
  assert.equal(second.name, '伊宁 → 赛里木湖');
});

test('forScheduleEvent resolves by routeId then by name + endpoints', () => {
  const place = { id: 'origin', name: '伊宁', address: '伊犁州伊宁市' };
  const route = { id: 'r1', name: '赛里木湖', originPlaceId: 'origin', destinationPlaceId: 'dest', viaPlaceIds: [], transportMode: 'driving', travelMode: 'recommended' };
  const { model, state } = setup([route], [place]);
  assert.equal(model.forScheduleEvent({ title: '前往赛里木湖', routeLinks: { routeId: 'r1' } }), route);
  assert.equal(model.forScheduleEvent({ title: '前往赛里木湖', routeLinks: { originPlaceId: 'origin', destinationPlaceId: 'dest', transportMode: 'driving', travelMode: 'recommended' } }), route);
  assert.equal(model.forScheduleEvent({ title: '无关事件', routeLinks: {} }), undefined);
});

test('route merge keeps newest amap and fills missing steps', () => {
  const { model, state } = setup();
  const data = { routes: [{ id: 'r1', originPlaceId: 'a', destinationPlaceId: 'b', viaPlaceIds: [], transportMode: 'driving', travelMode: 'recommended', amap: { queriedAt: '2026-08-01T00:00:00Z', distance: 100 } }] };
  const merged = model.merge({ ...data, routes: [...data.routes, { id: 'r1', originPlaceId: 'a', destinationPlaceId: 'b', viaPlaceIds: [], transportMode: 'driving', travelMode: 'recommended', amap: { queriedAt: '2026-08-02T00:00:00Z', distance: 120, steps: [{ polyline: '1,2;3,4' }] } }] });
  assert.equal(merged.routes.length, 1);
  assert.equal(merged.routes[0].amap.distance, 120);
  assert.equal(merged.routes[0].amap.steps.length, 1);
  assert.equal(state.routes.length, 0, 'merge 不修改原 state');
});
