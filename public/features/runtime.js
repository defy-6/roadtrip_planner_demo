import { PRESET_PLANS, PRESET_SCHEDULES } from '../plans.js'; import { DEFAULT_PLAN_ID, MARKER_COLORS, PLACE_TYPE_NAMES } from '../core/constants.js';
import { createRuntimePlannerState } from '../core/state.js'; import { createHistoryController } from '../core/history.js';
import { createSession } from '../core/session.js'; import { $, clockToMinute, escapeHtml, minuteToClock, pause } from '../core/utils.js';
import { createPlansFeature } from './plans.js'; import { createPlanDialog } from './plans/dialog.js';
import { createGeocodeService } from '../services/geocode.js';
import { weatherBackgroundKey, weatherSummary, weatherVisualKey } from './weather/index.js?v=map-photo-connectors-20260825-1';
import { calculateRouteTotals, fmtDuration } from './route-summary/index.js';
import { createRouteResolver } from './routes/resolver.js';
import { createRouteLayer } from './routes/layer.js';
import { createRouteEditor } from './routes/editor.js';
import { createPlaceTypeCatalog, findMatchingLocation, mapDisplayType, normalizeCategoryColor, normalizePlaceLookup, suggestedPlaceName, syncPlaceToUniversal as syncUniversalPlace } from './places/model.js';
import { bindPlaceBatchActions } from './places/batch-actions.js';
import { createPlaceEditor } from './places/editor.js';
import { createPlaceDropController } from './places/drag-drop.js';
import { flightPlaces as resolveFlightPlaces } from './flights/model.js';
import { createCostEditor } from './costs/editor.js';
import { normalizedPriceItems, createExpenseExportEntries } from './costs/model.js';
import { createScheduleView } from './schedule/view.js?v=map-photo-connectors-20260825-1';
import { createScheduleFocus } from './schedule/focus.js';
import { createPlaceLayer } from './map/place-layer.js';
import { createMapOverview } from './map/overview.js';
import { createFlightLayer } from './map/flight-layer.js';
import { createMapController } from './map/controller.js';
import { createMapLocationController } from './map/location.js';
import { gcjToWgs, mapCoords } from './map/coordinates.js';
import { createRuntimeWorkspace } from './runtime/workspace.js';
import { createPlannerInitializer } from './runtime/initializer.js';
import { bindRuntimeMobileEvents } from './runtime/mobile-events.js';
import { amapKeywords, eventTypeNames, presetNodeTimes, sharedScheduleStorageKey, typeForTitle, versionStorageKey } from './runtime/config.js';
import { bindRuntimeCommands } from './runtime/commands.js';
import { configureRuntimeEventInputs } from './runtime/event-inputs.js';
import { startRuntimeLifecycle } from './runtime/lifecycle.js';
import { createRuntimePlaces } from './runtime/places.js';
import { createRuntimeRoutes } from './runtime/routes.js';
import { createRuntimeMapState } from './runtime/map-state.js';
import { bindRuntimeExports } from './runtime/exports.js';
import { createRuntimeEditors } from './runtime/editors.js';
import { bindRuntimeScheduleInputs } from './runtime/schedule-inputs.js';
import { createPlanReview } from './review/dialog.js';
export function startRuntime({ runtime, api, persistence, migrate, plannerCache, confirmAction, activeTripId = 'local' }) {
const fmt = fmtDuration;
const isShareMode = runtime.shareMode;
const shareData = runtime.shareData;
const shareAssetPath = runtime.assetBase;
if (isShareMode) document.documentElement.classList.add('share-mode');
const itemsEl = document.querySelector('#items');
const template = document.querySelector('#itemTpl');
const state = createRuntimePlannerState();
const defaultPlanId = DEFAULT_PLAN_ID;
let fileRevision = '';
const { renderPlanSelect, setPlanCatalog } = createPlansFeature({ state, select: () => $('#planSelect'), deleteButton: () => $('#deletePlanBtn'), escapeHtml, defaultPlanId });
document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: `${shareAssetPath}types.css` }));
const mapState = createRuntimeMapState();
const markerColors = MARKER_COLORS;
const typeNames = PLACE_TYPE_NAMES;
const placeTypes = createPlaceTypeCatalog({ state, typeNames, markerColors, escapeHtml });
const customPlaceCategories = placeTypes.customCategories;
const placeCategoryMeta = placeTypes.categoryMeta;
const placeTypeName = placeTypes.typeName;
const placeTypeColor = placeTypes.typeColor;
const placeTypeOptionsHtml = placeTypes.optionsHtml;
const placeLayerFeature = createPlaceLayer({
  getMap: mapState.getMap, placeTypeColor, escapeHtml
});
const { mapPointStyle, selectedPointStyle, photoCalloutScale, layoutPhotoCallouts, addSelectedPlacePhotoCallout } = placeLayerFeature;
const values = configureRuntimeEventInputs({ $, template, eventTypeNames });
const costEditor = createCostEditor({ root: $('#priceFields'), totalNode: () => $('#editorPriceTotal') });
const renderEditorPriceItems = costEditor.render;
const collectEditorPriceInfo = costEditor.collect;
const {
  locationsPanel, schedulePanel, mapWorkspace, mapPanel, scheduleActionsContainer,
  weatherUpdateStatus,
  addPlaceButton, addPlaceCategoryButton, universalPlaceDialog, placeCategoryEditor
} = createRuntimeWorkspace({
  $, state,
  getMap: mapState.getMap,
  renderSchedule: entries => renderSchedule(entries),
  applyDayFilter: () => applyDayFilter()
});
bindRuntimeExports({
  $, state, api, mapState, markerColors,
  renderSchedule: (entries, options) => renderSchedule(entries, options),
  applyDayFilter: () => applyDayFilter(),
  scheduleContainer: scheduleActionsContainer,
  mapContainer: mapPanel
});
const geocode = createGeocodeService(api, { pause, aliases: amapKeywords });
const runtimePlaces = createRuntimePlaces({
  state, $, escapeHtml, customPlaceCategories, placeTypeName, placeTypeColor, placeTypeOptionsHtml,
  onShowPlace: placeId => showPlaceOnMap(placeId),
  onEditPlace: (placeId, returnTarget) => openPlaceEditor(placeId, returnTarget),
  onImportPlace: place => importUniversalPlace(place),
  onImported: imported => {
    save(); renderLocations(); universalPlaceDialog.close();
    $('#fileSaveStatus').textContent = `已从我的地点库加入“${imported.name || '地点'}”（已复用账号缓存）`;
  }
});
const { selectedPlaceIds, renderLocations, renderUniversalPlaces } = runtimePlaces;
const flightLayerFeature = createFlightLayer({
  state, $, escapeHtml, mapCoords, markerColors, geocode, resolveFlightPlaces,
  getMap: mapState.getMap, getRouteLayer: mapState.getRouteLayer, setRouteLayer: mapState.setRouteLayer,
  focusScheduleEvent: (...args) => focusScheduleEvent(...args),
  setOverviewFocusOpacity: active => setOverviewFocusOpacity(active),
  fitSelectionWithDayContext: (...args) => fitSelectionWithDayContext(...args)
});
const { drawFlightItinerary, ensureAirportPlace, linkFlightAirports, linkTrainStations, showFlightOnMap } = flightLayerFeature;
$('#universalPlaceSearch').oninput = renderUniversalPlaces;
const routeEditorFeature = createRouteEditor({
  state, $, template, itemsEl, values, escapeHtml,
  renderSchedule: entries => renderSchedule(entries),
  renderManualSchedule: () => renderManualSchedule(),
  applyDayFilter: () => applyDayFilter(),
  focusScheduleEvent: (...args) => focusScheduleEvent(...args),
  focusNode: node => focusNode(node),
  openScheduleEditor: (...args) => openScheduleEditor(...args),
  resolveInlinePlace: (...args) => resolveInlinePlace(...args),
  upsertUniversalRoute: (...args) => upsertUniversalRoute(...args),
  renderLocations, save: () => save(),
  showDayOverview: date => showDayOverview(date), showDriveSegment: (...args) => showDriveSegment(...args),
  geocode, confirmNewPlace: place => confirmNewPlace(place),
  typeForTitle, selectedPlaceIds,
  calculateRouteTotals, fmtDuration, routeForScheduleEvent: (...args) => routeForScheduleEvent(...args)
});
const { addItem, refreshNodePlaceLink, fillInlineRouteControls, parseInlineWaypoints, createRouteFromNode, createOrUpdatePlaceForNode, refreshEventCards, removeLocations, syncNodeToSchedule, updateNodeFromSchedule, routeTotals, renderRouteTotals } = routeEditorFeature;
const history = createHistoryController({
  enabled: () => !isShareMode && persistence.autoSaveEnabled,
  createSnapshot: () => fileSavePayload(), restoreSnapshot: raw => restorePlannerState(raw),
  onStateChange: historyState => { const undo = $('#undoBtn'), redo = $('#redoBtn'); if (undo) undo.disabled = !historyState.canUndo; if (redo) redo.disabled = !historyState.canRedo; }
});
const undoPlannerChange = history.undo, redoPlannerChange = history.redo;
const {
  normalizedTransportMode, transportModeMeta, normalizedTravelMode, driveTravelMeta,
  routeSignature, routeForScheduleEvent, upsertUniversalRoute, mergeUniversalRoutes,
  routesShareVisualCorridor
} = createRuntimeRoutes({ state, isShareMode, normalizeLookup: normalizePlaceLookup });
const mapFocusDateReset = mapState.resetMapFocusDate;
const routeLayerFeature = createRouteLayer({
  state, $, escapeHtml, fmt, mapCoords, markerColors, mapDisplayType, confirmAction,
  selectedPointStyle, layoutPhotoCallouts, addSelectedPlacePhotoCallout,
  setOverviewFocusOpacity: active => setOverviewFocusOpacity(active),
  fitSelectionWithDayContext: (...args) => fitSelectionWithDayContext(...args),
  routeArrowPose: (...args) => routeArrowPose(...args),
  routeColorForDate: date => routeColorForDate(date),
  routeColorForSegment: (...args) => routeColorForSegment(...args),
  dayDriveEvents: date => dayDriveEvents(date),
  placeTypeName, placeTypeColor,
  getMap: mapState.getMap, getRouteLayer: mapState.getRouteLayer, setRouteLayer: mapState.setRouteLayer,
  getDayOverviewLayer: mapState.getDayOverviewLayer,
  getMapRouteLegend: mapState.getMapRouteLegend, setMapRouteLegend: mapState.setMapRouteLegend,
  renderSchedule: entries => renderSchedule(entries),
  refreshEventCards, save: () => save(), showDayOverview: date => showDayOverview(date),
  focusScheduleEvent: (...args) => focusScheduleEvent(...args),
  parseStoredJson: (...args) => parseStoredJson(...args),
  versionStorageKey, storePlanSnapshot: (...args) => storePlanSnapshot(...args),
  readSharedSchedule: () => readSharedSchedule(),
  persistence, sharedScheduleStorageKey
});
const { showRouteOnMap, removeRoute, addRouteDirectionArrows, addRouteSequenceBadge, renderMapRouteLegend } = routeLayerFeature;
const mapOverviewFeature = createMapOverview({
  state, $, escapeHtml, mapCoords, geocode, api, isShareMode,
  map: mapState,
  layers: { renderMapRouteLegend, drawFlightItinerary, addRouteDirectionArrows, addRouteSequenceBadge, mapPointStyle, photoCalloutScale, layoutPhotoCallouts, addSelectedPlacePhotoCallout },
  routes: { routeForScheduleEvent, normalizedTransportMode, normalizedTravelMode, driveTravelMeta, shareCorridor: routesShareVisualCorridor },
  callbacks: {
    focusScheduleEvent: (...args) => focusScheduleEvent(...args),
    renderRouteTotals, save: () => save(), setOverviewFocusOpacity: active => setOverviewFocusOpacity(active)
  }
});
const { showDayOverview, routeColorForDate, tintRouteColor, dayDriveEvents, routeColorForSegment, overviewRouteWeight, refreshOverviewRouteWeights, routeOverviewStyle, translateRouteForDisplay, routeArrowPose } = mapOverviewFeature;
const mapControllerFeature = createMapController({
  state, $, geocode, save: () => save(), mapCoords, isShareMode,
  getMap: mapState.getMap, setMap: mapState.setMap,
  getRouteLayer: mapState.getRouteLayer, setRouteLayer: mapState.setRouteLayer,
  getMarkerLayer: mapState.getMarkerLayer, setMarkerLayer: mapState.setMarkerLayer,
  getDayOverviewLayer: mapState.getDayOverviewLayer, setDayOverviewLayer: mapState.setDayOverviewLayer,
  getDayPhotoCalloutLayer: mapState.getDayPhotoCalloutLayer, setDayPhotoCalloutLayer: mapState.setDayPhotoCalloutLayer,
  getDayOverviewBounds: mapState.getDayOverviewBounds, setDayOverviewBounds: mapState.setDayOverviewBounds,
  getMapFocusDate: mapState.getMapFocusDate,
  getDayPhotoCalloutRenderer: mapState.getDayPhotoCalloutRenderer, setDayPhotoCalloutRenderer: mapState.setDayPhotoCalloutRenderer,
  getDayPhotoCalloutLayoutTimer: mapState.getDayPhotoCalloutLayoutTimer, setDayPhotoCalloutLayoutTimer: mapState.setDayPhotoCalloutLayoutTimer,
  showDayOverview, refreshOverviewRouteWeights,
  selectedPointStyle, addSelectedPlacePhotoCallout, mapPointStyle,
  renderLocations, focusScheduleEvent: (...args) => focusScheduleEvent(...args),
  reportMapNetworkStatus: (status, message) => window.dispatchEvent(new CustomEvent('mobile:mapnetworkstatus', { detail: { status, message } }))
});
const { initMap, cycleBaseLayer, fitOverview, clearMapSelection, showPlaceOnMap, fitSelectionWithDayContext, setOverviewFocusOpacity, showStopsOnMap } = mapControllerFeature;
const mapLocationController = createMapLocationController({
  getMap: mapState.getMap,
  reportStatus: (status, message) => window.dispatchEvent(new CustomEvent('mobile:maplocationstatus', { detail: { state: status, message } })),
  showMessage: message => window.showSaveToast?.(message)
});
const routeResolver = createRouteResolver({
  state, $, api, geocode, pause, escapeHtml, fmt,
  driveTravelMeta, normalizedTransportMode, normalizedTravelMode, transportModeMeta,
  showRouteOnMap, save: () => save(), renderRouteTotals,
  findPlaceInPlanOrUniversal: (...args) => findPlaceInPlanOrUniversal(...args), confirmNewPlace: place => confirmNewPlace(place)
});
const { resolveInlinePlace, calculateDriveRoute } = routeResolver;
const scheduleFocus = createScheduleFocus({
  state, $, itemsEl, values, escapeHtml, fmt, geocode, mapCoords,
  getMap: mapState.getMap, getRouteLayer: mapState.getRouteLayer, setRouteLayer: mapState.setRouteLayer,
  selectedPointStyle, addSelectedPlacePhotoCallout, setOverviewFocusOpacity, fitSelectionWithDayContext,
  renderMapRouteLegend, showDayOverview, showFlightOnMap, showRouteOnMap,
  calculateDriveRoute, routeForScheduleEvent, markerColors,
  eventTypeNames, typeNames, normalizedTransportMode, driveTravelMeta, transportModeMeta, weatherSummary,
  getMapFocusDate: mapState.getMapFocusDate, setMapFocusDate: mapState.setMapFocusDate,
  getRenderedOverviewDate: mapState.getRenderedOverviewDate, setRenderedOverviewDate: mapState.setRenderedOverviewDate,
  isShareMode
});
const { focusNode, focusScheduleEvent, revealCorrespondingNode, showDriveSegment, showSavedDriveInfo, showEventDetail } = scheduleFocus;
const scheduleView = createScheduleView({
  state, $, schedulePanel, itemsEl, values, escapeHtml, minuteToClock, clockToMinute,
  eventTypeNames, fmt, routeForScheduleEvent, weatherBackgroundKey, weatherSummary, weatherVisualKey, normalizedPriceItems,
  refreshEventCards, save: () => save(), showDayOverview, renderRouteTotals,
  isShareMode, undoPlannerChange, redoPlannerChange,
  focusScheduleEvent, openScheduleEditor: (...args) => openScheduleEditor(...args), mapFocusDateReset
});
const { render: renderSchedule, renderManual: renderManualSchedule, applyDayFilter, changeDayFilter, hourHeight: scheduleHourHeight, refreshBatchControls: refreshScheduleBatchControls, shiftSelected: shiftSelectedSchedule, snapDrop: snapScheduleDrop, selectedIndexes: selectedScheduleIndexes, setSelectionAnchor, suppressClick } = scheduleView;
const placeDropController = createPlaceDropController({ state, $, escapeHtml, routeForScheduleEvent });
const sessionFeature = createSession({
  state, $, itemsEl, values, persistence, isShareMode, shareData, defaultPlanId,
  migrate, renderPlanSelect, setPlanCatalog,
  utils: {
    normalizeCategoryColor, normalizePlaceLookup, findMatchingLocation, suggestedPlaceName, syncUniversalPlace,
    versionStorageKey, sharedScheduleStorageKey, typeForTitle, presetNodeTimes, PRESET_PLANS, PRESET_SCHEDULES
  },
  routes: { upsertUniversalRoute, routeForScheduleEvent, mergeUniversalRoutes },
  render: {
    addItem, renderLocations, renderSchedule, renderManualSchedule, applyDayFilter,
    showDayOverview, renderRouteTotals, showStopsOnMap
  },
  history, selectedIndexes: scheduleView.selectedIndexes,
  getFileRevision: () => fileRevision, setFileRevision: value => { fileRevision = value; }
});
const { planIdFromName, storePlanSnapshot, removePlanSnapshot, loadFileContainer, importUniversalPlace, findPlaceInPlanOrUniversal, readSharedSchedule, parseStoredJson, fileSavePayload, currentSnapshot, restorePlannerState, save, load, loadPreset } = sessionFeature;
bindRuntimeScheduleInputs({
  $, state, isShareMode, runtimePlaces, placeDropController,
  scheduleView: {
    selectedIndexes: selectedScheduleIndexes, hourHeight: scheduleHourHeight,
    snapDrop: snapScheduleDrop, setSelectionAnchor, suppressClick
  },
  updateNode: updateNodeFromSchedule, save,
  renderers: { renderSchedule, applyDayFilter, renderLocations, showDayOverview },
  time: { clockToMinute, minuteToClock },
  flight: { linkFlightAirports, linkTrainStations },
  addItem, focusScheduleEvent
});
bindPlaceBatchActions({
  state, $, api, geocode, pause, escapeHtml, confirmAction, selectedPlaceIds,
  getSelectionMode: runtimePlaces.getSelectionMode,
  setSelectionMode: runtimePlaces.setSelectionMode,
  onSearch: runtimePlaces.setSearchText,
  renderLocations, removeLocations, save: () => save()
});
const planDialog = $('#planDialog');
createPlanDialog({
  state, $, planDialog, isShareMode,
  planIdFromName, currentSnapshot, storePlanSnapshot, removePlanSnapshot,
  parseStoredJson, versionStorageKey, load, loadPreset,
  renderPlanSelect, renderSchedule, renderManualSchedule, save
});
const getEditorContext = () => ({ tripName: $('#tripName').value, planName: $('#planSelect').selectedOptions?.[0]?.textContent || '' });
const placeEditorFeature = createPlaceEditor({ state, $, api, geocode, confirmAction, placeTypeOptionsHtml, getDefaultType: runtimePlaces.getTypeFilter, findMatchingLocation, importUniversalPlace, normalizePlaceLookup, removeLocations, save, renderLocations, getContext: getEditorContext });
const confirmNewPlace = placeEditorFeature.confirmNewPlace;
const openPlaceEditor = placeEditorFeature.openPlaceEditor;
const {
  openScheduleEditor, editScheduleAndWait, cancelScheduleEditor, deleteScheduleEvent,
  updateScheduleWeather, openExpenseLedger
} = createRuntimeEditors({
  $, state, api, geocode, convertCoords: gcjToWgs, weatherStatus: weatherUpdateStatus,
  getContext: getEditorContext,
  costs: { renderEditorPriceItems, collectEditorPriceInfo },
  routeServices: {
    linkFlightAirports, linkTrainStations,
    route: { resolveInlinePlace, calculateDriveRoute }
  },
  routeMeta: { upsertUniversalRoute, routeSignature, linkFlightAirports, linkTrainStations, normalizedTransportMode, normalizedTravelMode, transportModeMeta, driveTravelMeta, routeForScheduleEvent },
  placeServices: { confirmNewPlace, suggestedPlaceName, normalizePlaceLookup, findPlaceInPlanOrUniversal, placeTypeName, typeNames },
  persistenceServices: { readSharedSchedule, parseStoredJson, versionStorageKey, sharedScheduleStorageKey, persistence, storePlanSnapshot, save },
  nodeServices: { updateNodeFromSchedule, addItem },
  renderers: { renderLocations, renderSchedule, applyDayFilter, renderRouteTotals, showDayOverview, focusScheduleEvent },
  meta: { eventTypeNames, isShareMode, fmt, weatherSummary, clockToMinute },
  itemsEl, values, escapeHtml, confirmAction, save
});
const runtimeCommands = bindRuntimeCommands({
  $, state, itemsEl, values, changeDayFilter, loadPreset,
  setPlaceTypeFilter: runtimePlaces.setTypeFilter,
  renderLocations, renderUniversalPlaces, universalPlaceDialog,
  addPlaceButton, addPlaceCategoryButton, placeCategoryEditor, openPlaceEditor,
  save, updateScheduleWeather, openExpenseLedger,
  persistence, confirmAction, showToast: (message, tone) => window.showSaveToast?.(message, tone),
  undo: undoPlannerChange, redo: redoPlannerChange
});
history.refresh();
const planReview = createPlanReview({ state, escapeHtml,
  getTripName: () => $('#tripName').value,
  getPlanName: () => $('#planSelect').selectedOptions[0]?.textContent || '',
  getExpenseEntries: () => createExpenseExportEntries({ schedule: state.schedule, expenses: state.expenses }),
  canEdit: () => !isShareMode && !$('#addScheduleBtn').disabled,
  editEvent: editScheduleAndWait
});
startRuntimeLifecycle({
  createInitializer: ensureMapReady => createPlannerInitializer({
    state, api, persistence, plannerCache, activeTripId, isShareMode, shareData, defaultPlanId,
    statusNode: () => $('#fileSaveStatus'),
    setPlanCatalog, loadFileContainer, load, loadPreset, save,
    renderSchedule, renderManualSchedule, ensureMapReady, renderRouteTotals, fileSavePayload,
    getFileRevision: () => fileRevision,
    setFileRevision: value => { fileRevision = value; },
    getDraftSnapshot: () => ({ file: fileSavePayload(), current: currentSnapshot() }),
    confirmDiscardDraft: () => confirmAction({ title: '重试前保护本地修改',
      message: '有尚未保存的本地修改。重新读取会替换当前内容。',
      detail: '建议先取消并导出 JSON 备份。只有成功读取后才会放弃当前修改；读取再次失败时仍保留。',
      confirmLabel: '放弃修改并重试' })
  }),
  initMap, getMap: mapState.getMap, showDayOverview, fitOverview,
  bindMobileEvents: bindRuntimeMobileEvents,
  mobileEventOptions: {
    $, api, persistence, save, getMap: mapState.getMap, showDayOverview, changeDayFilter, renderLocations,
    cycleBaseLayer, clearMapSelection, fitOverview,
    locate: () => mapLocationController.locate(), focusScheduleEvent, showPlaceOnMap
  },
  cleanupControllers: [runtimeCommands, runtimePlaces, scheduleView, mapLocationController, mapControllerFeature, planReview],
  statusNode: () => $('#fileSaveStatus'),
  showToast: message => window.showSaveToast?.(message)
});
}
