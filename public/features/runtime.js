import { PRESET_PLANS, PRESET_SCHEDULES } from '../plans.js';
import { DEFAULT_PLAN_ID, DRIVE_TRAVEL_MODES, MARKER_COLORS, PLACE_TYPE_NAMES, TRANSPORT_MODES } from '../core/constants.js';
import { createRuntimePlannerState } from '../core/state.js';
import { createHistoryController } from '../core/history.js';
import { createSession } from '../core/session.js';
import { $, clockToMinute, escapeHtml, minuteToClock, pause } from '../core/utils.js';
import { createPlansFeature } from './plans.js';
import { createPlanDialog } from './plans/dialog.js';
import { createGeocodeService } from '../services/geocode.js';
import { pngFilePart, downloadCanvasPng } from './export/index.js';
import { bindScheduleExport } from './export/schedule-export.js';
import { bindMapExport } from './export/map-export.js';
import { weatherSummary } from './weather/index.js';
import { createWeatherController } from './weather/controller.js';
import { calculateRouteTotals, fmtDuration } from './route-summary/index.js';
import { createRouteModel } from './routes/model.js';
import { createRouteResolver } from './routes/resolver.js';
import { createRouteLayer } from './routes/layer.js';
import { createRouteEditor } from './routes/editor.js';
import { createPlaceTypeCatalog, findMatchingLocation, mapDisplayType, normalizeCategoryColor, normalizePlaceLookup, suggestedPlaceName, syncPlaceToUniversal as syncUniversalPlace } from './places/model.js';
import { createPlacesLibrary } from './places/library.js';
import { bindPlaceBatchActions } from './places/batch-actions.js';
import { createPlaceEditor } from './places/editor.js';
import { createPlaceDropController } from './places/drag-drop.js';
import { flightPlaces as resolveFlightPlaces } from './flights/model.js';
import { createCostEditor } from './costs/editor.js';
import { normalizedPriceItems } from './costs/model.js';
import { createExpenseLedger } from './costs/ledger.js';
import { bindScheduleDragDrop } from './schedule/drag-resize.js';
import { createScheduleView } from './schedule/view.js';
import { createScheduleFocus } from './schedule/focus.js';
import { createScheduleEditor } from './schedule/editor.js';
import { bindFlightImporter } from './flights/importer.js';
import { createRouteOverlapTools, routeLengthMeters, routeArrowPose as calculateRouteArrowPose, translateRouteForDisplay as translateProjectedRoute } from './map/geometry.js';
import { createPlaceLayer } from './map/place-layer.js';
import { createMapOverview } from './map/overview.js';
import { createFlightLayer } from './map/flight-layer.js';
import { createMapController } from './map/controller.js';
import { gcjToWgs, mapCoords } from './map/coordinates.js';

