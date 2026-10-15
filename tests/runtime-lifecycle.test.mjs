import assert from 'node:assert/strict';
import test from 'node:test';
import { startRuntimeLifecycle } from '../public/features/runtime/lifecycle.js';

test('runtime lifecycle initializes the map once and cleans every controller on pagehide', async () => {
  const eventTarget = new EventTarget();
  const calls = [];
  let map = null;
  let receivedMobileOptions;
  let readyDetail;
  eventTarget.addEventListener('planner:ready', event => { readyDetail = event.detail; });
  const lifecycle = startRuntimeLifecycle({
    createInitializer: ensureMapReady => async () => {
      calls.push('planner');
      await ensureMapReady();
      return { dataStatus: 'offline' };
    },
    initMap: async () => { calls.push('map-init'); map = { invalidateSize: () => calls.push('invalidate') }; return true; },
    getMap: () => map,
    showDayOverview: async date => calls.push(['overview', date]),
    fitOverview: () => calls.push('fit'),
    bindMobileEvents: options => {
      receivedMobileOptions = options;
      return { destroy: () => calls.push('mobile-destroy') };
    },
    mobileEventOptions: { marker: 'mobile-options' },
    cleanupControllers: [{ destroy: () => calls.push('controller-destroy') }],
    eventTarget,
    setTimer: callback => callback()
  });

  await Promise.all([lifecycle.ensureMapReady(), lifecycle.ensureMapReady(), lifecycle.plannerReady]);
  assert.equal(calls.filter(call => call === 'map-init').length, 1);
  assert.equal(receivedMobileOptions.marker, 'mobile-options');
  assert.equal(receivedMobileOptions.ensureMapReady, lifecycle.ensureMapReady);
  assert.deepEqual(readyDetail, { dataStatus: 'offline' });
  assert.deepEqual(calls.slice(0, 5), ['planner', 'map-init', ['overview', ''], 'invalidate', 'fit']);

  eventTarget.dispatchEvent(new Event('pagehide'));
  assert.deepEqual(calls.slice(-2), ['mobile-destroy', 'controller-destroy']);
});

test('runtime lifecycle converts initialization failure into non-blocking UI feedback', async () => {
  const eventTarget = new EventTarget();
  const status = { textContent: '' };
  const errors = [];
  const toasts = [];
  let readyEvents = 0;
  let readyDetail;
  eventTarget.addEventListener('planner:ready', event => { readyEvents += 1; readyDetail = event.detail; });
  const lifecycle = startRuntimeLifecycle({
    createInitializer: () => async () => { throw new Error('offline'); },
    initMap: async () => false,
    getMap: () => null,
    showDayOverview: async () => {},
    fitOverview: () => {},
    bindMobileEvents: () => ({ destroy() {} }),
    mobileEventOptions: {},
    statusNode: () => status,
    showToast: message => toasts.push(message),
    eventTarget,
    logger: { error: (...args) => errors.push(args) }
  });

  await lifecycle.plannerReady;
  assert.equal(status.textContent, '初始化未完成，请刷新或重新登录');
  assert.deepEqual(toasts, ['初始化遇到问题，已进入可操作界面']);
  assert.equal(errors[0][0], 'Planner initialization failed');
  assert.equal(readyEvents, 1);
  assert.deepEqual(readyDetail, { dataStatus: 'error' });
});

test('runtime lifecycle retries initialization safely without running twice at once', async () => {
  const eventTarget = new EventTarget();
  const details = [];
  let runs = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  eventTarget.addEventListener('planner:ready', event => details.push(event.detail));
  const lifecycle = startRuntimeLifecycle({
    createInitializer: () => async () => {
      runs += 1;
      if (runs > 1) { await gate; return { dataStatus: 'ready' }; }
      return { dataStatus: 'preset' };
    },
    initMap: async () => false,
    getMap: () => null,
    showDayOverview: async () => {},
    fitOverview: () => {},
    bindMobileEvents: () => ({ destroy() {} }),
    mobileEventOptions: {},
    eventTarget
  });

  await lifecycle.plannerReady;
  assert.deepEqual(details, [{ dataStatus: 'preset' }]);

  const firstRetry = lifecycle.retry();
  const secondRetry = lifecycle.retry();
  assert.equal(firstRetry, secondRetry, '并发的重试不得重复执行初始化');
  release();
  await firstRetry;

  assert.equal(runs, 2, '首轮 + 一次重试');
  assert.deepEqual(details, [{ dataStatus: 'preset' }, { dataStatus: 'ready' }]);

  eventTarget.dispatchEvent(new Event('pagehide'));
});
