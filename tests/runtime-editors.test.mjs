import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntimeEditors, waitForScheduleEdit } from '../public/features/runtime/editors.js';

test('schedule edit outcome distinguishes cancellation, moved dates and deletion', async () => {
  for (const action of ['cancel', 'move', 'delete']) {
    const editor = new EventTarget();
    editor.open = false;
    const schedule = [{ date: '2026-08-15' }, { date: '2026-08-16' }];
    const pending = waitForScheduleEdit({ editor, schedule, index: 0, open: () => { editor.open = true; } });
    if (action === 'move') schedule[0] = { date: '2026-09-02' };
    if (action === 'delete') schedule.splice(0, 1);
    editor.open = false;
    editor.dispatchEvent(new Event('close'));
    assert.deepEqual(await pending, { deleted: action === 'delete', dateChanged: action !== 'cancel' });
  }
});

test('schedule edit returns when opening is refused and propagates opening errors', async () => {
  const editor = new EventTarget();
  editor.open = false;
  const options = { editor, schedule: [{ date: '2026-08-15' }], index: 0 };
  assert.deepEqual(await waitForScheduleEdit({ ...options, open: () => {} }), { deleted: false, dateChanged: false });
  await assert.rejects(waitForScheduleEdit({ ...options, open: () => { throw new Error('无法打开'); } }), /无法打开/);
});

test('runtime editors wires weather, schedule editing and expenses as one bounded suite', () => {
  const calls = [];
  let weatherOptions;
  let scheduleOptions;
  let expenseOptions;
  const queryEvent = () => {};
  const nodes = { '#tripName': { value: '新疆自驾游' } };
  const $ = selector => nodes[selector] ||= { selector };
  const openScheduleEditor = (...args) => calls.push(['schedule-open', ...args]);
  const result = createRuntimeEditors({
    $,
    state: { schedule: [{ id: 1 }] },
    api: {}, geocode() {}, convertCoords() {}, weatherStatus: {},
    costs: { renderEditorPriceItems() {}, collectEditorPriceInfo() {} },
    routeServices: { linkFlightAirports() {}, linkTrainStations() {}, route: { resolveInlinePlace() {}, calculateDriveRoute() {} } },
    routeMeta: { routeForScheduleEvent() {} },
    placeServices: {}, persistenceServices: {}, nodeServices: {},
    renderers: {
      renderLocations: () => calls.push('locations'),
      renderSchedule: entries => calls.push(['schedule', entries.length]),
      applyDayFilter: () => calls.push('filter'),
      renderRouteTotals() {}, showDayOverview() {}, focusScheduleEvent() {}
    },
    meta: {}, itemsEl: {}, values() {}, escapeHtml: value => value,
    confirmAction() {}, save: () => calls.push('save'),
    weatherFactory: options => {
      weatherOptions = options;
      return { queryEvent, updateVisible: button => calls.push(['weather', button]) };
    },
    scheduleFactory: options => {
      scheduleOptions = options;
      return {
        openScheduleEditor,
        cancelScheduleEditor: () => calls.push('cancel'),
        deleteScheduleEvent: () => calls.push('delete'),
        getEditingIndex: () => 4
      };
    },
    expenseFactory: options => {
      expenseOptions = options;
      return { open: () => calls.push('ledger') };
    },
    workbookExporter: (entries, name) => calls.push(['workbook', entries, name])
  });

  assert.equal(weatherOptions.getEditingIndex(), 4);
  assert.equal(scheduleOptions.services.weather, queryEvent);
  assert.equal(scheduleOptions.elements.editorDeleteButton, nodes['#editorDelete']);
  assert.equal(expenseOptions.openScheduleEditor, openScheduleEditor);
  assert.equal(expenseOptions.confirmAction, scheduleOptions.confirmAction);
  assert.equal(scheduleOptions.getContext, expenseOptions.getContext);
  assert.deepEqual(expenseOptions.getContext(), { tripName: '新疆自驾游', planName: '' });
  assert.equal(expenseOptions.canEdit(), true);
  nodes['#addScheduleBtn'].disabled = true;
  assert.equal(expenseOptions.canEdit(), false);
  nodes['#addScheduleBtn'].disabled = false;
  scheduleOptions.meta.isShareMode = true;
  assert.equal(expenseOptions.canEdit(), false);
  scheduleOptions.meta.isShareMode = false;
  weatherOptions.refresh();
  result.updateScheduleWeather('button');
  result.openExpenseLedger();
  expenseOptions.exportWorkbook([{ amount: 10 }]);
  result.openScheduleEditor(2, true);
  assert.deepEqual(calls, [
    ['schedule', 1], 'filter', 'locations',
    ['weather', 'button'], 'ledger',
    ['workbook', [{ amount: 10 }], '新疆自驾游'],
    ['schedule-open', 2, true]
  ]);
});
