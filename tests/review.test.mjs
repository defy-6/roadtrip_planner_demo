import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewDays } from '../public/features/review/model.js';

test('review groups and orders existing events without modifying source data', () => {
  const events = [{ date: '2026-08-16', start: '12:00', title: '午餐' }, { date: '2026-08-15', start: '10:00', title: '散步', detail: '已有备注', locationId: 'lake' }, { date: '', title: '待定' }];
  const before = JSON.stringify(events);
  const result = reviewDays(events, [{ id: 'lake', name: '湖边', note: '预约信息', photo: '/lake.jpg' }]);
  assert.deepEqual(result.map(day => day.date), ['2026-08-15', '2026-08-16', '']);
  assert.equal(result[0].events[0].photo, '/lake.jpg');
  assert.equal(result[0].events[0].note, '已有备注');
  assert.deepEqual(result.map(day => day.events[0].eventIndex), [1, 0, 2]);
  assert.equal(JSON.stringify(events), before);
  assert.deepEqual(reviewDays(), []);
});

test('review includes expense-only days and distinguishes absent fees from explicit zero', () => {
  const result = reviewDays([{ date: '2026-08-15', title: '散步' }], [], [
    { date: '2026-08-16', amount: 12.5, item: '停车' },
    { date: '2026-08-17', amount: 0, item: '免费' },
    { date: '2026-08-18', amount: NaN },
  ]);
  assert.deepEqual(result.map(day => day.expenseTotal), [null, 12.5, 0]);
  assert.equal(result[1].events.length, 0);
  assert.equal(result[1].expenses.length, 1);
});
