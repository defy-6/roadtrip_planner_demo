import { bindFlightImporter } from '../flights/importer.js';
import { bindScheduleDragDrop, bindScheduleTouchDrag } from '../schedule/drag-resize.js';

export function bindRuntimeScheduleInputs({
  $,
  state,
  isShareMode,
  scheduleView,
  runtimePlaces,
  placeDropController,
  updateNode,
  save,
  renderers,
  time,
  flight,
  addItem,
  focusScheduleEvent,
  dragBinder = bindScheduleDragDrop,
  touchBinder = bindScheduleTouchDrag,
  importerBinder = bindFlightImporter
}) {
  const sharedDragOptions = {
    state,
    schedule: $('#schedule'),
    isReadOnly: () => isShareMode,
    selectedIndexes: scheduleView.selectedIndexes,
    clockToMinute: time.clockToMinute,
    minuteToClock: time.minuteToClock,
    getHourHeight: scheduleView.hourHeight,
    snapDrop: scheduleView.snapDrop,
    updateNode,
    save,
    renderSchedule: () => renderers.renderSchedule(state.schedule),
    applyDayFilter: renderers.applyDayFilter,
    showDayOverview: () => renderers.showDayOverview(state.dayFilter),
    suppressClick: scheduleView.suppressClick
  };
  const drag = dragBinder({
    ...sharedDragOptions,
    getDraggingPlaceId: runtimePlaces.getDraggingPlaceId,
    clearDraggingPlace: runtimePlaces.clearDraggingPlace,
    placeDropController,
    renderLocations: renderers.renderLocations,
    setSelectionAnchor: scheduleView.setSelectionAnchor
  });
  const touch = touchBinder(sharedDragOptions);
  const importer = importerBinder({
    $, state,
    clockToMinute: time.clockToMinute,
    linkFlightAirports: flight.linkFlightAirports,
    linkTrainStations: flight.linkTrainStations,
    addItem,
    renderSchedule: renderers.renderSchedule,
    applyDayFilter: renderers.applyDayFilter,
    save,
    renderLocations: renderers.renderLocations,
    focusScheduleEvent
  });
  return { drag, touch, importer };
}
