import assert from 'node:assert/strict';
import test from 'node:test';
import { bindRuntimeExports } from '../public/features/runtime/exports.js';

test('runtime exports gives schedule and map exporters only their owned dependencies', () => {
  let scheduleOptions;
  let mapOptions;
  const mapState = {
    getMap: () => 'map',
    getLayers: () => ['photos', 'overview', 'markers', 'routes']
  };
  const scheduleResult = { button: 'schedule-button' };
  const mapResult = { button: 'map-button' };
  const common = {
    $: () => null,
    state: { schedule: [] },
    api: { proxyMapImage() {} },
    mapState,
    markerColors: { spot: '#123456' },
    renderSchedule() {},
    applyDayFilter() {},
    scheduleContainer: { id: 'schedule-actions' },
    mapContainer: { id: 'map-panel' },
    filePart: value => value,
    downloadPng() {},
    scheduleBinder: options => { scheduleOptions = options; return scheduleResult; },
    mapBinder: options => { mapOptions = options; return mapResult; }
  };

  const result = bindRuntimeExports(common);
  assert.deepEqual(result, { schedule: scheduleResult, map: mapResult });
  assert.equal(scheduleOptions.container, common.scheduleContainer);
  assert.equal(scheduleOptions.state, common.state);
  assert.equal(scheduleOptions.renderSchedule, common.renderSchedule);
  assert.equal(mapOptions.container, common.mapContainer);
  assert.equal(mapOptions.api, common.api);
  assert.equal(mapOptions.getMap, mapState.getMap);
  assert.deepEqual(mapOptions.getLayers(), ['photos', 'overview', 'markers', 'routes']);
  assert.equal('state' in mapOptions, false);
  assert.equal('routeColorForDate' in mapOptions, false);
});
