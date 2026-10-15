import assert from 'node:assert/strict';
import test from 'node:test';
import { findMatchingLocation, mapDisplayType, suggestedPlaceName, syncPlaceToUniversal } from '../public/features/places/model.js';
import { calculatePriceInfo, createExpenseExportEntries, normalizedPriceItems } from '../public/features/costs/model.js';
import { parseFlightStopover } from '../public/features/flights/model.js';
import { shiftScheduleEntries, snapScheduleDrop } from '../public/features/schedule/interactions.js';
import { boxesOverlap, calloutBox } from '../public/features/map/photo-layout.js';
import { createExpenseWorkbook } from '../public/features/export/expense-xlsx.js';
import { arrowDirectionVector, mapExportLayerPriority, mapExportPointRadius } from '../public/features/export/canvas.js';
import { weatherBackgroundKey, weatherCategory, weatherVisualKey } from '../public/features/weather/index.js';

test('weather classification uses provider codes across twenty stable UI categories', () => {
  const qweather = code => weatherCategory({ provider: 'qweather', conditionCode: code });
  assert.deepEqual(
    ['100', '102', '103', '101', '104', '309', '300', '305', '310', '302', '304', '400', '401', '403', '404', '313', '501', '502', '503', '507'].map(qweather),
    ['clear', 'mostly-clear', 'partly-cloudy', 'cloudy', 'overcast', 'drizzle', 'shower', 'rain', 'heavy-rain', 'thunder', 'hail', 'light-snow', 'snow', 'heavy-snow', 'sleet', 'freezing-rain', 'fog', 'haze', 'dust', 'sandstorm']
  );
  assert.equal(weatherVisualKey({ provider: 'qweather', conditionCode: '103' }), 'mostly-sunny');
  assert.equal(weatherVisualKey({ provider: 'qweather', conditionCode: '310' }), 'storm');
  assert.equal(weatherBackgroundKey({ provider: 'qweather', conditionCode: '103', isNight: false }), 'partly-cloudy-day');
  assert.equal(weatherBackgroundKey({ provider: 'qweather', conditionCode: '153', isNight: true }), 'partly-cloudy-night');
  assert.equal(weatherBackgroundKey({ provider: 'qweather', conditionCode: '304', isNight: false }), 'thunder-day');
  assert.equal(weatherBackgroundKey({ provider: 'qweather', conditionCode: '410', isNight: true }), 'snow-night');
  assert.equal(weatherBackgroundKey({ conditionText: '天气待定' }), '');
});

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

test('expense workbook exports a valid xlsx container with daily summary', async () => {
  const { blob, filename } = createExpenseWorkbook([
    { date: '2026-08-20', category: '餐饮', note: '午餐', source: 'event', amount: 128.5 },
    { date: '2026-08-20', category: '交通', note: '停车', source: 'expense', amount: 20 }
  ], '新疆自驾游');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(filename, '新疆自驾游-每日开销.xlsx');
});

test('expense export keeps every price item instead of aggregating by event', () => {
  const rows = createExpenseExportEntries({
    schedule: [{
      date: '2026-08-20', type: 'spot', title: '景区游览',
      priceInfo: { perPersonItems: [{ amount: 80, people: 2, note: '成人票' }, { amount: 40, people: 1, note: '学生票' }], sharedItems: [{ amount: 30, note: '停车费' }] }
    }],
    expenses: [{ id: 'meal-1', date: '2026-08-20', category: '餐饮', note: '晚餐', amount: 120 }]
  });
  assert.equal(rows.length, 4);
  const byItem = Object.fromEntries(rows.map(item => [item.item, item]));
  assert.deepEqual([byItem['成人票'].unitPrice, byItem['成人票'].people, byItem['成人票'].amount], [80, 2, 160]);
  assert.deepEqual([byItem['学生票'].unitPrice, byItem['学生票'].people, byItem['学生票'].amount], [40, 1, 40]);
  assert.deepEqual([byItem['停车费'].pricingMode, byItem['停车费'].amount], ['共同费用', 30]);
  assert.deepEqual([byItem['晚餐'].pricingMode, byItem['晚餐'].amount], ['独立账目', 120]);
});

test('expense export follows event time and preserves item entry order', () => {
  const rows = createExpenseExportEntries({ schedule: [
    { date: '2026-08-20', start: '14:00', title: '下午活动', priceInfo: { sharedItems: [{ amount: 20, note: '第二场费用' }] } },
    { date: '2026-08-20', start: '08:30', title: '早餐', priceInfo: { perPersonItems: [{ amount: 10, people: 2, note: '成人早餐' }, { amount: 6, people: 1, note: '儿童早餐' }], sharedItems: [{ amount: 5, note: '包间费' }] } },
    { date: '2026-08-19', start: '20:00', title: '前一天晚餐', priceInfo: { sharedItems: [{ amount: 88, note: '晚餐' }] } }
  ] });
  assert.deepEqual(rows.map(item => item.item), ['晚餐', '成人早餐', '儿童早餐', '包间费', '第二场费用']);
});

test('map export arrow follows the full route tangent angle without a 90 degree offset', () => {
  const east = arrowDirectionVector(0), southeast = arrowDirectionVector(37), south = arrowDirectionVector(90);
  assert.ok(east.x > .99 && Math.abs(east.y) < .001);
  assert.ok(Math.abs(southeast.x - Math.cos(37 * Math.PI / 180)) < .001);
  assert.ok(Math.abs(southeast.y - Math.sin(37 * Math.PI / 180)) < .001);
  assert.ok(Math.abs(south.x) < .001 && south.y > .99);
});

test('map export draws smaller place points below routes and keeps arrows above routes', () => {
  assert.ok(mapExportLayerPriority('place') < mapExportLayerPriority('route'));
  assert.ok(mapExportLayerPriority('route') < mapExportLayerPriority('arrow'));
  assert.equal(mapExportPointRadius(8), 3.5);
  assert.equal(mapExportPointRadius(4), 2.4);
});
