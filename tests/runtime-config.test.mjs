import assert from 'node:assert/strict';
import test from 'node:test';
import {
  amapKeywords,
  eventTypeNames,
  presetNodeTimes,
  sharedScheduleStorageKey,
  typeForTitle,
  versionStorageKey
} from '../public/features/runtime/config.js';

test('runtime event title classification preserves transport and activity semantics', () => {
  assert.equal(typeForTitle('CZ8954 航班'), 'flight');
  assert.equal(typeForTitle('机场吃午餐'), 'food');
  assert.equal(typeForTitle('酒店入住'), 'hotel');
  assert.equal(typeForTitle('抵达机场取行李'), 'transport');
  assert.equal(typeForTitle('服务区加油'), 'fuel');
  assert.equal(typeForTitle('前往赛里木湖'), 'drive');
  assert.equal(typeForTitle('游览古城'), 'spot');
  assert.equal(eventTypeNames.transport, '交通');
  assert.equal(eventTypeNames.supply, '补给');
});

test('runtime presets and storage keys remain compatible with saved planner data', () => {
  assert.deepEqual(presetNodeTimes['2026-08-22|阿图什天门'], ['13:15', '16:30']);
  assert.equal(amapKeywords.伊宁机场, '伊犁伊宁国际机场');
  assert.equal(versionStorageKey('north-plan'), 'roadtrip-version-north-plan');
  assert.equal(sharedScheduleStorageKey, 'roadtrip-shared-schedule-through-0819');
});
