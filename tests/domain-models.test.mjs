import assert from 'node:assert/strict';
import test from 'node:test';
import { findMatchingLocation, mapDisplayType, suggestedPlaceName, syncPlaceToUniversal } from '../public/features/places/model.js';
import { calculatePriceInfo, normalizedPriceItems } from '../public/features/costs/model.js';
import { parseFlightStopover } from '../public/features/flights/model.js';
import { shiftScheduleEntries, snapScheduleDrop } from '../public/features/schedule/interactions.js';
import { boxesOverlap, calloutBox } from '../public/features/map/photo-layout.js';

test('place model matches resolved coordinates and keeps universal identity', () => {
  const universal = [{ id: 'universal', name: '赛里木湖', address: '新疆赛里木湖', resolved: { location: '81,44' } }];
  const planPlace = { id: 'plan', name: '赛里木湖景区', address: '新地址', resolved: { location: '81,44' } };
  assert.equal(findMatchingLocation(universal, planPlace.address, planPlace.name, '81,44').id, 'universal');
  syncPlaceToUniversal(planPlace, universal);
  assert.equal(universal[0].id, 'universal');
  assert.equal(universal[0].name, '赛里木湖景区');
  assert.equal(mapDisplayType('fuel'), 'supply');
  assert.equal(suggestedPlaceName('白沙湖', '', '默认'), '白沙湖');
});

test('schedule interactions shift and snap without DOM', () => {
  const schedule = [{ date: '2026-08-15', start: '09:00', end: '10:30' }, { date: '2026-08-15', start: '11:00', end: '12:00' }];
  shiftScheduleEntries(schedule, new Set([0]), 30);
  assert.deepEqual([schedule[0].start, schedule[0].end], ['09:30', '11:00']);
  const clock = value => { const [hour, minute] = value.split(':').map(Number); return hour * 60 + minute; };
  assert.equal(snapScheduleDrop(schedule, '2026-08-15', 12 * 60 + 20, [], clock), 12 * 60);
});

test('cost, flight and photo layout models normalize legacy data', () => {
  const normalized = normalizedPriceItems({ ticketPrice: 120, people: 2, vehicleFee: 80 });
  assert.equal(calculatePriceInfo(normalized.perPersonItems, normalized.sharedItems).total, 320);
  assert.deepEqual(parseFlightStopover('经停 郑州新郑国际机场，12:30–14:00'), { stopoverAirport: '郑州新郑国际机场', stopoverArrivalTime: '12:30', stopoverDepartureTime: '14:00' });
  const first = calloutBox({ x: 100, y: 100 }, 'top');
  const second = calloutBox({ x: 105, y: 100 }, 'top');
  assert.equal(boxesOverlap(first, second), true);
});
