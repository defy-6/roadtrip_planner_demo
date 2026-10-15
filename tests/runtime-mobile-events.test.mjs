import assert from 'node:assert/strict';
import test from 'node:test';
import { bindRuntimeMobileEvents } from '../public/features/runtime/mobile-events.js';

function setup(overrides = {}) {
  const target = new EventTarget();
  const nodes = {
    '#fileSaveStatus': { dataset: {}, textContent: '' },
    '#tripName': { value: '' },
    '#mapDayFilter': { value: '' },
    '#dayFilter': { value: '', options: [{ value: '' }, { value: '2026-11-03' }] }
  };
  const calls = [];
  const binding = bindRuntimeMobileEvents({
    eventTarget: target,
    plannerReady: Promise.resolve(),
    $: selector => nodes[selector],
    api: {},
    persistence: { autoSaveEnabled: false },
    save: options => calls.push(['save', options]),
    getMap: () => null,
    ensureMapReady: async () => true,
    showDayOverview: async date => calls.push(['overview', date]),
    changeDayFilter: async date => calls.push(['date', date]),
    renderLocations: () => calls.push('locations'),
    cycleBaseLayer: () => '影像',
    clearMapSelection: async () => calls.push('clear'),
    fitOverview: () => calls.push('fit'),
    locate: () => calls.push('locate'),
    focusScheduleEvent: (...args) => calls.push(['route', ...args]),
    showPlaceOnMap: async id => calls.push(['place', id]),
    showToast: (...args) => calls.push(['toast', ...args]),
    requestFrame: callback => callback(),
    ...overrides
  });
  return { target, nodes, calls, binding };
}

test('mobile save event reports read-only state without attempting persistence', () => {
  const context = setup();
  context.target.dispatchEvent(new CustomEvent('mobile:save'));
  assert.equal(context.nodes['#fileSaveStatus'].textContent, '当前为只读预览，无法保存');
  assert.equal(context.nodes['#fileSaveStatus'].dataset.tone, 'warning');
  assert.equal(context.calls.some(call => Array.isArray(call) && call[0] === 'save'), false);
  assert.deepEqual(context.calls.at(-1), ['toast', '当前为只读预览，无法保存', 'warning']);
  context.binding.destroy();
});

test('mobile save event explains the read-failure gate instead of claiming a read-only preview', () => {
  const context = setup({ persistence: { autoSaveEnabled: false, editable: true } });
  context.target.dispatchEvent(new CustomEvent('mobile:save'));
  assert.equal(context.nodes['#fileSaveStatus'].textContent, '尚未读取到最新行程数据，暂时无法保存，请先重试读取');
  assert.equal(context.nodes['#fileSaveStatus'].dataset.tone, 'warning');
  assert.equal(context.calls.some(call => Array.isArray(call) && call[0] === 'save'), false);
  assert.deepEqual(context.calls.at(-1), ['toast', '尚未读取到最新行程数据，暂时无法保存，请先重试读取', 'warning']);
  context.binding.destroy();
});

test('place focus uses the shared date transition before focusing the place', async () => {
  const context = setup();
  context.target.dispatchEvent(new CustomEvent('mobile:placefocus', { detail: { placeId: 'hotel', date: '2026-11-03' } }));
  await Promise.resolve();
  assert.deepEqual(context.calls, [['date', '2026-11-03'], ['place', 'hotel']]);
  context.calls.length = 0;
  context.target.dispatchEvent(new CustomEvent('mobile:placefocus', { detail: { placeId: 'hotel', date: '2026-12-01' } }));
  await Promise.resolve();
  assert.deepEqual(context.calls, [['place', 'hotel']]);
  context.binding.destroy();
});

test('mobile event bridge delegates map, route and trip actions and can be destroyed', async () => {
  const map = { invalidateSize() {} };
  const updates = [];
  const context = setup({
    getMap: () => map,
    persistence: { autoSaveEnabled: true },
    api: { getActiveTripId: () => 'trip-a', updateTrip: async (...args) => updates.push(args) }
  });
  context.target.dispatchEvent(new CustomEvent('mobile:mapaction', { detail: { action: 'locate' } }));
  context.target.dispatchEvent(new CustomEvent('mobile:routefocus', { detail: { index: 3 } }));
  context.target.dispatchEvent(new CustomEvent('mobile:triprename', { detail: { name: '  新行程  ' } }));
  context.target.dispatchEvent(new CustomEvent('mobile:save'));
  await Promise.resolve();

  assert.equal(context.nodes['#tripName'].value, '新行程');
  assert.equal(context.calls.includes('locate'), true);
  assert.equal(context.calls.some(call => Array.isArray(call) && call[0] === 'route' && call[1] === 3), true);
  assert.deepEqual(updates, [], '名称随同完整快照提交，不产生独立的半成功写入');
  assert.equal(context.calls.some(call => Array.isArray(call) && call[0] === 'save' && call[1]?.manual), true);

  context.binding.destroy();
  const before = context.calls.length;
  context.target.dispatchEvent(new CustomEvent('mobile:mapaction', { detail: { action: 'locate' } }));
  assert.equal(context.calls.length, before);
});