export function startRuntime({ runtime, api, persistence, migrate }) {
const fmt = fmtDuration;
const isShareMode = runtime.shareMode;
const shareData = runtime.shareData;
const shareAssetPath = runtime.assetBase;
if (isShareMode) document.documentElement.classList.add('share-mode');
const itemsEl = document.querySelector('#items');
const template = document.querySelector('#itemTpl');
const state = createRuntimePlannerState();
const defaultPlanId = DEFAULT_PLAN_ID;
// 本地文件是唯一的行程数据源；浏览器存储只保留迁移标记等轻量 UI 数据。
let fileRevision = '';
const { normalizePlanContainer, renderPlanSelect, setPlanCatalog } = createPlansFeature({ state, select: () => $('#planSelect'), deleteButton: () => $('#deletePlanBtn'), escapeHtml, defaultPlanId });
document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: `${shareAssetPath}types.css` }));
let map;
let routeLayer;
let markerLayer;
let dayOverviewLayer;
let dayPhotoCalloutLayer;
let currentLocationLayer;
// 编辑撤销/重做（内存栈，页面刷新即清空）：以 save() 汇聚点做整状态快照，覆盖文字修改、增删、拖拽与查询结果覆盖。
let dayPhotoCalloutRenderer = null;
let dayPhotoCalloutLayoutTimer = null;
let dayOverviewRequestId = 0;
let dayOverviewBounds;
let mapFocusDate = '';
let renderedOverviewDate = null;
let mapRouteLegend;
const selectedPlaceIds = new Set();
let placeSearchText = '';
let placeTypeFilter = '';
const markerColors = MARKER_COLORS;
const typeNames = PLACE_TYPE_NAMES;
// 地点库保留细分类，地图图例按更易读的出行类别合并。
const placeTypes = createPlaceTypeCatalog({ state, typeNames, markerColors, escapeHtml });
const customPlaceCategories = placeTypes.customCategories;
const placeCategoryMeta = placeTypes.categoryMeta;
const placeTypeName = placeTypes.typeName;
const placeTypeColor = placeTypes.typeColor;
const placeTypeOptionsHtml = placeTypes.optionsHtml;
const placeLayerFeature = createPlaceLayer({
  getMap: () => map, placeTypeColor, escapeHtml
});
const { mapPointStyle, selectedPointStyle, photoCalloutScale, calloutPlacement, layoutPhotoCallouts, addSelectedPlacePhotoCallout } = placeLayerFeature;
const eventTypeNames = { spot: '游玩', food: '用餐', hotel: '入住 / 休息', drive: '路程', flight: '航班', transport: '交通 / 手续', service: '服务区停靠', fuel: '加油 / 采购', supply: '补给' };
$('#editorType').append(new Option('路程', 'drive'));
$('.type', template.content).append(new Option('路程', 'drive'));
$('#editorType').append(new Option('航班', 'flight'));
$('.type', template.content).append(new Option('航班', 'flight'));
$('#editorType').append(new Option('交通 / 手续', 'transport'));
$('.type', template.content).append(new Option('交通 / 手续', 'transport'));
$('#editorType').querySelectorAll('option').forEach(option => { option.textContent = eventTypeNames[option.value] || option.textContent; });
$('.type', template.content).querySelectorAll('option').forEach(option => { option.textContent = eventTypeNames[option.value] || option.textContent; });
$('.address', template.content).placeholder = '具体地址待定可留空，填写后可定位';
$('#editorAddress').placeholder = '具体地址待定可留空，填写后可定位';
const costEditor = createCostEditor({ root: $('#priceFields'), totalNode: () => $('#editorPriceTotal') });
const renderEditorPriceItems = costEditor.render;
const collectEditorPriceInfo = costEditor.collect;
const updateEditorPriceTotal = costEditor.updateTotal;
const locationsPanel = document.createElement('section');
locationsPanel.className = 'locations-panel';
locationsPanel.innerHTML = '<div class="aside-head"><h3>当前计划地点库 <small id="placeCount"></small></h3><button type="button" id="addPlaceBtn">+ 地点</button></div><p class="hint">仅显示当前计划已加入的地点；新建或更新会同步写入通用地点库，供其他计划直接复用缓存。</p><div class="location-toolbar"><input id="placeSearch" type="search" placeholder="搜索名称、地址或备注"><select id="placeTypeFilter" aria-label="按地点类型筛选"></select><button type="button" id="togglePlaceSelection">选择地点</button><button type="button" id="selectAllPlaces">全选结果</button><button type="button" id="resolveSelectedPlaces">批量查询位置</button><button type="button" id="fetchSelectedPhotos">批量获取图片</button><button type="button" class="danger" id="deleteSelectedPlaces">批量删除</button></div><details class="batch-add"><summary>批量新增地点</summary><textarea id="batchPlaceInput" placeholder="每行：类型｜名称｜地址\n例如：地名｜伊宁市｜新疆伊犁州伊宁市"></textarea><div class="batch-actions"><button type="button" id="batchAddPlaces">导入这些地点</button><small>景点、地名、饮食、住宿、机场、服务区、加油站、补给</small></div></details><div id="places" class="places"></div>';
document.querySelector('.content').insertAdjacentElement('afterend', locationsPanel);
const schedulePanel = document.querySelector('.schedule-panel');
const mapWorkspace = document.querySelector('.content');
const appHeader = document.querySelector('header');
const compactHero = document.querySelector('.hero');
appHeader.insertBefore(compactHero, appHeader.querySelector('.top-actions'));
[schedulePanel, mapWorkspace, locationsPanel].forEach(panel => panel.classList.add('workspace-panel'));
function createExpandButton(panel, label) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'panel-expand ghost'; button.textContent = '放大'; button.title = `放大${label}`;
  button.onclick = () => {
    const expand = !panel.classList.contains('is-expanded');
    document.querySelectorAll('.workspace-panel').forEach(item => item.classList.remove('is-expanded'));
    document.body.classList.toggle('panel-expanded', expand);
    if (expand) panel.classList.add('is-expanded');
    document.querySelectorAll('.panel-expand').forEach(item => { item.textContent = '放大'; });
    if (expand) button.textContent = '恢复三栏';
    if (panel === schedulePanel) { renderSchedule(state.schedule); applyDayFilter(); }
    setTimeout(() => map?.invalidateSize(), 180);
  };
  return button;
}
const updateScheduleWeatherButton = document.createElement('button');
updateScheduleWeatherButton.type = 'button';
updateScheduleWeatherButton.id = 'updateScheduleWeather';
updateScheduleWeatherButton.className = 'ghost';
updateScheduleWeatherButton.textContent = '更新卡片天气';
updateScheduleWeatherButton.title = '按当前日期筛选批量更新可查询卡片的天气';
schedulePanel.querySelector('.aside-head>div:last-child').append(updateScheduleWeatherButton, createExpandButton(schedulePanel, '时间表'));
const exportSchedulePngButton = bindScheduleExport({
  $, state,
  renderSchedule: entries => renderSchedule(entries),
  applyDayFilter: () => applyDayFilter(),
  pngFilePart, downloadCanvasPng,
  container: schedulePanel.querySelector('.aside-head>div:last-child')
}).button;
const mapExpandButton = createExpandButton(mapWorkspace, '地图'); mapExpandButton.classList.add('map-expand'); mapWorkspace.querySelector('.map-panel').append(mapExpandButton);
const mapDayControl = document.createElement('label');
mapDayControl.className = 'map-day-control';
mapDayControl.innerHTML = '<span>地图日期</span><select id="mapDayFilter" aria-label="地图按天筛选"><option value="">全部日期</option></select>';
mapWorkspace.querySelector('.map-panel').append(mapDayControl);
const exportMapPngButton = bindMapExport({
  $, state, getMap: () => map, getLayers: () => [dayOverviewLayer, markerLayer, routeLayer],
  showDayOverview: date => showDayOverview(date),
  routeColorForDate: date => routeColorForDate(date),
  markerColors, pngFilePart, downloadCanvasPng,
  container: mapWorkspace.querySelector('.map-panel')
}).button;
const locationActions = document.createElement('div'); locationActions.className = 'location-head-actions';
const addPlaceCategoryButton = document.createElement('button'); addPlaceCategoryButton.type = 'button'; addPlaceCategoryButton.id = 'addPlaceCategoryBtn'; addPlaceCategoryButton.className = 'ghost'; addPlaceCategoryButton.textContent = '+ 类别';
const addPlaceButton = $('#addPlaceBtn'); addPlaceButton.before(locationActions); locationActions.append(addPlaceCategoryButton, addPlaceButton, createExpandButton(locationsPanel, '地点库'));
const universalPlaceDialog = $('#universalPlaceDialog');
const placeCategoryEditor = $('#placeCategoryEditor');
let placeSelectionMode = false;
let draggingPlaceId = '';
let clearPlaceDragTimer;
const presetNodeTimes = {
  '2026-08-15|伊宁机场':['20:00','20:40'],'2026-08-15|伊宁市区住宿':['21:20','23:00'],'2026-08-16|赛里木湖东门':['11:15','20:40'],'2026-08-16|赛里木湖附近住宿':['20:40','23:00'],
  '2026-08-17|果子沟':['09:20','10:00'],'2026-08-17|六星街':['12:45','14:30'],'2026-08-17|那拉提镇住宿':['18:30','21:30'],'2026-08-18|那拉提空中草原':['08:30','12:30'],'2026-08-18|巴音布鲁克镇住宿':['15:30','22:00'],
  '2026-08-19|大龙池':['09:30','09:50'],'2026-08-19|天山神秘大峡谷':['12:30','14:30'],'2026-08-19|拜城县住宿':['17:30','22:00'],'2026-08-20|温宿大峡谷':['10:30','14:00'],
  '2026-08-20|阿克苏市住宿':['16:30','22:00'],'2026-08-20|巴楚县住宿':['19:30','22:00'],'2026-08-21|喀什古城附近住宿':['14:30','23:00'],'2026-08-21|白沙湖':['12:30','13:40'],'2026-08-21|喀拉库勒湖':['14:50','17:15'],
  '2026-08-22|喀什机场':['11:20','11:45'],'2026-08-22|白沙湖':['14:00','15:10'],'2026-08-22|喀拉库勒湖':['16:00','18:00'],'2026-08-22|阿图什天门':['13:15','16:30'],'2026-08-22|巴楚县住宿':['20:00','22:00'],'2026-08-23|阿克苏机场':['14:30','17:00']
};
const amapKeywords = { '伊宁机场': '伊犁伊宁国际机场', '赛里木湖东门': '赛里木湖东门游客服务中心', '喀什机场': '喀什徕宁国际机场', '阿克苏机场': '阿克苏红旗坡机场' };
const geocode = createGeocodeService(api, { pause, aliases: amapKeywords });
const universalLocationStorageKey = 'roadtrip-location-library';
const universalRouteStorageKey = 'roadtrip-route-library';
const versionStorageKey = key => `roadtrip-version-${key}`;
const sharedScheduleStorageKey = 'roadtrip-shared-schedule-through-0819';

