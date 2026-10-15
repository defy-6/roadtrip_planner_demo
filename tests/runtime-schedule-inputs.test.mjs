import assert from 'node:assert/strict';
import test from 'node:test';
import { bindRuntimeScheduleInputs } from '../public/features/runtime/schedule-inputs.js';

test('runtime schedule inputs share one schedule contract across mouse, touch and transport import', () => {
  let dragOptions;
  let touchOptions;
  let importerOptions;
  const schedule = { id: 'schedule' };
  const state = { dayFilter: '2026-08-15', schedule: [{ id: 1 }] };
  const renderers = {
    renderSchedule() {}, applyDayFilter() {}, renderLocations() {}, showDayOverview() {}
  };
  const scheduleView = {
    selectedIndexes: new Set([0]), hourHeight: () => 42, snapDrop() {},
    setSelectionAnchor() {}, suppressClick() {}
  };
  const runtimePlaces = { getDraggingPlaceId: () => 'place-1', clearDraggingPlace() {} };
  const result = bindRuntimeScheduleInputs({
    $: selector => selector === '#schedule' ? schedule : null,
    state, isShareMode: true, scheduleView, runtimePlaces,
    placeDropController: { id: 'drop' }, updateNode() {}, save() {}, renderers,
    time: { clockToMinute() {}, minuteToClock() {} },
    flight: { linkFlightAirports() {}, linkTrainStations() {} },
    addItem() {}, focusScheduleEvent() {},
    dragBinder: options => { dragOptions = options; return 'drag'; },
    touchBinder: options => { touchOptions = options; return 'touch'; },
    importerBinder: options => { importerOptions = options; return 'importer'; }
  });

  assert.deepEqual(result, { drag: 'drag', touch: 'touch', importer: 'importer' });
  assert.equal(dragOptions.schedule, schedule);
  assert.equal(dragOptions.selectedIndexes, scheduleView.selectedIndexes);
  assert.equal(dragOptions.getDraggingPlaceId, runtimePlaces.getDraggingPlaceId);
  assert.equal(dragOptions.placeDropController.id, 'drop');
  assert.equal(touchOptions.schedule, schedule);
  assert.equal(touchOptions.getDraggingPlaceId, undefined);
  assert.equal(dragOptions.isReadOnly(), true);
  assert.equal(importerOptions.renderSchedule, renderers.renderSchedule);
  assert.equal(importerOptions.renderLocations, renderers.renderLocations);
});
