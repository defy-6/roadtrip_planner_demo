import assert from 'node:assert/strict';
import test from 'node:test';
import { createHistoryController } from '../public/core/history.js';

function setup({ enabled = true } = {}) {
  let data = { count: 0 };
  const calls = [];
  const controller = createHistoryController({
    enabled: () => enabled,
    createSnapshot: () => structuredClone(data),
    restoreSnapshot: raw => { data = JSON.parse(raw); calls.push('restore'); },
    onStateChange: state => { calls.push(`state:${state.canUndo ? 'u' : ''}${state.canRedo ? 'r' : ''}`); }
  });
  return { controller, data, calls, getData: () => data };
}

test('history commits snapshot and tracks undo/redo', () => {
  const { controller, data, getData } = setup();
  data.count = 1; controller.commit();   // 首提交只建立基线
  data.count = 2; controller.commit();   // 压入 count=1
  data.count = 3; controller.commit();   // 压入 count=2
  assert.equal(controller.state().canUndo, true);
  controller.undo();
  assert.equal(getData().count, 2);
  assert.equal(controller.state().canRedo, true);
  controller.undo();
  assert.equal(getData().count, 1);
  controller.redo();
  assert.equal(getData().count, 2);
  controller.redo();
  assert.equal(getData().count, 3);
  assert.equal(controller.state().canRedo, false);
});

test('history ignores commits while restoring and when disabled', () => {
  const { controller, data, calls } = setup({ enabled: false });
  data.count = 5; controller.commit();
  assert.equal(controller.state().canUndo, false);
  data.count = 6; controller.commit();
  assert.equal(controller.state().canUndo, false);
  assert.equal(calls.filter(call => call === 'restore').length, 0);
});

test('history honors stack limit', () => {
  const { getData } = setup();
  let limited = getData();
  const controllerLimited = createHistoryController({
    enabled: () => true,
    createSnapshot: () => structuredClone(limited),
    restoreSnapshot: raw => { limited = JSON.parse(raw); },
    onStateChange: () => {},
    limit: 2
  });
  for (let i = 0; i < 6; i += 1) { limited.count = i; controllerLimited.commit(); }
  controllerLimited.undo(); controllerLimited.undo(); controllerLimited.undo();
  assert.equal(limited.count, 3); // 只保留最近 2 个历史：可 undo 2 次，第 3 次无效
});
