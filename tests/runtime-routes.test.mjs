import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntimeRoutes, routeVisualOverlapPolicy } from '../public/features/runtime/routes.js';

const normalizeLookup = value => String(value || '').trim().toLowerCase();

test('runtime routes exposes one normalized route contract for editors, schedule and map', () => {
  const state = {
    locations: [{ id: 'a', name: '起点' }, { id: 'b', name: '终点' }],
    routes: [{
      id: 'route-1', name: '前往终点', originPlaceId: 'a', destinationPlaceId: 'b',
      transportMode: 'driving', travelMode: 'recommended'
    }]
  };
  const routes = createRuntimeRoutes({ state, isShareMode: false, normalizeLookup });

  assert.equal(routes.normalizedTransportMode('unknown'), 'driving');
  assert.equal(routes.normalizedTravelMode('unknown'), 'recommended');
  assert.equal(routes.routeForScheduleEvent({ routeLinks: { routeId: 'route-1' } }).id, 'route-1');
  assert.equal(routes.routeSignature(state.routes[0]), 'a>b>driving>recommended');
  assert.equal(typeof routes.routesShareVisualCorridor, 'function');
});

test('runtime routes preserves shared data while editable data uses route merge semantics', () => {
  const data = { routes: [{ id: 'route-1', viaPlaceIds: [] }, { id: 'route-1', viaPlaceIds: [] }] };
  const shared = createRuntimeRoutes({ state: { locations: [], routes: [] }, isShareMode: true, normalizeLookup });
  const editable = createRuntimeRoutes({ state: { locations: [], routes: [] }, isShareMode: false, normalizeLookup });

  assert.equal(shared.mergeUniversalRoutes(data), data);
  assert.equal(editable.mergeUniversalRoutes(data).routes.length, 1);
  assert.deepEqual(routeVisualOverlapPolicy, {
    proximityMeters: 400,
    minCorridorMeters: 20_000,
    minShorterRouteRatio: .18
  });
  assert.equal(Object.isFrozen(routeVisualOverlapPolicy), true);
});
