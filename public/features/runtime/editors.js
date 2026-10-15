import { createExpenseLedger } from '../costs/ledger.js?v=map-photo-connectors-20260825-1';
import { exportExpenseWorkbook } from '../export/expense-xlsx.js?v=map-photo-connectors-20260825-1';
import { createScheduleEditor } from '../schedule/editor.js';
import { createWeatherController } from '../weather/controller.js';

export function waitForScheduleEdit({ editor, schedule, index, open }) {
  const count = schedule.length;
  const date = schedule[index]?.date;
  return new Promise((resolve, reject) => {
    const closed = () => resolve({ deleted: schedule.length < count, dateChanged: schedule[index]?.date !== date });
    editor.addEventListener('close', closed, { once: true });
    try {
      open(index);
      if (!editor.open) { editor.removeEventListener('close', closed); closed(); }
    } catch (error) {
      editor.removeEventListener('close', closed);
      reject(error);
    }
  });
}

export function createRuntimeEditors({
  $,
  state,
  api,
  geocode,
  convertCoords,
  weatherStatus,
  costs,
  routeServices,
  routeMeta,
  placeServices,
  persistenceServices,
  nodeServices,
  renderers,
  meta,
  itemsEl,
  values,
  escapeHtml,
  confirmAction,
  save,
  getContext = () => ({ tripName: $('#tripName').value, planName: $('#planSelect').selectedOptions?.[0]?.textContent || '' }),
  weatherFactory = createWeatherController,
  scheduleFactory = createScheduleEditor,
  expenseFactory = createExpenseLedger,
  workbookExporter = exportExpenseWorkbook
}) {
  let scheduleEditor;
  const weatherController = weatherFactory({
    state, $, api, geocode, convertCoords,
    routeForEvent: routeMeta.routeForScheduleEvent,
    linkFlightAirports: routeServices.linkFlightAirports,
    linkTrainStations: routeServices.linkTrainStations,
    getEditingIndex: () => scheduleEditor.getEditingIndex(),
    save,
    batchStatus: weatherStatus,
    refresh: () => {
      renderers.renderSchedule(state.schedule);
      renderers.applyDayFilter();
      renderers.renderLocations();
    }
  });
  scheduleEditor = scheduleFactory({
    state, $, escapeHtml, itemsEl, values, confirmAction, getContext,
    elements: {
      editorDeleteButton: $('#editorDelete'),
      routeEditorSection: $('#routeEditorSection'),
      flightFields: $('#flightFields'),
      eventLocationField: $('#eventLocationField'),
      weatherFields: $('#editorWeatherFields')
    },
    costs,
    services: {
      geocode,
      weather: weatherController.queryEvent,
      route: routeServices.route
    },
    routes: routeMeta,
    places: placeServices,
    persistence: persistenceServices,
    nodes: nodeServices,
    events: {
      onFocus: renderers.focusScheduleEvent,
      onRender: {
        renderLocations: renderers.renderLocations,
        renderSchedule: renderers.renderSchedule,
        applyDayFilter: renderers.applyDayFilter,
        renderRouteTotals: renderers.renderRouteTotals,
        showDayOverview: renderers.showDayOverview
      }
    },
    meta
  });
  const expenseLedger = expenseFactory({
    state,
    save,
    confirmAction,
    canEdit: () => !meta.isShareMode && !$('#addScheduleBtn').disabled,
    getContext,
    openScheduleEditor: scheduleEditor.openScheduleEditor,
    escapeHtml,
    exportWorkbook: entries => workbookExporter(entries, $('#tripName').value)
  });
  return {
    openScheduleEditor: scheduleEditor.openScheduleEditor,
    editScheduleAndWait: index => waitForScheduleEdit({ editor: $('#eventEditor'), schedule: state.schedule, index, open: scheduleEditor.openScheduleEditor }),
    cancelScheduleEditor: scheduleEditor.cancelScheduleEditor,
    deleteScheduleEvent: scheduleEditor.deleteScheduleEvent,
    updateScheduleWeather: button => weatherController.updateVisible(button),
    openExpenseLedger: event => expenseLedger.open(event?.detail?.opener)
  };
}
