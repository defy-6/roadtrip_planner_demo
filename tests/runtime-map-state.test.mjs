import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntimeMapState } from '../public/features/runtime/map-state.js';

test('runtime map state keeps layers and transient overview state behind named accessors', () => {
  const mapState = createRuntimeMapState();
  assert.equal(mapState.getMap(), undefined);
  assert.equal(mapState.getDayOverviewRequestId(), 0);
  assert.equal(mapState.getDayPhotoCalloutRenderer(), null);
  assert.equal(mapState.getMapFocusDate(), '');
  assert.equal(mapState.getRenderedOverviewDate(), null);

  const map = { id: 'map' };
  const route = { id: 'route' };
  const markers = { id: 'markers' };
  const overview = { id: 'overview' };
  const photos = { id: 'photos' };
  mapState.setMap(map);
  mapState.setRouteLayer(route);
  mapState.setMarkerLayer(markers);
  mapState.setDayOverviewLayer(overview);
  mapState.setDayPhotoCalloutLayer(photos);
  mapState.setDayOverviewRequestId(7);
  mapState.setMapFocusDate('2026-08-15');
  mapState.setRenderedOverviewDate('2026-08-15');

  assert.equal(mapState.getMap(), map);
  assert.deepEqual(mapState.getLayers(), [photos, overview, markers, route]);
  assert.equal(mapState.getDayOverviewRequestId(), 7);
  assert.equal(mapState.getRenderedOverviewDate(), '2026-08-15');
  mapState.resetMapFocusDate();
  assert.equal(mapState.getMapFocusDate(), '');
});
