import assert from 'node:assert/strict';
import test from 'node:test';
import { createWeatherController } from '../public/features/weather/controller.js';

test('unified flight transport links its airports before querying weather', async () => {
  const event = {
    type: 'transport', date: '2026-08-24', start: '09:05', end: '11:40',
    transportInfo: { kind: 'flight' },
    flightInfo: { departureAirport: '福州长乐国际机场', arrivalAirport: '北京大兴国际机场', arrivalDate: '2026-08-24' }
  };
  const state = { schedule: [event], locations: [] };
  const nodes = { '#eventEditor': { open: false } };
  const requests = [];
  let linked = 0, saved = 0, refreshed = 0;
  const controller = createWeatherController({
    state,
    $: selector => nodes[selector],
    api: { getWeather: async request => { requests.push(request); return { weather: '晴', temperature: 26 }; } },
    geocode: async () => { throw new Error('linked airports should already have coordinates'); },
    convertCoords: (longitude, latitude) => [longitude, latitude],
    routeForEvent: () => null,
    linkFlightAirports: async entry => {
      linked += 1;
      state.locations.push(
        { id: 'departure', name: entry.flightInfo.departureAirport, address: '福州长乐国际机场', resolved: { location: '119.66,25.93' } },
        { id: 'arrival', name: entry.flightInfo.arrivalAirport, address: '北京大兴国际机场', resolved: { location: '116.41,39.51' } }
      );
      entry.flightInfo.departurePlaceId = 'departure';
      entry.flightInfo.arrivalPlaceId = 'arrival';
      return true;
    },
    getEditingIndex: () => -1,
    save: () => { saved += 1; },
    refresh: () => { refreshed += 1; }
  });

  await controller.queryEvent(0);

  assert.equal(linked, 1);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map(request => request.time), ['09:05', '11:40']);
  assert.equal(event.weather.departureAirport, '福州长乐国际机场');
  assert.equal(event.weather.arrivalAirport, '北京大兴国际机场');
  assert.equal(saved, 1);
  assert.equal(refreshed, 1);
});

test('flight weather can be refreshed from the editor before airport IDs are linked', async () => {
  const event = {
    type: 'transport', date: '2026-08-24', start: '09:05', end: '11:40',
    transportInfo: { kind: 'flight' },
    flightInfo: { departureAirport: '福州长乐国际机场', arrivalAirport: '北京大兴国际机场', arrivalDate: '2026-08-24' }
  };
  const state = { schedule: [event], locations: [] };
  const nodes = {
    '#eventEditor': { open: true }, '#editorType': { value: 'transport' }, '#editorTransportKind': { value: 'flight' },
    '#editorDate': { value: '2026-08-24' }, '#editorStart': { value: '09:05' }, '#editorEnd': { value: '11:40' },
    '#editorFlightArrivalDate': { value: '2026-08-24' }, '#editorFlightDeparture': { value: '福州长乐国际机场' },
    '#editorFlightArrival': { value: '北京大兴国际机场' }, '#queryEditorWeather': { disabled: false, textContent: '' },
    '#editorWeatherStatus': { hidden: true, textContent: '', dataset: {} }
  };
  const requests = [];
  let linked = 0;
  const controller = createWeatherController({
    state,
    $: selector => nodes[selector],
    api: { getWeather: async request => { requests.push(request); return { weather: '晴', temperature: 26 }; } },
    geocode: async () => { throw new Error('linked airports should already have coordinates'); },
    convertCoords: (longitude, latitude) => [longitude, latitude],
    routeForEvent: () => null,
    linkFlightAirports: async entry => {
      linked += 1;
      state.locations.push(
        { id: 'departure', name: entry.flightInfo.departureAirport, address: '福州长乐国际机场', resolved: { location: '119.66,25.93' } },
        { id: 'arrival', name: entry.flightInfo.arrivalAirport, address: '北京大兴国际机场', resolved: { location: '116.41,39.51' } }
      );
      entry.flightInfo.departurePlaceId = 'departure';
      entry.flightInfo.arrivalPlaceId = 'arrival';
      return true;
    },
    getEditingIndex: () => 0,
    save: () => {},
    refresh: () => {}
  });

  await controller.queryEvent(0);

  assert.equal(linked, 1);
  assert.deepEqual(requests.map(request => request.time), ['09:05', '11:40']);
  assert.match(nodes['#editorWeatherStatus'].textContent, /起飞：.*降落：/);
});

test('one-hour routes use midpoint weather while longer ordinary events use start and end weather', async () => {
  const locations = [
    { id: 'origin', name: '起点', address: '起点地址', resolved: { location: '120,30' } },
    { id: 'destination', name: '终点', address: '终点地址', resolved: { location: '122,32' } },
    { id: 'place', name: '景点', address: '景点地址', resolved: { location: '121,31' } }
  ];
  const route = { type: 'drive', date: '2026-08-24', start: '09:00', end: '10:00', routeLinks: { originPlaceId: 'origin', destinationPlaceId: 'destination' } };
  const visit = { type: 'spot', date: '2026-08-24', start: '10:00', end: '11:01', locationId: 'place' };
  const state = { schedule: [route, visit], locations };
  const requests = [];
  const controller = createWeatherController({
    state,
    $: selector => selector === '#eventEditor' ? { open: false } : null,
    api: { getWeather: async request => { requests.push(request); return { conditionText: '晴', temperature: requests.length }; } },
    geocode: async () => { throw new Error('coordinates should already be resolved'); },
    convertCoords: (longitude, latitude) => [longitude, latitude],
    routeForEvent: () => null,
    getEditingIndex: () => -1,
    save: () => {},
    refresh: () => {}
  });

  await controller.queryEvent(0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].time, '09:30');
  assert.ok(route.weather.midpoint);

  requests.length = 0;
  await controller.queryEvent(1);
  assert.deepEqual(requests.map(request => request.time), ['10:00', '11:01']);
  assert.ok(visit.weather.origin);
  assert.ok(visit.weather.destination);
});

test('bulk weather updates report success and failures through the schedule status region', async () => {
  const state = {
    dayFilter: '2026-08-24',
    locations: [{ id: 'resolved', name: '已定位景点', address: '景点地址', resolved: { location: '121,31' } }],
    schedule: [
      { type: 'spot', title: '已定位景点', date: '2026-08-24', start: '10:00', end: '11:00', locationId: 'resolved' },
      { type: 'spot', title: '未关联地点', date: '2026-08-24', start: '12:00', end: '13:00' }
    ]
  };
  const batchStatus = { hidden: true, textContent: '', dataset: {} };
  const button = { disabled: false, textContent: '更新卡片天气' };
  const controller = createWeatherController({
    state,
    $: selector => selector === '#eventEditor' ? { open: false } : null,
    api: { getWeather: async () => ({ conditionText: '晴', temperature: 26 }) },
    geocode: async () => { throw new Error('unexpected geocode'); },
    convertCoords: (longitude, latitude) => [longitude, latitude],
    routeForEvent: () => null,
    getEditingIndex: () => -1,
    save: () => {},
    refresh: () => {},
    batchStatus
  });

  await controller.updateVisible(button);

  assert.equal(batchStatus.hidden, false);
  assert.equal(batchStatus.dataset.tone, 'warning');
  assert.match(batchStatus.textContent, /已更新 1 张卡片，1 张未更新/);
  assert.match(batchStatus.textContent, /未关联地点/);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, '更新卡片天气');
});