const placesLibrary = createPlacesLibrary({
  state, $, escapeHtml, selectedPlaceIds, customPlaceCategories, placeTypeName, placeTypeColor, placeTypeOptionsHtml,
  getUiState: () => ({ searchText: placeSearchText, typeFilter: placeTypeFilter, selectionMode: placeSelectionMode }),
  setTypeFilter: value => { placeTypeFilter = value; },
  onShowPlace: placeId => showPlaceOnMap(placeId),
  onEditPlace: placeId => openPlaceEditor(placeId),
  onImportPlace: place => importUniversalPlace(place),
  onDragStart: placeId => { clearTimeout(clearPlaceDragTimer); draggingPlaceId = placeId; },
  onDragEnd: card => {
    // 部分浏览器会在 drop 之前触发 dragend；延后清除来源，保证落点能读取到地点。
    clearPlaceDragTimer = setTimeout(() => {
      draggingPlaceId = '';
      card.classList.remove('dragging-place');
      document.querySelectorAll('.calendar-day.drop-target,.calendar-drop-preview').forEach(item => item.classList.remove('drop-target') || item.remove());
    }, 180);
  },
  onImported: imported => {
    save(); renderLocations(); universalPlaceDialog.close();
    $('#fileSaveStatus').textContent = `已从通用地点库加入“${imported.name || '地点'}”（已复用本地缓存）`;
  }
});
const renderLocations = placesLibrary.renderLocations;
const renderUniversalPlaces = placesLibrary.renderUniversalPlaces;
$('#placeTypeFilter').onchange = event => { placeTypeFilter = event.target.value; renderLocations(); };
const flightLayerFeature = createFlightLayer({
  state, $, escapeHtml, mapCoords, markerColors, geocode, isShareMode, resolveFlightPlaces,
  getMap: () => map, getRouteLayer: () => routeLayer, setRouteLayer: value => { routeLayer = value; },
  focusScheduleEvent: (...args) => focusScheduleEvent(...args),
  renderLocations, renderSchedule: entries => renderSchedule(entries), save: () => save(),
  setOverviewFocusOpacity: active => setOverviewFocusOpacity(active),
  fitSelectionWithDayContext: (...args) => fitSelectionWithDayContext(...args)
});
const { flightCurveLatLngs, drawFlightCurve, flightPlaces, drawFlightItinerary, ensureAirportPlace, linkFlightAirports, ensureFlightAirportLinks, showFlightOnMap } = flightLayerFeature;
$('#placeLibraryBtn').onclick = () => { renderUniversalPlaces(); universalPlaceDialog.showModal(); };
$('#closeUniversalPlaceDialog').onclick = () => universalPlaceDialog.close();
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
function values(node) { return { type:$('.type',node).value,date:$('.date',node).value,startTime:$('.start-time',node).value,endTime:$('.end-time',node).value,name:$('.name',node).value,address:$('.address',node).value,note:$('.note',node).value,photo:$('.preview',node).hidden?'':$('.preview',node).src,scheduleIndex:Number(node.dataset.scheduleIndex) }; }
const history = createHistoryController({
  enabled: () => !isShareMode && persistence.autoSaveEnabled,
  createSnapshot: () => fileSavePayload(), restoreSnapshot: raw => restorePlannerState(raw),
  onStateChange: historyState => { const undo = $('#undoBtn'), redo = $('#redoBtn'); if (undo) undo.disabled = !historyState.canUndo; if (redo) redo.disabled = !historyState.canRedo; }
});
const undoPlannerChange = history.undo, redoPlannerChange = history.redo;
function typeForTitle(title = '') { return /航班|\b[A-Z]{2}\d{3,4}\b/i.test(title) ? 'flight' : /午餐|晚餐|早餐|简餐/.test(title) ? 'food' : /入住|休息|候机/.test(title) ? 'hotel' : /抵达|下机|取行李|租车|验车|还车|起飞/.test(title) ? 'transport' : /加油/.test(title) ? 'fuel' : /服务区/.test(title) ? 'service' : /驾驶|前往|返回|继续|返程|至/.test(title) ? 'drive' : 'spot'; }
const driveTravelModes = DRIVE_TRAVEL_MODES;
const transportModes = TRANSPORT_MODES;
const routeModel = createRouteModel({ state, transportModes, driveTravelModes, normalizeLookup: normalizePlaceLookup });
const normalizedTransportMode = routeModel.normalizedTransportMode;
const transportModeMeta = routeModel.transportModeMeta;
const normalizedTravelMode = routeModel.normalizedTravelMode;
const driveTravelMeta = routeModel.driveTravelMeta;
const routeSignature = routeModel.signature;
const routeForScheduleEvent = routeModel.forScheduleEvent;
const upsertUniversalRoute = routeModel.upsert;
const mergeUniversalRoutes = data => routeModel.merge(data, isShareMode);
const mapFocusDateReset = () => { mapFocusDate = ''; };
const routeVisualOverlapPolicy = { proximityMeters: 400, minCorridorMeters: 20_000, minShorterRouteRatio: .18 };
const { routesShareVisualCorridor } = createRouteOverlapTools(routeVisualOverlapPolicy);
const routeLayerFeature = createRouteLayer({
  state, $, escapeHtml, fmt, mapCoords, markerColors, mapDisplayType,
  selectedPointStyle, addSelectedPlacePhotoCallout,
  setOverviewFocusOpacity: active => setOverviewFocusOpacity(active),
  fitSelectionWithDayContext: (...args) => fitSelectionWithDayContext(...args),
  routeArrowPose: (...args) => routeArrowPose(...args),
  routeColorForDate: date => routeColorForDate(date),
  routeColorForSegment: (...args) => routeColorForSegment(...args),
  dayDriveEvents: date => dayDriveEvents(date),
  placeTypeName, placeTypeColor,
  getMap: () => map, getRouteLayer: () => routeLayer, setRouteLayer: value => { routeLayer = value; },
  getDayOverviewLayer: () => dayOverviewLayer,
  getMapRouteLegend: () => mapRouteLegend, setMapRouteLegend: value => { mapRouteLegend = value; },
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
  map: {
    getMap: () => map, getRouteLayer: () => routeLayer, setRouteLayer: value => { routeLayer = value; },
    getMarkerLayer: () => markerLayer, getDayOverviewLayer: () => dayOverviewLayer, getDayPhotoCalloutLayer: () => dayPhotoCalloutLayer,
    getDayOverviewRequestId: () => dayOverviewRequestId, setDayOverviewRequestId: value => { dayOverviewRequestId = value; },
    getDayOverviewBounds: () => dayOverviewBounds, setDayOverviewBounds: value => { dayOverviewBounds = value; },
    getRenderedOverviewDate: () => renderedOverviewDate, setRenderedOverviewDate: value => { renderedOverviewDate = value; },
    getDayPhotoCalloutRenderer: () => dayPhotoCalloutRenderer, setDayPhotoCalloutRenderer: value => { dayPhotoCalloutRenderer = value; }
  },
  layers: { renderMapRouteLegend, drawFlightItinerary, addRouteDirectionArrows, addRouteSequenceBadge, mapPointStyle, photoCalloutScale, layoutPhotoCallouts, addSelectedPlacePhotoCallout },
  routes: { routeForScheduleEvent, normalizedTransportMode, normalizedTravelMode, driveTravelMeta, shareCorridor: routesShareVisualCorridor },
  env: { ensureFlightAirportLinks },
  callbacks: {
    focusScheduleEvent: (...args) => focusScheduleEvent(...args),
    renderRouteTotals, save: () => save(), setOverviewFocusOpacity: active => setOverviewFocusOpacity(active)
  }
});
const { showDayOverview, routeColorForDate, tintRouteColor, dayDriveEvents, routeColorForSegment, overviewRouteWeight, refreshOverviewRouteWeights, routeOverviewStyle, translateRouteForDisplay, routeArrowPose } = mapOverviewFeature;
const mapControllerFeature = createMapController({
  state, $, geocode, save: () => save(), mapCoords, isShareMode,
  getMap: () => map, setMap: value => { map = value; },
  getRouteLayer: () => routeLayer, setRouteLayer: value => { routeLayer = value; },
  getMarkerLayer: () => markerLayer, setMarkerLayer: value => { markerLayer = value; },
  getDayOverviewLayer: () => dayOverviewLayer, setDayOverviewLayer: value => { dayOverviewLayer = value; },
  getDayPhotoCalloutLayer: () => dayPhotoCalloutLayer, setDayPhotoCalloutLayer: value => { dayPhotoCalloutLayer = value; },
  getDayOverviewBounds: () => dayOverviewBounds, setDayOverviewBounds: value => { dayOverviewBounds = value; },
  getMapFocusDate: () => mapFocusDate,
  getDayPhotoCalloutRenderer: () => dayPhotoCalloutRenderer, setDayPhotoCalloutRenderer: value => { dayPhotoCalloutRenderer = value; },
  getDayPhotoCalloutLayoutTimer: () => dayPhotoCalloutLayoutTimer, setDayPhotoCalloutLayoutTimer: value => { dayPhotoCalloutLayoutTimer = value; },
  showDayOverview, refreshOverviewRouteWeights,
  selectedPointStyle, addSelectedPlacePhotoCallout, mapPointStyle,
  renderLocations, focusScheduleEvent: (...args) => focusScheduleEvent(...args)
});
const { initMap, cycleBaseLayer, fitOverview, clearMapSelection, showPlaceOnMap, fitSelectionWithDayContext, setOverviewFocusOpacity, showStopsOnMap } = mapControllerFeature;
const routeResolver = createRouteResolver({
  state, $, api, geocode, pause, escapeHtml, fmt,
  driveTravelMeta, normalizedTransportMode, normalizedTravelMode, transportModeMeta,
  showRouteOnMap, save: () => save(), renderRouteTotals,
  findPlaceInPlanOrUniversal: (...args) => findPlaceInPlanOrUniversal(...args), confirmNewPlace: place => confirmNewPlace(place)
});
const { resolveInlinePlace, calculateDriveRoute } = routeResolver;
const scheduleFocus = createScheduleFocus({
  state, $, itemsEl, values, escapeHtml, fmt, geocode, mapCoords,
  getMap: () => map, getRouteLayer: () => routeLayer, setRouteLayer: value => { routeLayer = value; },
  selectedPointStyle, addSelectedPlacePhotoCallout, setOverviewFocusOpacity, fitSelectionWithDayContext,
  renderMapRouteLegend, showDayOverview, showFlightOnMap, showRouteOnMap,
  calculateDriveRoute, routeForScheduleEvent, markerColors,
  eventTypeNames, typeNames, normalizedTransportMode, driveTravelMeta, transportModeMeta, weatherSummary,
  getMapFocusDate: () => mapFocusDate, setMapFocusDate: value => { mapFocusDate = value; },
  getRenderedOverviewDate: () => renderedOverviewDate, setRenderedOverviewDate: value => { renderedOverviewDate = value; },
  isShareMode
});
const { focusNode, focusScheduleEvent, revealCorrespondingNode, showDriveSegment, showSavedDriveInfo, showEventDetail } = scheduleFocus;
const scheduleView = createScheduleView({
  state, $, schedulePanel, itemsEl, values, escapeHtml, minuteToClock, clockToMinute,
  eventTypeNames, fmt, routeForScheduleEvent, weatherSummary, normalizedPriceItems,
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
const { planIdFromName, snapshotForPlan, storePlanSnapshot, removePlanSnapshot, setSnapshots, setUniversalCatalog, loadFileContainer, clonePlaceForPlan, syncPlaceToUniversal, importUniversalPlace, findPlaceInPlanOrUniversal, repairEventNamedLocations, readSharedSchedule, applySharedSchedule, writeSharedSchedule, parseStoredJson, fileSavePayload, queueLocalFileSave, currentSnapshot, restorePlannerState, save, mergeUniversalLocations, load, loadPreset } = sessionFeature;
// 视觉分道只处理真正共用较长走廊的路线：既要连续相近超过 20km，
// 也要占较短路线至少 18%。端点是否相同并不作为判断条件。
bindScheduleDragDrop({
  state, schedule: $('#schedule'), isReadOnly: () => isShareMode, selectedIndexes: selectedScheduleIndexes,
  clockToMinute, minuteToClock, getHourHeight: scheduleHourHeight, snapDrop: snapScheduleDrop,
  getDraggingPlaceId: () => draggingPlaceId,
  clearDraggingPlace: () => { clearTimeout(clearPlaceDragTimer); draggingPlaceId = ''; },
  placeDropController, updateNode: updateNodeFromSchedule, save: () => save(),
  renderSchedule: () => renderSchedule(state.schedule), applyDayFilter, renderLocations,
  showDayOverview: () => showDayOverview(state.dayFilter),
  setSelectionAnchor,
  suppressClick
});
bindFlightImporter({
  $, state, clockToMinute, linkFlightAirports, addItem,
  renderSchedule, applyDayFilter, save, renderLocations, focusScheduleEvent
});
bindPlaceBatchActions({
  state, $, api, geocode, pause, selectedPlaceIds,
  getSelectionMode: () => placeSelectionMode,
  setSelectionMode: value => { placeSelectionMode = value; },
  onSearch: value => { placeSearchText = value; },
  renderLocations, removeLocations, save: () => save()
});
document.querySelector('#exportBtn').onclick=()=>{ const b=new Blob([JSON.stringify({name:$('#tripName').value,items:[...itemsEl.children].map(values),schedule:state.schedule,locations:state.locations,routes:state.routes,preferences:state.preferences,placeModelVersion:1,routeLinkModeVersion:1},null,2)],{type:'application/json'});const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(b),download:'roadtrip.json'});a.click();URL.revokeObjectURL(a.href); };

$('#mapDayFilter').onchange = event => changeDayFilter(event.target.value);
$('#planSelect').onchange = async e => {
  const key = e.target.value;
  loadPreset(key);
  if (!isShareMode) await ensureFlightAirportLinks();
};
const planDialog = $('#planDialog');
createPlanDialog({
  state, $, planDialog, isShareMode,
  planIdFromName, currentSnapshot, storePlanSnapshot, removePlanSnapshot,
  parseStoredJson, versionStorageKey, load, loadPreset,
  renderPlanSelect, renderSchedule, renderManualSchedule, save
});
const placeEditorFeature = createPlaceEditor({ state, $, api, geocode, placeTypeOptionsHtml, getDefaultType: () => placeTypeFilter, findMatchingLocation, importUniversalPlace, normalizePlaceLookup, removeLocations, save, renderLocations });
const confirmNewPlace = placeEditorFeature.confirmNewPlace;
const openPlaceEditor = placeEditorFeature.openPlaceEditor;
const weatherController = createWeatherController({
  state, $, api, geocode, convertCoords: gcjToWgs, routeForEvent: routeForScheduleEvent,
  getEditingIndex: () => scheduleEditorFeature.getEditingIndex(), save,
  refresh: () => { renderSchedule(state.schedule); applyDayFilter(); renderLocations(); }
});
const queryEventWeather = weatherController.queryEvent;
updateScheduleWeatherButton.addEventListener('click', event => weatherController.updateVisible(event.currentTarget));
const scheduleEditorFeature = createScheduleEditor({
  state, $, escapeHtml, itemsEl, values,
  elements: {
    editorDeleteButton: $('#editorDelete'), routeEditorSection: $('#routeEditorSection'),
    flightFields: $('#flightFields'), eventLocationField: $('#eventLocationField'), weatherFields: $('#editorWeatherFields')
  },
  costs: { renderEditorPriceItems, collectEditorPriceInfo },
  services: { geocode, weather: queryEventWeather, route: { resolveInlinePlace, calculateDriveRoute } },
  routes: { upsertUniversalRoute, routeSignature, linkFlightAirports, normalizedTransportMode, normalizedTravelMode, transportModeMeta, driveTravelMeta, routeForScheduleEvent },
  places: { confirmNewPlace, suggestedPlaceName, normalizePlaceLookup, findPlaceInPlanOrUniversal, placeTypeName, typeNames },
  persistence: { readSharedSchedule, parseStoredJson, versionStorageKey, sharedScheduleStorageKey, persistence, storePlanSnapshot, save },
  nodes: { updateNodeFromSchedule, addItem },
  events: {
    onFocus: focusScheduleEvent,
    onRender: { renderLocations, renderSchedule, applyDayFilter, renderRouteTotals, showDayOverview }
  },
  meta: { eventTypeNames, isShareMode, fmt, weatherSummary, clockToMinute }
});
const { openScheduleEditor, cancelScheduleEditor, deleteScheduleEvent } = scheduleEditorFeature;
const expenseLedger = createExpenseLedger({ state, save: () => save(), openScheduleEditor, escapeHtml });
window.addEventListener('mobile:accountingopen', () => expenseLedger.open());
async function initializePlanner() {
  let cached = null;
  let loadedFromFile = false;
  setPlanCatalog({});
  const hydrate = fileData => {
    if (!fileData) return;
    const normalized = loadFileContainer(fileData);
    fileRevision = fileData.updatedAt || fileData.savedAt || '';
    loadedFromFile = true;
    const activeKey = state.versionKey;
    if (isShareMode) {
      const active = normalized.versions?.[activeKey];
      if (active) cached = structuredClone(active);
      const stamp = fileData.updatedAt ? new Date(fileData.updatedAt).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' }) : '';
      $('#fileSaveStatus').textContent = `共享只读版${stamp ? ` · 更新于 ${stamp}` : ''}`;
      return;
    }
    const active = normalized.versions?.[activeKey];
    if (active) cached = structuredClone(active);
    $('#fileSaveStatus').textContent = persistence.editable ? '已从本地文件载入' : '移动端只读 · 已从本地文件载入';
  };
  if (isShareMode) hydrate(shareData);
  else try {
    hydrate((await api.getPlannerData()).data);
  } catch { $('#fileSaveStatus').textContent = '未能读取本地文件；为保护数据，未使用浏览器缓存'; }
  if (cached) {
    const data = cached; const inferredKey = state.plans.some(plan => plan.id === data.planKey) ? data.planKey : state.versionKey;
    load(data, inferredKey); save(); state.schedule.length ? renderSchedule(state.schedule) : renderManualSchedule();
  } else loadPreset(state.versionKey || defaultPlanId);
  await initMap();
  if (!isShareMode) await ensureFlightAirportLinks();
  await showDayOverview('');
  setTimeout(() => {
    map?.invalidateSize({ animate: false, pan: false });
    fitOverview();
  }, 240);
  renderRouteTotals();
  persistence.setOnFileSaved?.(result => { fileRevision = result.updatedAt || result.savedAt || fileRevision; });
  persistence.enableAutoSave();
  if (!isShareMode) save();
}
const undoBtn = $('#undoBtn'), redoBtn = $('#redoBtn');
if (undoBtn) undoBtn.addEventListener('click', () => undoPlannerChange());
if (redoBtn) redoBtn.addEventListener('click', () => redoPlannerChange());
history.refresh();
initializePlanner();
window.addEventListener('mobile:viewchange', event => {
  if (event.detail?.view !== 'map') return;
  setTimeout(async () => { map?.invalidateSize(); await showDayOverview($('#mapDayFilter').value || ''); }, 80);
});
window.addEventListener('mobile:mapaction', async event => {
  if (!map) return;
  if (event.detail?.action === 'layers') {
    const label = cycleBaseLayer();
    window.dispatchEvent(new CustomEvent('mobile:maplayerchanged', { detail: { label } }));
    return;
  }
  if (event.detail?.action === 'fit') {
    await clearMapSelection();
    fitOverview();
    return;
  }
  if (event.detail?.action === 'locate' && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(position => {
      const latLng = [position.coords.latitude, position.coords.longitude];
      if (currentLocationLayer) map.removeLayer(currentLocationLayer);
      currentLocationLayer = L.layerGroup().addTo(map);
      if (Number.isFinite(position.coords.accuracy)) {
        L.circle(latLng, {
          radius: position.coords.accuracy, color: '#1976d2', weight: 1,
          fillColor: '#64b5f6', fillOpacity: .12, interactive: false
        }).addTo(currentLocationLayer);
      }
      L.marker(latLng, {
        zIndexOffset: 1200,
        icon: L.divIcon({
          className: 'current-location-marker', iconSize: [24, 24], iconAnchor: [12, 12],
          html: '<span aria-hidden="true"></span>'
        })
      }).bindPopup(`<b>我的当前位置</b><br><small>定位精度约 ${Math.round(position.coords.accuracy || 0)} 米</small>`).addTo(currentLocationLayer);
      map.setView(latLng, Math.max(map.getZoom(), 14), { animate: true });
    }, () => { $('#routeError').textContent = '无法获取当前位置，请检查浏览器定位权限。'; }, { enableHighAccuracy: true, timeout: 8000 });
  }
});
window.addEventListener('mobile:routefocus', event => {
  const index = Number(event.detail?.index);
  if (Number.isInteger(index)) focusScheduleEvent(index, { skipDriveQuery: true });
});
// 移动端行程改名：更新标题输入框 → 保存到数据 → 同步云端 trips.name
window.addEventListener('mobile:triprename', event => {
  const name = (event.detail?.name || '').trim();
  if (!name) return;
  $('#tripName').value = name;
  save();
  const tripId = api.getActiveTripId?.();
  if (tripId) api.updateTrip(tripId, { name }).catch(() => {});
});
// 页面卸载时统一清理监听器与 Leaflet 地图,避免热重载/重复挂载产生残留。
window.addEventListener('pagehide', () => {
  scheduleView.destroy();
  mapControllerFeature.destroy();
});
}
