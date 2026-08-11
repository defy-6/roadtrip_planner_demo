import { PRESET_PLANS, PRESET_SCHEDULES } from '../plans.js';
import { DEFAULT_PLAN_ID, DRIVE_TRAVEL_MODES, MARKER_COLORS, PLACE_TYPE_NAMES, TRANSPORT_MODES } from '../core/constants.js';
import { createRuntimePlannerState } from '../core/state.js';
import { $, clockToMinute, escapeHtml, minuteToClock, pause } from '../core/utils.js';
import { createPlansFeature } from './plans.js';
import { runtime } from '../shared/runtime.js';
import { createApi } from '../services/api.js';
import { createGeocodeService } from '../services/geocode.js';

const isShareMode = runtime.shareMode;
const shareData = runtime.shareData;
const shareAssetPath = runtime.assetBase;
if (isShareMode) document.documentElement.classList.add('share-mode');
const itemsEl = document.querySelector('#items');
const template = document.querySelector('#itemTpl');
const state = createRuntimePlannerState();
const defaultPlanId = DEFAULT_PLAN_ID;
function planIdFromName(name) { return `${String(name || 'plan').trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '') || 'plan'}-${crypto.randomUUID().slice(0, 8)}`; }
const { normalizePlanContainer, renderPlanSelect, setPlanCatalog } = createPlansFeature({ state, select: () => $('#planSelect'), deleteButton: () => $('#deletePlanBtn'), escapeHtml, defaultPlanId });
document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: `${shareAssetPath}types.css` }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.locations-panel{margin-top:18px;padding-top:16px;border-top:1px solid #e4e6df}.locations-panel h3{margin:0;font-size:15px}.places{display:grid;gap:9px;margin-top:10px}.place-card{display:grid;gap:6px;padding:10px;border:1px dashed #cdd9d0;border-radius:8px;background:#fbfdfb}.place-card>div{display:flex;align-items:center;gap:7px}.place-card b{font-size:13px}.place-type{padding:2px 5px;border-radius:4px;background:#eee2f6;color:#58366c;font-size:10px;font-weight:700}.place-card input,.place-card textarea{width:100%;border:0;border-bottom:1px solid #e6e6e1;padding:4px 0;background:transparent;font:12px inherit}.place-card textarea{height:28px}.place-card button{justify-self:start;padding:4px 7px;background:transparent;border:1px solid #9dbaaa;border-radius:5px;color:#1d5b46;font:12px inherit}.place-card .place-delete{color:#9a5346;border-color:#dcb7b0}.event-place-link{display:block;margin-top:-2px;color:#607569;font-size:11px}.event-edit{margin-top:2px;justify-self:start;padding:4px 7px;background:#eff5ef;border:1px solid #9dbaaa;border-radius:5px;color:#1d5b46;font:12px inherit;cursor:pointer}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.calendar-block.compact{padding:1px 5px;line-height:1}.calendar-block.compact time{font-size:10px;white-space:nowrap}.calendar-block.compact em,.calendar-block.compact b,.calendar-block.compact small{display:none}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.schedule-selecting{cursor:crosshair!important}.calendar-marquee{position:fixed;z-index:1200;border:1px dashed #1d6b4f;background:#6aa98230;pointer-events:none}.calendar-block.batch-selected{outline:2px solid #d97706;outline-offset:2px;filter:saturate(1.25)}.calendar-drop-preview{position:absolute;left:5px;right:5px;border:2px dashed #1d6b4f;border-radius:6px;background:#ffffffdd;color:#174735;pointer-events:none;z-index:20;display:flex;align-items:flex-start;padding:3px 7px;font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;box-shadow:0 1px 5px #173c3240}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.map-route-legend{position:absolute;left:10px;bottom:10px;z-index:700;max-width:calc(100% - 20px);background:#fffffff0;border:1px solid #d8e1da;border-radius:7px;padding:6px 8px;display:grid;gap:3px;font-size:10px;box-shadow:0 2px 8px #173c3220}.map-route-legend b{font-size:10px;color:#315540}.map-route-legend div{display:flex;align-items:center;gap:5px;white-space:nowrap}.map-route-legend i{width:8px;height:8px;border:1px solid #fff;border-radius:50%;box-shadow:0 0 0 1px #173c3228;display:inline-block}.map-route-legend i.route-legend-swatch{width:17px;height:3px;border:0;border-radius:2px;box-shadow:none}.map-route-legend small{max-width:190px;color:#607569;line-height:1.25}.route-direction-arrow{display:grid;width:12px;height:12px;place-items:center;color:#1d5b46;font:500 11px/1 system-ui,sans-serif;text-shadow:0 0 1px #fff,0 0 2px #fff;transform:rotate(var(--bearing));transform-origin:center;pointer-events:auto}.route-direction-arrow.is-highlighted{width:18px;height:18px;color:#fff!important;font-size:15px;text-shadow:0 0 2px #174260,0 0 5px #174260,0 0 8px #fff}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.weather-meta{display:block!important;color:#245e84!important}' }));
let map;
let routeLayer;
let markerLayer;
let dayOverviewLayer;
let dayOverviewRequestId = 0;
let dayOverviewBounds;
let mapFocusDate = '';
let renderedOverviewDate = null;
let mapRouteLegend;
const selectedScheduleIndexes = new Set();
let scheduleSelectionMode = true;
let suppressScheduleClick = false;
let scheduleSelectionAnchor = null;
let schedulePasteAnchor = null;
let schedulePasteTarget = null;
let schedulePasteTargetId = null;
let activeScheduleDragIndexes = [];
const scheduleUndoStack = [];
let scheduleClipboard = '';
let editingScheduleIndex = null;
let editingNewEvent = false;
let pendingEditorRoute = null;
const selectedPlaceIds = new Set();
let placeSearchText = '';
let placeTypeFilter = '';
const markerColors = MARKER_COLORS;
const typeNames = PLACE_TYPE_NAMES;
// 地点库保留细分类，地图图例按更易读的出行类别合并。
const mapDisplayType = type => ['flight', 'transport'].includes(type) ? 'transport' : ['service', 'fuel', 'supply'].includes(type) ? 'supply' : type;
function normalizeCategoryColor(value, fallback = '#2f73a9') { return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback; }
function customPlaceCategories() { return (state.placeCategories || []).filter(category => category?.id && category?.name); }
function placeCategoryMeta(type) { return customPlaceCategories().find(category => category.id === type); }
function placeTypeName(type) { return placeCategoryMeta(type)?.name || typeNames[type] || '地点'; }
function placeTypeColor(type) { return normalizeCategoryColor(placeCategoryMeta(type)?.color, markerColors[mapDisplayType(type)] || markerColors.spot); }
function placeTypeOptionsHtml(includeDrive = false) {
  const defaults = Object.entries(typeNames).filter(([type]) => includeDrive || type !== 'drive');
  return [...defaults, ...customPlaceCategories().map(category => [category.id, category.name])].map(([type, label]) => `<option value="${escapeHtml(type)}">${escapeHtml(label)}</option>`).join('');
}
function renderPlaceTypeFilter() {
  const select = $('#placeTypeFilter'); if (!select) return;
  const selected = placeTypeFilter;
  select.innerHTML = `<option value="">全部类型</option>${placeTypeOptionsHtml()}`;
  select.value = [...select.options].some(option => option.value === selected) ? selected : '';
  placeTypeFilter = select.value;
}
const mapDisplayTypeName = type => ({ transport: '交通', supply: '补给' }[mapDisplayType(type)] || placeTypeName(type));
function mapPointStyle(type, options = {}) {
  const color = placeTypeColor(type);
  return { radius: 3.5, color, weight: 1.3, fillColor: color, fillOpacity: .95, ...options };
}
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
const routeLinkFields = document.createElement('div');
routeLinkFields.id = 'routeLinkFields'; routeLinkFields.className = 'editor-grid';
routeLinkFields.innerHTML = '<label style="grid-column:1 / -1">关联通用路线<select id="routeLibrarySelect"><option value="">新建路线 / 暂不选择</option></select></label><label>出行方式<select id="routeTransportMode"><option value="driving">自驾</option><option value="walking">步行</option><option value="bicycling">骑行</option><option value="transit">公共交通</option></select></label><label id="routeTravelModeField">自驾策略<select id="routeTravelMode"><option value="recommended">高德推荐</option><option value="highway">高速优先</option><option value="fastest">速度最快</option><option value="lowToll">少收费</option><option value="avoidHighway">不走高速</option><option value="mainRoad">大路优先</option></select></label><div id="routeTransitCities" class="editor-grid" style="grid-column:1 / -1" hidden><label>公交起点城市<input id="routeTransitCity" placeholder="例如：北京市 / 010"></label><label>公交终点城市<input id="routeTransitCityd" placeholder="跨城时必填，例如：上海市"></label><small class="hint" style="grid-column:1 / -1">公共交通将按高德公交/地铁/铁路方案计算；目前不支持途经点。</small></div><small id="routeModeHint" class="hint" style="grid-column:1 / -1">自驾支持途经点和过路费估算；更改方式或策略后请重新获取路线。</small><label>起点地点<input id="routeOriginSearch" list="editorPlaceList" placeholder="搜索地点名称或地址"><select id="routeOrigin" style="display:none"></select></label><label>终点地点<input id="routeDestinationSearch" list="editorPlaceList" placeholder="搜索地点名称或地址"><select id="routeDestination" style="display:none"></select></label><label>自定义起点名称<input id="routeOriginName" placeholder="例如：伊宁市区酒店"></label><label>自定义起点地址<input id="routeOriginAddress" placeholder="选择地点后可留空"></label><label>自定义终点名称<input id="routeDestinationName" placeholder="例如：赛里木湖东门"></label><label>自定义终点地址<input id="routeDestinationAddress" placeholder="选择地点后可留空"></label><label id="routeWaypointsField" style="grid-column:1 / -1">途经地点（从地点库勾选后可排序）<select id="routeWaypoints" multiple size="4"></select></label><button type="button" id="addRouteWaypoint" class="ghost" style="grid-column:1 / -1">+ 新增途经地点</button><div id="routeWaypointOrder" class="waypoint-order" aria-label="途经点顺序"></div><div id="editorRouteStatus" class="resolved-place" style="grid-column:1 / -1" hidden></div><button type="button" id="resolveEditorRoute" style="grid-column:1 / -1">获取高德路线</button>';
const routeEditorSection = document.createElement('details');
routeEditorSection.id = 'routeEditorSection'; routeEditorSection.className = 'editor-section route-editor-section'; routeEditorSection.open = true;
routeEditorSection.innerHTML = '<summary><span>路线设置</span><small>起终点、途经点与高德路线</small></summary>';
routeEditorSection.append(routeLinkFields);
$('#editorForm').insertBefore(routeEditorSection, $('.editor-actions'));
const eventLocationField = document.createElement('label');
eventLocationField.id = 'eventLocationField';
eventLocationField.innerHTML = '关联地点<input id="eventLocationSearch" list="editorPlaceList" placeholder="搜索地点名称或地址"><select id="eventLocation" style="display:none"><option value="">暂不关联地点</option></select><button type="button" id="resolveEditorPlace">查询高德位置并关联</button><datalist id="editorPlaceList"></datalist>';
$('#editorForm').insertBefore(eventLocationField, routeEditorSection);
const flightFields = document.createElement('div');
flightFields.id = 'flightFields'; flightFields.className = 'editor-grid'; flightFields.hidden = true;
flightFields.innerHTML = '<label>航班号<input id="editorFlightNumber" placeholder="例如：CZ6825"></label><label>到达日期<input id="editorFlightArrivalDate" type="date"></label><label>起飞机场<input id="editorFlightDeparture" placeholder="例如：广州白云机场"></label><label>降落机场<input id="editorFlightArrival" placeholder="例如：伊宁机场"></label><label>出发航站楼<input id="editorFlightDepartureTerminal" placeholder="可留空"></label><label>到达航站楼<input id="editorFlightArrivalTerminal" placeholder="可留空"></label><label>经停机场<input id="editorFlightStopoverAirport" placeholder="可选，例如：郑州新郑国际机场"></label><label>经停到达<input id="editorFlightStopoverArrivalTime" type="time" step="300"></label><label>经停起飞<input id="editorFlightStopoverDepartureTime" type="time" step="300"></label>';
$('#editorForm').insertBefore(flightFields, eventLocationField);
const editorDeleteButton = document.createElement('button');
editorDeleteButton.type = 'button'; editorDeleteButton.id = 'editorDelete'; editorDeleteButton.textContent = '删除事件';
$('.editor-actions').prepend(editorDeleteButton);
const priceFields = document.createElement('div');
priceFields.id = 'priceFields'; priceFields.className = 'editor-grid';
priceFields.innerHTML = '<div style="grid-column:1 / -1"><b>单人费用 × 人数</b><small class="hint">可分别填写成人票、学生票、儿童票等不同单价。</small><div id="editorPerPersonPrices"></div><button type="button" class="ghost" data-add-price="person">+ 单人费用</button></div><div style="grid-column:1 / -1"><b>共同费用</b><small class="hint">适用于大家一起的餐饮、酒店、停车、整车费用等。</small><div id="editorSharedPrices"></div><button type="button" class="ghost" data-add-price="shared">+ 共同费用</button></div><div id="editorPriceTotal" class="hint" style="align-self:end;padding-bottom:7px;grid-column:1 / -1"></div>';
const priceEditorSection = document.createElement('details');
priceEditorSection.id = 'priceEditorSection'; priceEditorSection.className = 'editor-section';
priceEditorSection.innerHTML = '<summary><span>费用与预算</span><small>门票、餐饮、住宿与共同费用</small></summary>';
priceEditorSection.append(priceFields);
$('#editorForm').insertBefore(priceEditorSection, $('.editor-actions'));
const weatherFields = document.createElement('div');
weatherFields.id = 'editorWeatherFields';
weatherFields.innerHTML = '<div id="editorWeatherStatus" class="resolved-place" hidden></div><button type="button" id="queryEditorWeather" class="ghost">查询天气</button><small>普通事件按关联地点和开始时间查询；路程按起点开始、终点结束时刻查询；航班按起飞与到达机场的对应时刻查询。</small>';
const weatherEditorSection = document.createElement('details');
weatherEditorSection.id = 'weatherEditorSection'; weatherEditorSection.className = 'editor-section';
weatherEditorSection.innerHTML = '<summary><span>天气信息</span><small>按行程日期与时刻查询</small></summary>';
weatherEditorSection.append(weatherFields);
$('#editorForm').insertBefore(weatherEditorSection, $('.editor-actions'));
function normalizedPriceItems(info = {}) {
  if (info.perPersonItems || info.sharedItems) return { perPersonItems: info.perPersonItems || [], sharedItems: info.sharedItems || [] };
  const perPersonItems = info.ticketPrice ? [{ amount: info.ticketPrice, people: info.people || 1, note: '门票' }] : [];
  const sharedItems = info.vehicleFee ? [{ amount: info.vehicleFee, note: '整车费用' }] : (info.total ? [{ amount: info.total, note: info.note || '' }] : []);
  return { perPersonItems, sharedItems };
}
function addEditorPriceLine(kind, item = {}) {
  const target = kind === 'person' ? $('#editorPerPersonPrices') : $('#editorSharedPrices');
  if (!target) return;
  const line = document.createElement('div'); line.className = 'editor-price-line'; line.style.cssText = 'display:grid;grid-template-columns:1fr 86px 1.5fr auto;gap:7px;margin:5px 0';
  if (kind === 'person') line.innerHTML = '<input data-price-amount type="number" min="0" step="0.01" placeholder="单价（元）"><input data-price-people type="number" min="1" step="1" placeholder="人数"><input data-price-note placeholder="例如：学生票"><button type="button" class="danger" data-remove-price>×</button>';
  else { line.style.gridTemplateColumns = '1fr 2fr auto'; line.innerHTML = '<input data-price-amount type="number" min="0" step="0.01" placeholder="金额（元）"><input data-price-note placeholder="例如：酒店两晚 / 晚餐"><button type="button" class="danger" data-remove-price>×</button>'; }
  line.dataset.priceKind = kind;
  line.querySelector('[data-price-amount]').value = item.amount ?? '';
  if (kind === 'person') line.querySelector('[data-price-people]').value = item.people ?? '';
  line.querySelector('[data-price-note]').value = item.note ?? '';
  target.append(line);
}
function renderEditorPriceItems(info) {
  $('#editorPerPersonPrices').innerHTML = ''; $('#editorSharedPrices').innerHTML = '';
  const items = normalizedPriceItems(info);
  (items.perPersonItems.length ? items.perPersonItems : [{}]).forEach(item => addEditorPriceLine('person', item));
  (items.sharedItems.length ? items.sharedItems : [{}]).forEach(item => addEditorPriceLine('shared', item));
  updateEditorPriceTotal();
}
function collectEditorPriceInfo() {
  const perPersonItems = [...document.querySelectorAll('#editorPerPersonPrices .editor-price-line')].map(line => ({ amount: Number(line.querySelector('[data-price-amount]').value || 0), people: Math.max(1, Number(line.querySelector('[data-price-people]').value || 1)), note: line.querySelector('[data-price-note]').value.trim() })).filter(item => item.amount || item.note);
  const sharedItems = [...document.querySelectorAll('#editorSharedPrices .editor-price-line')].map(line => ({ amount: Number(line.querySelector('[data-price-amount]').value || 0), note: line.querySelector('[data-price-note]').value.trim() })).filter(item => item.amount || item.note);
  const total = perPersonItems.reduce((sum, item) => sum + item.amount * item.people, 0) + sharedItems.reduce((sum, item) => sum + item.amount, 0);
  return total || perPersonItems.length || sharedItems.length ? { perPersonItems, sharedItems, total } : undefined;
}
function updateEditorPriceTotal() { const info = collectEditorPriceInfo(); if ($('#editorPriceTotal')) $('#editorPriceTotal').textContent = info ? `自动汇总：${info.total.toFixed(2)} 元` : '费用可留空；单人费用与共同费用会自动相加。'; }
priceFields.addEventListener('input', updateEditorPriceTotal);
priceFields.onclick = event => { const add = event.target.closest('[data-add-price]'); if (add) { addEditorPriceLine(add.dataset.addPrice); updateEditorPriceTotal(); } const remove = event.target.closest('[data-remove-price]'); if (remove) { remove.closest('.editor-price-line')?.remove(); updateEditorPriceTotal(); } };
const locationsPanel = document.createElement('section');
locationsPanel.className = 'locations-panel';
locationsPanel.innerHTML = '<div class="aside-head"><h3>通用地点库 <small id="placeCount"></small></h3><button type="button" id="addPlaceBtn">+ 地点</button></div><p class="hint">地点跨计划通用；自定义地点类别仅保存于当前计划。</p><div class="location-toolbar"><input id="placeSearch" type="search" placeholder="搜索名称、地址或备注"><select id="placeTypeFilter" aria-label="按地点类型筛选"></select><button type="button" id="selectAllPlaces">全选结果</button><button type="button" id="resolveSelectedPlaces">批量查询位置</button><button type="button" class="danger" id="deleteSelectedPlaces">批量删除</button></div><details class="batch-add"><summary>批量新增地点</summary><textarea id="batchPlaceInput" placeholder="每行：类型｜名称｜地址\n例如：地名｜伊宁市｜新疆伊犁州伊宁市"></textarea><div class="batch-actions"><button type="button" id="batchAddPlaces">导入这些地点</button><small>景点、地名、饮食、住宿、机场、服务区、加油站、补给</small></div></details><div id="places" class="places"></div>';
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
const exportSchedulePngButton = document.createElement('button');
exportSchedulePngButton.type = 'button';
exportSchedulePngButton.id = 'exportSchedulePng';
exportSchedulePngButton.className = 'ghost';
exportSchedulePngButton.textContent = '导出时间表 PNG';
const exportMapPngButton = document.createElement('button');
exportMapPngButton.type = 'button';
exportMapPngButton.id = 'exportMapPng';
exportMapPngButton.className = 'ghost';
exportMapPngButton.textContent = '导出地图 PNG';
schedulePanel.querySelector('.aside-head>div:last-child').append(updateScheduleWeatherButton, exportSchedulePngButton, createExpandButton(schedulePanel, '时间表'));
const mapExpandButton = createExpandButton(mapWorkspace, '地图'); mapExpandButton.classList.add('map-expand'); mapWorkspace.querySelector('.map-panel').append(mapExpandButton);
const mapDayControl = document.createElement('label');
mapDayControl.className = 'map-day-control';
mapDayControl.innerHTML = '<span>地图日期</span><select id="mapDayFilter" aria-label="地图按天筛选"><option value="">全部日期</option></select>';
mapWorkspace.querySelector('.map-panel').append(mapDayControl);
exportMapPngButton.classList.add('map-export-control');
mapWorkspace.querySelector('.map-panel').append(exportMapPngButton);
const mapExportPreview = document.createElement('dialog');
mapExportPreview.id = 'mapExportPreview';
mapExportPreview.className = 'map-export-preview';
mapExportPreview.innerHTML = '<section><div class="aside-head"><h3>地图导出预览</h3><button type="button" id="closeMapExportPreview" class="ghost">关闭</button></div><p class="hint">包含自驾路线、方向箭头、地点与航班图层。确认路线位置无误后再下载。</p><img id="mapExportPreviewImage" alt="地图导出预览"><div class="editor-actions"><button type="button" id="downloadMapExportPreview">下载 PNG</button></div></section>';
document.body.append(mapExportPreview);
let pendingMapExportCanvas;
const scheduleExportPreview = document.createElement('dialog');
scheduleExportPreview.id = 'scheduleExportPreview';
scheduleExportPreview.className = 'map-export-preview';
scheduleExportPreview.innerHTML = '<section><div class="aside-head"><h3>时间表导出预览</h3><button type="button" id="closeScheduleExportPreview" class="ghost">关闭</button></div><p class="hint">已按全部日期生成。确认表头、日期与卡片排版无误后再下载。</p><img id="scheduleExportPreviewImage" alt="时间表导出预览"><div class="editor-actions"><button type="button" id="downloadScheduleExportPreview">下载 PNG</button></div></section>';
document.body.append(scheduleExportPreview);
let pendingScheduleExportCanvas;
const locationActions = document.createElement('div'); locationActions.className = 'location-head-actions';
const addPlaceCategoryButton = document.createElement('button'); addPlaceCategoryButton.type = 'button'; addPlaceCategoryButton.id = 'addPlaceCategoryBtn'; addPlaceCategoryButton.className = 'ghost'; addPlaceCategoryButton.textContent = '+ 类别';
const addPlaceButton = $('#addPlaceBtn'); addPlaceButton.before(locationActions); locationActions.append(addPlaceCategoryButton, addPlaceButton, createExpandButton(locationsPanel, '地点库'));
const placeEditor = document.createElement('dialog');
placeEditor.id = 'placeEditor'; placeEditor.className = 'event-editor';
placeEditor.innerHTML = '<form id="placeEditorForm" class="editor-form" method="dialog"><h3>新增地点</h3><label>地点类型<select id="newPlaceType"></select></label><label>地点名称<input id="newPlaceName" required placeholder="例如：赛里木湖东门"></label><label>详细地址<input id="newPlaceAddress" placeholder="地址未确定可留空"></label><label>地点图片（可选）<input id="newPlacePhoto" type="file" accept="image/*"></label><label>备注<textarea id="newPlaceNote" rows="3" placeholder="预约、营业时间等信息"></textarea></label><div class="editor-actions"><button type="button" id="placeEditorCancel" class="ghost">取消</button><button type="submit">保存地点</button></div></form>';
document.body.append(placeEditor);
const placeCategoryEditor = document.createElement('dialog');
placeCategoryEditor.id = 'placeCategoryEditor'; placeCategoryEditor.className = 'event-editor';
placeCategoryEditor.innerHTML = '<form id="placeCategoryEditorForm" class="editor-form" method="dialog"><h3>新增地点类别</h3><p class="hint">仅当前计划可用；地点库中的地点仍可跨计划复用。</p><label>类别名称<input id="newPlaceCategoryName" required maxlength="16" placeholder="例如：露营地"></label><label>图例颜色<input id="newPlaceCategoryColor" type="color" value="#2f73a9"></label><div class="editor-actions"><button type="button" id="placeCategoryEditorCancel" class="ghost">取消</button><button type="submit">保存类别</button></div></form>';
document.body.append(placeCategoryEditor);
let pendingPlaceConfirmation;
function fileToDataUrl(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); }
function confirmNewPlace(initial = {}) {
  $('#placeEditorForm').reset();
  $('#newPlaceType').innerHTML = placeTypeOptionsHtml();
  $('#newPlaceType').value = initial.type || placeTypeFilter || 'spot';
  $('#newPlaceName').value = initial.name || '';
  $('#newPlaceAddress').value = initial.address || '';
  $('#newPlaceNote').value = initial.note || '';
  placeEditor.querySelector('h3').textContent = initial.fromEvent ? '确认新增并关联地点' : '新增地点';
  placeEditor.showModal();
  requestAnimationFrame(() => $('#newPlaceName').focus());
  return new Promise(resolve => { pendingPlaceConfirmation = resolve; });
}
document.head.append(Object.assign(document.createElement('style'), { textContent: '@media(min-width:981px){main{max-width:1500px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:18px;align-items:start}main>header,main>.hero{grid-column:1/-1}.schedule-panel,.content{height:calc(100vh - 190px);min-height:680px;position:relative;align-self:start}.schedule-panel{grid-column:1;grid-row:3;margin:0;display:flex;flex-direction:column}.schedule-panel .schedule{flex:1;min-height:0}.schedule-scroll{max-height:none;height:100%}.content{grid-column:2;grid-row:3;display:block}.content>.map-panel{height:100%;min-height:0;display:grid;grid-template-rows:minmax(0,1fr) auto auto auto}.content>.map-panel .map{height:auto;min-height:0}.content>.map-panel .route-btn{position:static;top:auto;left:auto;transform:none;justify-self:center;margin-top:-18px;z-index:500}.content>aside{display:none}.locations-panel{grid-column:1/-1;grid-row:4;margin-top:18px!important;padding:20px!important;border:1px solid #e4e1d8!important;border-radius:14px;background:#fffdf8}.locations-panel .places{grid-template-columns:repeat(3,minmax(0,1fr))}main>.schedule-panel+.content{margin-top:0}}@media(max-width:980px){.locations-panel{margin-top:18px;padding:16px;border:1px solid #e4e1d8;border-radius:14px;background:#fffdf8}}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.resolved-place{display:block;padding:5px 7px;border-radius:5px;background:#eff5ef;color:#426655;font-size:10px;line-height:1.45}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.place-query-name{width:100%;border:0;border-bottom:1px solid #e6e6e1;padding:4px 0;outline:0;font:12px inherit;color:#315540}.place-create{justify-self:start;margin-top:2px;padding:5px 8px;background:#1d5b46;color:#fff;border-radius:5px;font:12px inherit}.place-create:disabled{opacity:.55;cursor:wait}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.route-inline{display:grid;gap:8px;margin-top:4px;padding:10px;border:1px solid #cddbd1;border-radius:8px;background:#f6faf7}.route-inline[hidden]{display:none}.route-inline>b{font-size:12px;color:#315540}.route-inline-grid{display:grid;grid-template-columns:1fr 1.4fr;gap:6px}.route-inline input,.route-inline textarea{min-width:0;width:100%;box-sizing:border-box;border:1px solid #d8e1da;border-radius:5px;padding:6px;background:#fff;font:11px inherit;color:#315540}.route-inline textarea{min-height:52px;resize:vertical}.inline-route-create{justify-self:start;padding:6px 9px;border:0;border-radius:5px;background:#2563a8;color:#fff;font:11px inherit;cursor:pointer}.inline-route-create:disabled{opacity:.55;cursor:wait}@media(max-width:640px){.route-inline-grid{grid-template-columns:1fr}}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.waypoint-order{grid-column:1 / -1;display:grid;gap:4px;padding:7px;border:1px solid #d8e1da;border-radius:6px;background:#f7faf7}.waypoint-order:empty{display:none}.waypoint-order-item{display:flex;align-items:center;gap:5px;padding:4px 6px;border-radius:4px;background:#fff;color:#315540;font-size:11px}.waypoint-order-item b{min-width:17px;color:#1d5b46}.waypoint-order-item span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.waypoint-order-item button{padding:1px 5px;border:1px solid #b7cbbb;border-radius:4px;background:#fff;color:#1d5b46;cursor:pointer}.waypoint-order-item button:disabled{opacity:.35;cursor:default}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '#routeLinkFields[hidden],#eventLocationField[hidden],#flightFields[hidden]{display:none!important}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '#editorDelete{margin-right:auto;background:#fff5f2!important;color:#a44435!important;border:1px solid #dfa99f!important}#editorDelete[hidden]{display:none!important}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.content>aside{display:none}.calendar-block small{display:block;margin-top:3px;line-height:1.25}.calendar-block.selected{outline:2px solid #1d5b46;outline-offset:1px;box-shadow:0 4px 12px #173c3230}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.schedule-scroll{scrollbar-color:#9fb5a8 #f2f1eb;scrollbar-width:thin}.calendar-grid{min-width:var(--grid-width);grid-template-columns:64px repeat(var(--days),minmax(210px,1fr))}.calendar-corner{position:sticky;left:0;top:0;z-index:6;background:#f8faf7}.calendar-head{position:sticky;top:0;z-index:4;background:#f8faf7;box-shadow:0 1px 0 #e4e1d8}.calendar-head b{font-size:14px}.time-rail{position:sticky;left:0;z-index:3;box-shadow:2px 0 5px #173c3212}.calendar-block{cursor:pointer;padding:6px 8px;border-radius:8px;box-shadow:0 1px 2px #173c3212;transition:transform .15s ease,box-shadow .15s ease}.calendar-block:hover{transform:translateY(-1px);box-shadow:0 5px 12px #173c3222;z-index:5}.calendar-block em{display:inline-block;margin:2px 0 3px;padding:1px 5px;border-radius:999px;background:#ffffff80;font-size:9px;font-style:normal;font-weight:700;letter-spacing:.04em}.calendar-block b{font-size:12px;line-height:1.25}.calendar-block small{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:10px;opacity:.82}.schedule-panel>.aside-head{align-items:center}.schedule-panel>.aside-head>div:last-child{display:flex;align-items:center;gap:8px;flex-wrap:wrap}@media(max-width:800px){.calendar-grid{grid-template-columns:58px repeat(var(--days),minmax(190px,1fr))}}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.calendar-block.type-spot{background:#dff3e8;border-color:#1d6b4f;color:#174735}.calendar-block.type-food{background:#ffe7cf;border-color:#d97706;color:#7b4107}.calendar-block.type-hotel{background:#eee2f6;border-color:#8750ad;color:#58366c}.calendar-block.type-drive{background:#dcecf9;border-color:#2f73a9;color:#174260}.calendar-block.type-flight{background:#fff4c7;border-color:#d4a72c;color:#70530a}.calendar-block.type-transport{background:#e1ebff;border-color:#506fb4;color:#294574}.calendar-block.type-service{background:#e4f4f1;border-color:#26877b;color:#225c55}.calendar-block.type-fuel{background:#f3e7fb;border-color:#9a58bc;color:#63337b}.calendar-block.type-supply{background:#eceff3;border-color:#64748b;color:#3f4b5d}.calendar-block.type-drive small,.calendar-block.type-transport small{color:#476d83}#addScheduleBtn{padding:6px 9px;border:0;border-radius:6px;background:#1d5b46;color:#fff;font:11px inherit;cursor:pointer}#importFlightBtn{padding:5px 8px;font-size:11px;white-space:nowrap}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.place-type.type-spot{background:#dff3e8;color:#174735}.place-type.type-geography{background:#d9f1ed;color:#155e57}.place-type.type-food{background:#ffe7cf;color:#7b4107}.place-type.type-hotel{background:#eee2f6;color:#58366c}.place-type.type-flight{background:#fff4c7;color:#70530a}.place-type.type-transport{background:#e1ebff;color:#294574}.place-type.type-service{background:#e4f4f1;color:#225c55}.place-type.type-fuel{background:#f3e7fb;color:#63337b}.place-type.type-supply{background:#eceff3;color:#3f4b5d}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.calendar-block[draggable="true"]{cursor:grab}.calendar-block.dragging{opacity:.4;cursor:grabbing}.calendar-day.drop-target{background-color:#edf7f0;box-shadow:inset 0 0 0 2px #5f9c78}.item[draggable="true"]{cursor:grab}.item.dragging{box-shadow:0 8px 22px #173c3230}.item.jump-highlight{animation:jumpPulse .9s ease}@keyframes jumpPulse{0%,100%{box-shadow:0 0 0 0 #4f9a7470}45%{box-shadow:0 0 0 8px #4f9a7425}}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.location-toolbar{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.location-toolbar input{flex:1 1 150px;min-width:0}.location-toolbar input,.location-toolbar select{border:1px solid #d8e1da;border-radius:6px;padding:6px;background:#fff;font:12px inherit;color:#315540}.location-toolbar button,.batch-add summary,.batch-add button{padding:6px 8px;border:1px solid #9dbaaa;border-radius:6px;background:#fff;color:#1d5b46;font:11px inherit;cursor:pointer}.location-toolbar .danger{color:#9a5346;border-color:#dcb7b0}.batch-add{margin-top:8px}.batch-add summary{display:inline-block;list-style:none}.batch-add textarea{box-sizing:border-box;width:100%;min-height:76px;margin-top:7px;border:1px solid #d8e1da;border-radius:6px;padding:7px;font:11px inherit}.batch-actions{display:flex;align-items:center;gap:8px;margin-top:6px}.place-card.selected{border-style:solid;border-color:#4f8c6b;background:#f0f7f2}.place-select{width:auto!important}#placeCount{color:#718076;font-weight:400}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.locations-panel{height:680px;display:flex;flex-direction:column;overflow:hidden}.locations-panel>.aside-head,.locations-panel>p.hint,.locations-panel>.location-toolbar,.locations-panel>.batch-add{flex:0 0 auto}.locations-panel>.places{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:2px 8px 12px 2px;align-content:start;scrollbar-color:#9fb5a8 #f2f1eb;scrollbar-width:thin}.locations-panel>.places::-webkit-scrollbar{width:9px}.locations-panel>.places::-webkit-scrollbar-track{background:#f2f1eb;border-radius:9px}.locations-panel>.places::-webkit-scrollbar-thumb{background:#9fb5a8;border-radius:9px;border:2px solid #f2f1eb}@media(max-width:980px){.locations-panel{height:620px}.locations-panel>.places{grid-template-columns:1fr}}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.panel-expand{padding:5px 8px!important;font-size:11px!important;white-space:nowrap}.location-head-actions{display:flex;gap:6px;align-items:center}.map-panel{position:relative}.map-expand{position:absolute;right:12px;top:12px;z-index:600;background:#fff!important;box-shadow:0 2px 8px #173c3230}.panel-expanded .map-expand{right:14px}@media(min-width:981px){html,body{height:100%;overflow:hidden}main{height:100vh;max-width:none!important;padding:10px 14px!important;display:grid!important;grid-template-columns:minmax(330px,32%) minmax(430px,42%) minmax(280px,26%)!important;grid-template-rows:46px 66px minmax(0,1fr)!important;gap:10px 12px!important;align-items:stretch!important}main>header{grid-column:1/-1!important;grid-row:1!important;min-width:0}header h1{font-size:27px;line-height:1}header .eyebrow{display:none}.top-actions{align-items:center;gap:7px}.top-actions button,.top-actions select{padding:6px 9px;font-size:12px}.top-actions .hint{font-size:10px;white-space:nowrap}.hero{grid-column:1/-1!important;grid-row:2!important;margin:0!important;padding:9px 18px!important;min-height:0;border-radius:11px}.hero>div:first-child{display:flex;align-items:center;gap:14px}.hero p{margin:0!important;font-size:12px}.hero #tripName{font-size:15px;width:310px}.route-stat{display:flex!important;align-items:center;justify-content:flex-end;gap:10px}.route-stat span{font-size:10px}.route-stat strong{font-size:22px}.route-stat small{max-width:430px;font-size:10px}.schedule-panel,.content,.locations-panel{grid-row:3!important;height:auto!important;min-height:0!important;position:relative!important;top:auto!important;margin:0!important}.schedule-panel{grid-column:1!important;padding:12px!important}.schedule-panel>.aside-head{min-height:34px;gap:7px}.schedule-panel>.aside-head h2{font-size:16px}.schedule-panel>.aside-head .eyebrow{display:none}.schedule-panel>.aside-head>div:last-child{gap:5px!important}.schedule-panel>.aside-head button,.schedule-panel>.aside-head select{padding:5px 7px;font-size:10px}.schedule-panel .schedule{min-height:0}.schedule-panel .schedule-scroll{height:100%;max-height:none}.calendar-grid{grid-template-columns:54px repeat(var(--days),minmax(175px,1fr))}.content{grid-column:2!important;display:block!important}.content>.map-panel{height:100%!important;min-height:0!important;display:grid!important;grid-template-rows:minmax(0,1fr) auto auto auto!important}.content>.map-panel .map{height:auto!important;min-height:0!important}.content>.map-panel .route-btn{position:static!important;top:auto!important;left:auto!important;transform:none!important;justify-self:center;margin-top:-17px;z-index:500;padding:6px 9px;font-size:11px}.route-detail{margin:8px 14px 12px;padding:8px 10px;max-height:92px;overflow:auto}.error{padding:5px 14px 0}.locations-panel{grid-column:3!important;padding:12px!important;border:1px solid #e4e1d8!important;border-radius:14px;background:#fffdf8}.locations-panel>.aside-head h3{font-size:15px}.locations-panel>p.hint{margin:6px 0;font-size:10px}.location-toolbar{margin-top:4px;gap:4px}.location-toolbar input{flex-basis:100%}.location-toolbar input,.location-toolbar select,.location-toolbar button,.batch-add summary,.batch-add button{padding:5px 6px;font-size:10px}.batch-add{margin-top:5px}.locations-panel>.places{grid-template-columns:1fr!important;margin-top:7px}.place-card{padding:8px}.place-photo-preview{height:92px}.panel-expanded main{grid-template-columns:1fr!important}.panel-expanded .workspace-panel:not(.is-expanded){display:none!important}.panel-expanded .workspace-panel.is-expanded{display:flex!important;grid-column:1/-1!important;grid-row:3!important}.panel-expanded .content.is-expanded{display:block!important}.panel-expanded .locations-panel>.places{grid-template-columns:repeat(3,minmax(0,1fr))!important}.panel-expanded .schedule-panel .calendar-grid{grid-template-columns:64px repeat(var(--days),minmax(220px,1fr))}}@media(max-width:980px){.panel-expand{display:none}}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.map-expand{left:12px!important;right:auto!important;z-index:1100!important}@media(min-width:981px){.schedule-panel,.content,.locations-panel{height:100%!important;max-height:100%!important;align-self:stretch!important;overflow:hidden!important}.schedule-panel .schedule{overflow:hidden}.content>.map-panel{overflow:hidden}}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.map-day-control{position:absolute;left:72px;top:12px;z-index:1100;display:flex;align-items:center;gap:5px;padding:4px 6px;border:1px solid #cbd8cf;border-radius:7px;background:#fffdf8eb;box-shadow:0 2px 8px #173c3220;color:#315540;font-size:9px}.map-day-control span{white-space:nowrap}.map-day-control select{max-width:132px;border:0;background:transparent;color:#173c32;font:10px inherit;outline:0}@media(max-width:980px){.map-day-control{left:12px;top:54px}}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: ':root{--text-xs:clamp(9px,.62vw,11px);--text-sm:clamp(10px,.72vw,12px);--text-md:clamp(12px,.86vw,14px);--text-lg:clamp(15px,1.15vw,19px);--text-xl:clamp(22px,2vw,32px)}body{font-size:var(--text-md)}header h1{font-size:var(--text-xl)!important}.hero #tripName{font-size:var(--text-lg)!important}.hero p,.route-stat small{font-size:var(--text-sm)!important}.route-stat strong{font-size:clamp(18px,1.65vw,27px)!important}.workspace-panel{container-type:inline-size}.schedule-panel>.aside-head h2,.locations-panel>.aside-head h3{font-size:clamp(14px,1.4cqw,19px)!important}.schedule-panel>.aside-head button,.schedule-panel>.aside-head select,.schedule-panel #scheduleHint,.location-toolbar input,.location-toolbar select,.location-toolbar button,.batch-add summary,.batch-add button{font-size:clamp(9px,1.05cqw,12px)!important}.calendar-head b{font-size:clamp(12px,1.45cqw,16px)!important}.calendar-head small,.time-label{font-size:clamp(9px,1.05cqw,12px)!important}.calendar-block{font-size:clamp(10px,1.18cqw,13px)!important}.calendar-block time{font-size:clamp(9px,1.08cqw,12px)!important}.calendar-block b{font-size:clamp(10px,1.22cqw,14px)!important}.calendar-block small{font-size:clamp(8px,1cqw,11px)!important}.calendar-block em{font-size:clamp(8px,.92cqw,10px)!important}.place-card b{font-size:clamp(11px,1.5cqw,15px)!important}.place-card input,.place-card textarea,.place-card button,.place-photo-action{font-size:clamp(9px,1.2cqw,12px)!important}.place-type,.resolved-place,.place-card .hint{font-size:clamp(8px,1.05cqw,11px)!important}.route-detail{font-size:clamp(9px,1.12cqw,12px)!important}.route-detail b{font-size:clamp(10px,1.25cqw,14px)!important}.leaflet-popup-content{font-size:clamp(11px,.8vw,13px);line-height:1.45}@container (min-width:700px){.calendar-block{padding:7px 9px}.calendar-block b{line-height:1.3}.calendar-block small{-webkit-line-clamp:3}.schedule-panel>.aside-head{padding-bottom:4px}.locations-panel>.places{gap:12px}.place-card{gap:8px;padding:11px}.place-photo-preview{height:130px}}@container (max-width:360px){.schedule-panel>.aside-head{align-items:flex-start!important}.schedule-panel>.aside-head>div:last-child{max-width:68%;justify-content:flex-end}.calendar-block{padding:4px 5px}.calendar-block small{-webkit-line-clamp:1}.locations-panel>p.hint{line-height:1.25}.location-toolbar{gap:3px}.place-card{gap:5px}.place-photo-preview{height:78px}}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.share-mode #addScheduleBtn,.share-mode #importFlightBtn,.share-mode #updateScheduleWeather,.share-mode #addPlaceBtn,.share-mode #addPlaceCategoryBtn,.share-mode #selectAllPlaces,.share-mode #resolveSelectedPlaces,.share-mode #deleteSelectedPlaces,.share-mode #newPlanBtn,.share-mode #copyPlanBtn,.share-mode #deletePlanBtn,.share-mode .batch-add,.share-mode .content>aside{display:none!important}.share-mode #tripName{pointer-events:none;border-color:transparent!important;background:transparent!important}.share-mode .place-card .place-select,.share-mode .place-card .place-type-select,.share-mode .place-card .place-name,.share-mode .place-card .place-address,.share-mode .place-card .place-note,.share-mode .place-card .place-photo-action,.share-mode .place-card .place-save,.share-mode .place-card .place-resolve,.share-mode .place-card .place-delete{display:none!important}.share-mode .place-card{grid-template-columns:1fr!important}.share-mode .place-card .place-map{display:inline-flex!important}.share-mode .place-card .place-photo-preview,.share-mode .place-card .place-photo-placeholder,.share-mode .place-card .resolved-place{grid-column:1/-1}.share-mode .locations-panel>p.hint::after{content:" · 共享页面为只读，数据以发布时版本为准。"}.share-mode .hero{box-shadow:inset 3px 0 #d4a72c}.share-mode #fileSaveStatus{color:#8b6510!important;font-weight:700}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.calendar-grid{grid-template-rows:38px auto!important}.calendar-day,.time-rail{height:var(--calendar-height)!important}.time-label{height:var(--hour-height)!important;padding-top:0!important;transform:translateY(-5px)!important}.calendar-day{background-image:repeating-linear-gradient(to bottom,transparent 0,transparent calc(var(--hour-height) - 1px),#eeeae0 var(--hour-height))!important}.schedule-panel:not(.is-expanded) .schedule-scroll{overflow-y:hidden!important}.schedule-panel:not(.is-expanded) .calendar-block{padding:1px 4px!important;border-radius:4px;line-height:1!important;white-space:nowrap;text-overflow:ellipsis}.schedule-panel:not(.is-expanded) .calendar-block time,.schedule-panel:not(.is-expanded) .calendar-block em,.schedule-panel:not(.is-expanded) .calendar-block b{display:inline!important;vertical-align:middle;white-space:nowrap}.schedule-panel:not(.is-expanded) .calendar-block time{margin-right:4px;font-size:8px!important}.schedule-panel:not(.is-expanded) .calendar-block em{margin:0 4px 0 0;padding:0 3px;font-size:7px!important}.schedule-panel:not(.is-expanded) .calendar-block b{font-size:9px!important}.schedule-panel:not(.is-expanded) .calendar-block small{display:none!important}.schedule-panel:not(.is-expanded) .calendar-block.compact>*{display:none!important}.schedule-panel:not(.is-expanded) .calendar-block.compact{min-height:0;border-radius:2px}.schedule-panel.is-expanded .schedule-scroll{overflow-y:auto!important}.schedule-panel.is-expanded .calendar-grid{grid-template-rows:48px auto!important}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '@media(min-width:981px){main{grid-template-rows:74px minmax(0,1fr)!important;gap:10px 12px!important}main>header{grid-column:1/-1!important;grid-row:1!important;height:74px;display:grid!important;grid-template-columns:92px minmax(300px,1fr) auto;gap:12px;align-items:center;padding:0 4px}header>div:first-child{align-self:center}header h1{font-size:25px!important}.top-actions{justify-self:end}.top-actions .hint{max-width:165px;overflow:hidden;text-overflow:ellipsis}.hero{grid-column:auto!important;grid-row:auto!important;height:54px;min-width:0;margin:0!important;padding:7px 12px!important;border:1px solid #d5e2d9;border-radius:10px!important;background:#eaf2ed!important;background-image:none!important;color:#173c32!important;display:flex!important;align-items:center;justify-content:space-between;gap:12px}.hero>div:first-child{min-width:0;display:block}.hero #tripName{width:min(310px,28vw)!important;color:#173c32!important;border-color:#87aa98;font-size:14px!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.hero p{display:none}.hero .route-stat{min-width:0;display:grid!important;grid-template-columns:auto auto;gap:0 8px;text-align:right}.hero .route-stat span{font-size:8px}.hero .route-stat strong{font-size:18px!important;line-height:1}.hero .route-stat small{grid-column:1/-1;max-width:360px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:8px!important}.schedule-panel,.content,.locations-panel{grid-row:2!important}.panel-expanded .workspace-panel.is-expanded{grid-row:2!important}.locations-panel:not(.is-expanded) .place-card{grid-template-columns:repeat(3,minmax(0,1fr));gap:5px!important;padding:7px!important}.locations-panel:not(.is-expanded) .place-card>div{grid-column:1/-1}.locations-panel:not(.is-expanded) .place-type-select{grid-column:1}.locations-panel:not(.is-expanded) .place-name{grid-column:2/-1}.locations-panel:not(.is-expanded) .place-address,.locations-panel:not(.is-expanded) .resolved-place{grid-column:1/-1}.locations-panel:not(.is-expanded) .place-photo-placeholder,.locations-panel:not(.is-expanded) .place-note{display:none}.locations-panel:not(.is-expanded) .place-photo-preview{grid-column:1/-1;height:62px}.locations-panel:not(.is-expanded) .place-photo-action{grid-column:1/-1}.locations-panel:not(.is-expanded) .place-card button{width:100%;padding:4px 3px!important;white-space:nowrap}.locations-panel:not(.is-expanded) .resolved-place{max-height:34px;overflow:hidden;padding:4px 6px}.locations-panel:not(.is-expanded) .place-card input,.locations-panel:not(.is-expanded) .place-card select{min-width:0;padding:3px 2px}.locations-panel.is-expanded .place-photo-placeholder{display:grid}}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '@media(min-width:981px){main{grid-template-columns:minmax(290px,32%) minmax(360px,42%) minmax(240px,26%)!important}.schedule-panel .calendar-grid[style*="--grid-width:100%"]{width:100%;min-width:100%}.schedule-panel .calendar-grid[style*="--grid-width:100%"]{grid-template-columns:52px minmax(0,1fr)!important}}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.content>.map-panel .route-btn{margin:6px auto 0!important;position:static!important;transform:none!important}.leaflet-control-attribution{max-width:58%;padding:1px 4px!important;background:#fffdf8dd!important;font-size:8px!important;line-height:1.25!important;white-space:normal;text-align:right;border-radius:4px 0 0 0}.leaflet-control-attribution a{font-size:inherit!important}@media(max-width:980px){.leaflet-control-attribution{max-width:72%}}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.calendar-block.compact{overflow:visible!important;z-index:3}.calendar-block.compact::after{content:attr(data-compact-label);position:absolute;left:3px;top:50%;transform:translateY(-50%);max-width:calc(100% - 6px);height:10px;padding:0 3px;border-radius:3px;background:inherit;color:inherit;font-size:7px;font-weight:700;line-height:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 1px 2px #173c3220}.schedule-panel.is-expanded .schedule-scroll{overflow-y:hidden!important}.schedule-panel.is-expanded .calendar-grid{grid-template-rows:38px auto!important}.schedule-panel.is-expanded .calendar-block.short{padding:1px 5px!important;line-height:1!important;white-space:nowrap}.schedule-panel.is-expanded .calendar-block.short time,.schedule-panel.is-expanded .calendar-block.short em,.schedule-panel.is-expanded .calendar-block.short b{display:inline!important;vertical-align:middle;white-space:nowrap}.schedule-panel.is-expanded .calendar-block.short time{margin-right:5px;font-size:8px!important}.schedule-panel.is-expanded .calendar-block.short em{margin:0 5px 0 0;padding:0 3px;font-size:7px!important}.schedule-panel.is-expanded .calendar-block.short b{font-size:9px!important}.schedule-panel.is-expanded .calendar-block.short small{display:none!important}.schedule-panel.is-expanded .calendar-block.compact>*{display:none!important}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '@media(min-width:981px){.schedule-panel.is-expanded .schedule-scroll{overflow-x:hidden!important;overflow-y:hidden!important}.schedule-panel.is-expanded .calendar-grid[style*="--grid-width:100%"]{width:100%!important;min-width:100%!important;grid-template-columns:42px repeat(var(--days),minmax(0,1fr))!important}.schedule-panel.is-expanded .calendar-head{padding:3px 4px!important}.schedule-panel.is-expanded .calendar-head b{font-size:10px!important;line-height:1.05}.schedule-panel.is-expanded .calendar-head small,.schedule-panel.is-expanded .time-label{font-size:8px!important}.schedule-panel.is-expanded .calendar-block{padding:2px 4px!important;border-radius:5px;font-size:8px!important;line-height:1.08!important;overflow:hidden}.schedule-panel.is-expanded .calendar-block time{font-size:8px!important;line-height:1!important}.schedule-panel.is-expanded .calendar-block em{margin:1px 2px 1px 0!important;padding:0 3px!important;font-size:7px!important;line-height:1.15!important}.schedule-panel.is-expanded .calendar-block b{font-size:9px!important;line-height:1.1!important}.schedule-panel.is-expanded .calendar-block:not(.short) b{display:-webkit-box!important;-webkit-box-orient:vertical;-webkit-line-clamp:2;white-space:normal;overflow:hidden}.schedule-panel.is-expanded .calendar-block small{display:none!important}.schedule-panel.is-expanded .calendar-block.short{padding:1px 3px!important}.schedule-panel.is-expanded .calendar-block.short time{margin-right:2px!important}.schedule-panel.is-expanded .calendar-block.short em{margin-right:2px!important}.schedule-panel.is-expanded .calendar-block.compact::after{left:2px;max-width:calc(100% - 4px);padding:0 2px;font-size:6.5px}}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.calendar-day{background-image:repeating-linear-gradient(to bottom,transparent 0,transparent calc(var(--half-hour-height) - 1px),#eeeae0 var(--half-hour-height))!important}.calendar-block,.calendar-block.compact{box-sizing:border-box;max-width:calc(100% - 2px);overflow:hidden!important}.calendar-block.compact::after{content:none!important}.calendar-block time,.calendar-block em,.calendar-block b{font-size:8px!important;line-height:1.05!important}.calendar-block time,.calendar-block em{margin-right:3px!important}.calendar-block em{padding:0 2px!important}.calendar-block.short{white-space:nowrap!important;text-overflow:ellipsis!important}.calendar-block.short time,.calendar-block.short em,.calendar-block.short b{display:inline!important;white-space:nowrap!important}.calendar-block.short small{display:none!important}@media(min-width:981px){.schedule-panel.is-expanded .calendar-block,.schedule-panel.is-expanded .calendar-block time,.schedule-panel.is-expanded .calendar-block em,.schedule-panel.is-expanded .calendar-block b{font-size:7.5px!important;line-height:1.05!important}.schedule-panel.is-expanded .calendar-block{padding:2px 3px!important}.schedule-panel.is-expanded .calendar-block:not(.short) b{-webkit-line-clamp:2}.schedule-panel.is-expanded .calendar-block.compact>*{display:inline!important}.schedule-panel.is-expanded .calendar-block.compact small{display:none!important}}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.schedule-panel:not(.is-expanded) .calendar-block time,.schedule-panel:not(.is-expanded) .calendar-block em,.schedule-panel:not(.is-expanded) .calendar-block b{font-size:8px!important;line-height:1.05!important}.schedule-panel.is-expanded .calendar-block time,.schedule-panel.is-expanded .calendar-block em,.schedule-panel.is-expanded .calendar-block b,.schedule-panel.is-expanded .calendar-block.short time,.schedule-panel.is-expanded .calendar-block.short em,.schedule-panel.is-expanded .calendar-block.short b{font-size:7px!important;line-height:1.05!important}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.calendar-block:not(.short){white-space:normal!important;text-overflow:clip!important}.calendar-block:not(.short) time{display:block!important;white-space:nowrap!important;margin-bottom:2px!important}.calendar-block:not(.short) em{display:inline-block!important;white-space:nowrap!important}.schedule-panel .calendar-block:not(.short) b{display:-webkit-box!important;-webkit-box-orient:vertical;-webkit-line-clamp:2;white-space:normal!important;overflow:hidden;overflow-wrap:anywhere}.calendar-block:not(.tall) small{display:none!important}.schedule-panel .calendar-block.roomy small{display:-webkit-box!important;-webkit-box-orient:vertical;-webkit-line-clamp:2;white-space:normal!important;overflow:hidden;overflow-wrap:anywhere;margin-top:2px!important}.schedule-panel .calendar-block.tall small{display:-webkit-box!important;-webkit-box-orient:vertical;-webkit-line-clamp:3;white-space:normal!important;overflow:hidden;overflow-wrap:anywhere;margin-top:2px!important}.schedule-panel.is-expanded .calendar-block.tall small{font-size:7px!important;line-height:1.1!important}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.calendar-block.nested-parent{padding-right:7px!important}.schedule-panel .calendar-block.nested-parent:not(.short)>b{-webkit-line-clamp:1!important;white-space:nowrap!important;text-overflow:ellipsis}.schedule-panel .calendar-block.nested-parent.tall>small{display:block!important;max-width:100%;margin-top:1px!important;white-space:nowrap!important;text-overflow:ellipsis;overflow:hidden;line-height:1.05!important}.calendar-block.nested-child{border-left-width:3px!important;box-shadow:-4px 0 0 #fff9,0 1px 3px #173c3225}.calendar-block.nested-child:not(.short)>time{display:inline!important;margin:0 4px 0 0!important}.calendar-block.nested-child:not(.short)>em{display:inline-block!important;margin:0 4px 0 0!important}.schedule-panel .calendar-block.nested-child:not(.short)>b{display:inline!important;white-space:nowrap!important;text-overflow:ellipsis;overflow:hidden;vertical-align:top}.schedule-panel .calendar-block.nested-child.tall>small{margin-top:3px!important;-webkit-line-clamp:2!important}.schedule-panel.is-expanded .calendar-block.nested-parent.tall>small{display:none!important}@media(max-width:980px){.calendar-block.nested-child{box-shadow:-3px 0 0 #fff9,0 1px 3px #173c3220}}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.calendar-block.nested-parent{padding:0!important}.calendar-parent-header{position:absolute;top:1px;left:4px;right:4px;z-index:1;height:12px;overflow:hidden;white-space:nowrap;pointer-events:none}.calendar-parent-header time,.calendar-parent-header em{display:inline!important;vertical-align:top;white-space:nowrap!important;font-size:7px!important;line-height:1!important}.calendar-parent-header time{margin-right:3px!important}.calendar-parent-header em{margin:0!important;padding:0 2px!important}.calendar-parent-content{position:absolute;left:4px;right:4px;box-sizing:border-box;z-index:0;overflow:hidden;padding:2px 3px;border-radius:4px;background:linear-gradient(90deg,#ffffff30,transparent);pointer-events:none}.calendar-parent-content b,.calendar-parent-content small{max-width:100%}.calendar-parent-content.content-compact{padding-top:1px!important;white-space:nowrap!important;text-overflow:ellipsis}.calendar-parent-content.content-compact b{display:inline!important;white-space:nowrap!important;font-size:7px!important;line-height:1!important}.calendar-parent-content.content-compact small,.calendar-parent-content.content-brief small{display:none!important}.calendar-parent-content.content-hidden{display:none!important}.schedule-panel:not(.is-expanded) .calendar-block.nested-parent>.calendar-parent-content>*{display:block!important;vertical-align:middle;white-space:normal!important}.schedule-panel .calendar-block.nested-parent>.calendar-parent-content b{overflow:hidden;text-overflow:ellipsis}.schedule-panel.is-expanded .calendar-block.nested-parent>.calendar-parent-content:not(.content-compact) b{display:-webkit-box!important;-webkit-box-orient:vertical;-webkit-line-clamp:2;white-space:normal!important;overflow:hidden}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '@media(min-width:981px){.schedule-panel.is-expanded .calendar-event-header{display:inline-block!important;white-space:nowrap!important;vertical-align:baseline!important}.schedule-panel.is-expanded .calendar-block:not(.short) .calendar-event-header>time{display:inline!important;white-space:nowrap!important;margin:0 3px 0 0!important;vertical-align:baseline!important}.schedule-panel.is-expanded .calendar-block:not(.short) .calendar-event-header>em{display:inline-block!important;white-space:nowrap!important;margin:0!important;padding:0 2px!important;vertical-align:baseline!important}.schedule-panel.is-expanded .calendar-block:not(.short):not(.nested-parent)>.calendar-event-header+b{display:-webkit-box!important;margin-top:1px!important}.schedule-panel.is-expanded .calendar-block.nested-child:not(.short)>.calendar-event-header+b{display:block!important;margin-top:1px!important;white-space:normal!important}.schedule-panel.is-expanded .calendar-parent-header .calendar-event-header{font-size:inherit!important;line-height:inherit!important}}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.schedule-panel .calendar-grid .calendar-block time,.schedule-panel .calendar-grid .calendar-block em{font-size:calc(7px * var(--calendar-font-scale,1))!important}.schedule-panel .calendar-grid .calendar-block b{font-size:calc(7.4px * var(--calendar-font-scale,1))!important;line-height:1.1!important}.schedule-panel .calendar-grid .calendar-block small{font-size:calc(6.5px * var(--calendar-font-scale,1))!important;line-height:1.12!important}.schedule-panel .calendar-grid .calendar-parent-header time,.schedule-panel .calendar-grid .calendar-parent-header em{font-size:calc(7px * var(--calendar-font-scale,1))!important}.schedule-panel .calendar-grid .calendar-parent-content b{font-size:calc(7.4px * var(--calendar-font-scale,1))!important}.schedule-panel .calendar-grid .calendar-parent-content small{font-size:calc(6.5px * var(--calendar-font-scale,1))!important}.schedule-panel .calendar-grid .time-label{font-size:calc(9px * var(--calendar-font-scale,1))!important}.schedule-panel .calendar-grid .calendar-head b{font-size:calc(12px * var(--calendar-font-scale,1))!important}.schedule-panel .calendar-grid .calendar-head small{font-size:calc(9px * var(--calendar-font-scale,1))!important}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '@media(min-width:981px){.schedule-panel.is-expanded .calendar-grid .calendar-block{padding:3px 4px!important;line-height:1.12!important}.schedule-panel.is-expanded .calendar-grid .calendar-event-header{display:inline-flex!important;align-items:center!important;gap:3px!important;white-space:nowrap!important;max-width:100%!important}.schedule-panel.is-expanded .calendar-grid .calendar-event-header time,.schedule-panel.is-expanded .calendar-grid .calendar-event-header em,.schedule-panel.is-expanded .calendar-grid .calendar-block b,.schedule-panel.is-expanded .calendar-grid .calendar-block.short time,.schedule-panel.is-expanded .calendar-grid .calendar-block.short em,.schedule-panel.is-expanded .calendar-grid .calendar-block.short b{font-size:calc(8px * var(--calendar-font-scale,1))!important;line-height:1.12!important}.schedule-panel.is-expanded .calendar-grid .calendar-event-header time,.schedule-panel.is-expanded .calendar-grid .calendar-event-header em{display:inline!important;margin:0!important;padding:0!important;white-space:nowrap!important}.schedule-panel.is-expanded .calendar-grid .calendar-block b{display:-webkit-box!important;-webkit-box-orient:vertical;-webkit-line-clamp:2;white-space:normal!important;overflow:hidden!important;margin-top:2px!important}.schedule-panel.is-expanded .calendar-grid .calendar-block.short b{display:inline!important;margin:0!important;white-space:nowrap!important}.schedule-panel.is-expanded .calendar-grid .calendar-block small,.schedule-panel.is-expanded .calendar-grid .calendar-parent-content small{font-size:calc(6.8px * var(--calendar-font-scale,1))!important;line-height:1.14!important}.schedule-panel.is-expanded .calendar-grid .calendar-block.short small{display:none!important}}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.calendar-grid.png-export{grid-template-rows:48px auto!important}.calendar-grid.png-export .calendar-corner,.calendar-grid.png-export .calendar-head,.calendar-grid.png-export .time-rail{position:relative!important;top:auto!important;left:auto!important}.calendar-grid.png-export .calendar-head{display:block!important;padding:7px 10px!important;box-shadow:none!important}.calendar-grid.png-export .calendar-head b,.calendar-grid.png-export .calendar-head small{display:block!important;position:static!important;transform:none!important}.calendar-grid.png-export .time-rail{box-shadow:none!important}.map.png-export .leaflet-control-zoom{display:none!important}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.map-export-preview{width:min(1100px,94vw);max-width:none;padding:0;border:0;border-radius:14px;background:#fffdf8;box-shadow:0 20px 70px #173c3260}.map-export-preview::backdrop{background:#173c3255}.map-export-preview section{padding:16px}.map-export-preview .aside-head{margin-bottom:4px}.map-export-preview p{margin:0 0 10px}.map-export-preview img{display:block;max-width:100%;max-height:68vh;margin:auto;border:1px solid #e4e1d8;border-radius:8px;background:#f7f4ed;object-fit:contain}.map-export-preview .editor-actions{margin-top:12px}.map-export-control{position:absolute;z-index:1100;left:228px;top:12px;padding:5px 8px!important;font-size:10px!important;background:#fffdf8!important;box-shadow:0 2px 8px #173c3220}@media(max-width:980px){.map-export-control{left:12px;top:92px}}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.calendar-grid{grid-template-rows:52px auto!important}.calendar-head{height:52px!important;box-sizing:border-box!important;overflow:hidden!important}.calendar-head b{display:block!important;line-height:1.1!important}.calendar-head small{display:block!important;line-height:1.15!important;margin-top:3px!important}.schedule-panel>.aside-head{display:flex!important;align-items:center!important;gap:8px!important;min-width:0!important}.schedule-panel>.aside-head>div:first-child{flex:0 0 auto!important;min-width:max-content!important}.schedule-panel>.aside-head h2{white-space:nowrap!important;line-height:1!important;margin:0!important}.schedule-panel>.aside-head>div:last-child{display:flex!important;flex:1 1 auto!important;min-width:0!important;align-items:center!important;justify-content:flex-end!important;flex-wrap:nowrap!important;gap:5px!important;overflow-x:auto!important;scrollbar-width:none!important}.schedule-panel>.aside-head>div:last-child::-webkit-scrollbar{display:none}.schedule-panel>.aside-head button,.schedule-panel>.aside-head select{flex:0 0 auto!important;white-space:nowrap!important}@media(min-width:981px){.schedule-panel>.aside-head{min-height:42px!important}.schedule-panel>.aside-head h2{font-size:15px!important}.schedule-panel>.aside-head button,.schedule-panel>.aside-head select{padding:5px 6px!important;font-size:9px!important}.schedule-panel>.aside-head #scheduleHint{font-size:9px!important;white-space:nowrap!important}.schedule-panel.is-expanded .calendar-grid{grid-template-rows:52px auto!important}.schedule-panel.is-expanded .calendar-head{height:52px!important;padding:6px 7px!important}.schedule-panel.is-expanded .calendar-head b{font-size:11px!important}.schedule-panel.is-expanded .calendar-head small{font-size:9px!important}}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.route-summary-detail{margin-top:6px;padding:10px 12px;border-radius:9px;background:#143f33;color:#f7f4ee;line-height:1.4;font-size:11px;box-shadow:0 8px 22px #173c3238}.route-summary-detail[hidden]{display:none!important}.route-summary-detail> b{display:block;margin-bottom:7px;color:#fff;font-size:12px}.route-summary-days{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 14px}.route-summary-day{min-width:0;padding:5px 7px;border-left:2px solid #83c7a2;background:#ffffff0d;border-radius:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.route-summary-day b{color:#d9f0e1}.route-summary-detail small{display:block;margin-top:8px;color:#cce6d6}.route-summary-btn{padding:5px 9px!important;border-color:#9dc4ae!important;color:#f7f4ee!important;background:#174f3d!important;font-size:10px!important;white-space:nowrap}.route-detail{min-height:118px!important;max-height:176px!important;margin:8px 14px 12px!important;padding:10px 12px!important;overflow:auto!important;background:#eff6f0!important}.route-detail span{color:#4b6758;font-size:.92em}.route-detail b{display:inline-block;margin-bottom:2px}.map-panel{overflow:hidden}.map{overflow:hidden}.map .map-route-legend{position:absolute!important}@media(min-width:981px){main{grid-template-rows:56px minmax(0,1fr)!important}.schedule-panel,.content,.locations-panel{grid-row:2!important}main>header{height:56px!important;display:grid!important;grid-template-columns:72px minmax(300px,1fr) auto!important;gap:12px!important;align-items:center!important}.hero{position:relative!important;display:grid!important;grid-template-columns:minmax(180px,1fr) auto!important;align-items:center!important;gap:12px!important;margin:0!important;padding:7px 14px!important;min-height:0!important;height:56px!important;background:#e7f2eb!important;background-image:none!important;border:1px solid #cfe0d5!important;color:#173c32!important}.hero #tripName{width:100%!important;max-width:380px!important;color:#173c32!important;border-bottom-color:#79a48a!important}.hero p{display:none!important}.route-stat{display:flex!important;align-items:center!important;gap:8px!important;text-align:right!important;color:#214d3d!important}.route-stat span{color:#547467!important;font-weight:600}.route-stat strong{color:#123e30!important;font-size:22px!important}.route-stat small{color:#345e4c!important;max-width:360px!important}.hero .route-summary-detail{position:absolute;top:calc(100% + 8px);right:0;left:auto;z-index:1300;width:min(720px,calc(100vw - 28px));max-height:240px;overflow:auto}.content>.map-panel{grid-template-rows:minmax(0,1fr) auto auto!important}.content>.map-panel .route-detail{min-height:132px!important;max-height:184px!important;margin:8px 12px 12px!important}.map-route-legend{bottom:10px!important;left:10px!important;max-height:calc(100% - 20px);overflow:auto}.top-actions{min-width:0!important}.top-actions .hint{color:#537366!important}header h1{color:#173c32!important}}@media(max-width:980px){.route-summary-detail{margin:8px 0}.route-summary-days{grid-template-columns:1fr}.hero{color:#173c32!important;background:#e7f2eb!important;background-image:none!important}.hero #tripName{color:#173c32!important;border-bottom-color:#79a48a!important}.route-stat span,.route-stat small{color:#3d6755!important}.route-stat strong{color:#173c32!important}.route-detail{min-height:110px!important}}' }));

document.head.append(Object.assign(document.createElement('style'), { textContent: '.sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}.app-header .brand-lockup{display:flex;align-items:center;gap:8px;min-width:0}.brand-mark{display:grid;place-items:center;width:25px;height:25px;border-radius:8px;color:#1d5b46;background:#e7f2eb;border:1px solid #cfe0d5}.brand-mark svg{width:15px;height:15px}.app-header .top-actions,.app-header .plan-controls,.app-header .plan-actions,.app-header .header-utilities{display:flex;align-items:center}.app-header .top-actions{gap:10px;min-width:0}.app-header .plan-controls{gap:7px;padding:4px 5px 4px 8px;border:1px solid #d8e4dc;background:#f8fbf8;border-radius:10px}.app-header .plan-controls select{height:29px;min-width:126px;padding:4px 26px 4px 8px;border:0;border-right:1px solid #d8e4dc;border-radius:0;background:transparent;color:#173c32;font-weight:650;outline:0}.app-header .plan-actions{gap:3px}.app-header .header-utilities{gap:6px}.app-header .icon-button{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-height:29px;padding:5px 8px!important;border-radius:7px;font-size:11px!important;white-space:nowrap}.app-header .icon-button>span{font-size:14px;line-height:1;font-weight:600}.app-header .plan-actions .icon-button{border-color:transparent;background:transparent}.app-header .plan-actions .icon-button:hover{background:#e5f0e9;border-color:#c7ddce}.app-header .plan-actions .danger{color:#9a5346}.app-header .plan-actions .danger:hover{background:#f8ebe7;border-color:#e8c4bd}.app-header .save-status{max-width:148px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px!important;color:#527263!important}.header-divider{width:1px;height:19px;background:#d7e1da}.app-header #placeLibraryBtn{background:#f8fbf8}.app-header #exportBtn{color:#f7f4ee;border-color:#1d5b46;background:#1d5b46}.app-header #exportBtn:hover{background:#174a39}@media(min-width:981px){main>header.app-header{grid-template-columns:76px minmax(250px,1fr) auto!important;gap:12px!important}.app-header .brand-lockup{gap:6px}.app-header h1{font-size:24px!important}.app-header .eyebrow{display:none}.app-header .top-actions{justify-self:end}.app-header .plan-controls select{min-width:118px;max-width:160px}.app-header .header-utilities{gap:5px}.app-header .save-status{max-width:118px}}@media(max-width:1180px){.app-header .save-status,.app-header .header-divider{display:none!important}.app-header .icon-button{padding:5px 7px!important}.app-header .plan-controls select{min-width:108px}}@media(max-width:980px){.app-header{gap:12px!important;align-items:flex-start!important}.app-header .brand-mark{display:none}.app-header .top-actions{display:grid;justify-items:end;gap:8px}.app-header .plan-controls,.app-header .header-utilities{flex-wrap:wrap;justify-content:flex-end}.app-header .plan-controls select{min-width:150px}.app-header .save-status{display:none}.app-header .icon-button{font-size:12px!important;padding:7px 9px!important}}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.place-photo-preview{width:100%;height:120px;display:block;object-fit:cover;border-radius:7px;background:#edf1ed}.place-photo-action{display:inline-flex!important;justify-self:start;padding:4px 7px;border:1px solid #9dbaaa;border-radius:5px;color:#1d5b46;font:12px inherit;cursor:pointer}.place-photo-action input{display:none}.place-photo-placeholder{height:54px;display:grid;place-items:center;border:1px dashed #cdd9d0;border-radius:7px;color:#849188;font-size:11px}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.place-card .place-save{background:#1d5b46!important;color:#fff!important;border-color:#1d5b46!important}.place-card.dirty{border-color:#d49b45;background:#fffaf0}.place-card.dirty .place-save::after{content:" · 未保存";font-size:.85em}.place-card .place-name:focus{border-bottom-color:#1d5b46;box-shadow:0 1px 0 #1d5b46}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.flight-airport-marker{filter:drop-shadow(0 0 4px #f4d56a)}.flight-arrow-marker{background:transparent!important;border:0!important}.flight-arrow-marker span{display:block;width:16px;height:16px;color:#d4a72c;font-size:13px;line-height:16px;text-align:center;text-shadow:0 0 4px #fff,0 0 7px #f4d56a;transform:rotate(var(--flight-arrow-angle));transform-origin:center;font-weight:900}' }));
document.head.append(Object.assign(document.createElement('style'), { textContent: '.selected-map-route{filter:drop-shadow(0 0 2px #fff) drop-shadow(0 2px 4px #173c3270)}.selected-map-point{filter:drop-shadow(0 0 3px #fff) drop-shadow(0 2px 5px #173c3290)}' }));
const presetNodeTimes = {
  '2026-08-15|伊宁机场':['20:00','20:40'],'2026-08-15|伊宁市区住宿':['21:20','23:00'],'2026-08-16|赛里木湖东门':['11:15','20:40'],'2026-08-16|赛里木湖附近住宿':['20:40','23:00'],
  '2026-08-17|果子沟':['09:20','10:00'],'2026-08-17|六星街':['12:45','14:30'],'2026-08-17|那拉提镇住宿':['18:30','21:30'],'2026-08-18|那拉提空中草原':['08:30','12:30'],'2026-08-18|巴音布鲁克镇住宿':['15:30','22:00'],
  '2026-08-19|大龙池':['09:30','09:50'],'2026-08-19|天山神秘大峡谷':['12:30','14:30'],'2026-08-19|拜城县住宿':['17:30','22:00'],'2026-08-20|温宿大峡谷':['10:30','14:00'],
  '2026-08-20|阿克苏市住宿':['16:30','22:00'],'2026-08-20|巴楚县住宿':['19:30','22:00'],'2026-08-21|喀什古城附近住宿':['14:30','23:00'],'2026-08-21|白沙湖':['12:30','13:40'],'2026-08-21|喀拉库勒湖':['14:50','17:15'],
  '2026-08-22|喀什机场':['11:20','11:45'],'2026-08-22|白沙湖':['14:00','15:10'],'2026-08-22|喀拉库勒湖':['16:00','18:00'],'2026-08-22|阿图什天门':['13:15','16:30'],'2026-08-22|巴楚县住宿':['20:00','22:00'],'2026-08-23|阿克苏机场':['14:30','17:00']
};
const amapKeywords = { '伊宁机场': '伊犁伊宁国际机场', '赛里木湖东门': '赛里木湖东门游客服务中心', '喀什机场': '喀什徕宁国际机场', '阿克苏机场': '阿克苏红旗坡机场' };
const api = createApi();
const pendingAddressMigrationKey = 'roadtrip-pending-addresses-v1';
const universalLocationStorageKey = 'roadtrip-location-library';
const universalRouteStorageKey = 'roadtrip-route-library';
const versionStorageKey = key => `roadtrip-version-${key}`;
const sharedScheduleStorageKey = 'roadtrip-shared-schedule-through-0819';

const normalizePlaceLookup = value => String(value || '').replace(/[\s()（）·,，。\-—_/]/g, '').toLowerCase();
function suggestedPlaceName(address, resolvedName, fallback = '未命名地点') {
  const value = String(address || '').trim();
  const looksLikePoiName = value && value.length <= 32 && !/[省自治区自治州地区市县区镇乡村路街道巷弄号]/.test(value);
  return (looksLikePoiName ? value : (resolvedName || fallback)).replace(/[()（）]/g, '');
}
function findMatchingLocation(locations, address, name = '', resolvedLocation = '') {
  const addressKey = normalizePlaceLookup(address), nameKey = normalizePlaceLookup(name);
  return (locations || []).find(place => {
    if (resolvedLocation && place.resolved?.location === resolvedLocation) return true;
    const keys = [place.address, place.resolved?.address].map(normalizePlaceLookup).filter(Boolean);
    if (addressKey && keys.includes(addressKey)) return true;
    return nameKey && normalizePlaceLookup(place.name) === nameKey && (!addressKey || keys.includes(addressKey));
  });
}
function repairEventNamedLocations(data) {
  const locations = data.locations || [], schedule = data.schedule || [];
  schedule.forEach(event => {
    const place = locations.find(item => item.id === event.locationId);
    if (!place || normalizePlaceLookup(place.name) !== normalizePlaceLookup(event.title) || !place.address) return;
    place.name = suggestedPlaceName(place.address, place.resolved?.name, place.name);
  });
  return data;
}

function migrateFlightStopovers(data) {
  (data.schedule || []).forEach(event => {
    if (event.type !== 'flight' || !event.flightInfo || event.flightInfo.stopoverAirport) return;
    const match = String(event.detail || '').match(/经停\s*([^，,；;]+?机场)[，,；;\s]+(\d{1,2}:\d{2})\s*[–—~-]\s*(\d{1,2}:\d{2})/);
    if (!match) return;
    event.flightInfo.stopoverAirport = match[1].trim();
    event.flightInfo.stopoverArrivalTime = match[2];
    event.flightInfo.stopoverDepartureTime = match[3];
  });
  return data;
}

function clearInitialPendingAddresses(data) {
  if (localStorage.getItem(pendingAddressMigrationKey)) return data;
  const clearIfUnconfirmed = entry => ['hotel', 'food'].includes(entry.type) ? { ...entry, address: '' } : entry;
  localStorage.setItem(pendingAddressMigrationKey, 'true');
  return { ...data, items: (data.items || []).map(clearIfUnconfirmed), schedule: (data.schedule || []).map(clearIfUnconfirmed) };
}

function outOfChina(lng, lat) { return lng < 72.004 || lng > 137.8347 || lat < .8293 || lat > 55.8271; }
const useAmapBaseMap = true;
function gcjToWgs(lng, lat) {
  if (outOfChina(lng, lat)) return [lng, lat];
  const transformLat = (x, y) => -100 + 2*x + 3*y + .2*y*y + .1*x*y + .2*Math.sqrt(Math.abs(x)) + (20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3 + (20*Math.sin(y*Math.PI)+40*Math.sin(y/3*Math.PI))*2/3 + (160*Math.sin(y/12*Math.PI)+320*Math.sin(y*Math.PI/30))*2/3;
  const transformLng = (x, y) => 300 + x + 2*y + .1*x*x + .1*x*y + .1*Math.sqrt(Math.abs(x)) + (20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3 + (20*Math.sin(x*Math.PI)+40*Math.sin(x/3*Math.PI))*2/3 + (150*Math.sin(x/12*Math.PI)+300*Math.sin(x/30*Math.PI))*2/3;
  const a = 6378245, ee = .00669342162296594323, dLat = transformLat(lng - 105, lat - 35), dLng = transformLng(lng - 105, lat - 35), rad = lat / 180 * Math.PI, magic = 1 - ee * Math.sin(rad) ** 2, sqrtMagic = Math.sqrt(magic);
  const mgLat = lat + dLat * 180 / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI), mgLng = lng + dLng * 180 / (a / sqrtMagic * Math.cos(rad) * Math.PI);
  return [lng * 2 - mgLng, lat * 2 - mgLat];
}
// 高德接口与高德底图均使用 GCJ-02；地图绘制不再转换为 WGS-84，避免点线与道路产生偏移。
function mapCoords(lng, lat) { return useAmapBaseMap ? [lng, lat] : gcjToWgs(lng, lat); }

async function ensureLeafletLibrary() {
  if (window.L) return true;
  const existing = document.querySelector('script[data-leaflet-fallback]');
  if (existing) return new Promise(resolve => existing.addEventListener('load', () => resolve(Boolean(window.L)), { once: true }));
  return new Promise(resolve => {
    const script = document.createElement('script');
    script.dataset.leafletFallback = 'true';
    script.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => resolve(Boolean(window.L));
    script.onerror = () => resolve(false);
    document.head.append(script);
  });
}
async function initMap() {
  if (!(await ensureLeafletLibrary())) {
    $('#routeError').textContent = '地图组件加载失败，请检查网络后刷新页面。';
    return false;
  }
  map = L.map('map', { zoomControl: false }).setView([30.25, 120.16], 7);
  map.createPane('flightPane');
  map.getPane('flightPane').style.zIndex = 350;
  L.control.zoom({ position: 'topright' }).addTo(map);
  map.attributionControl.setPrefix('');
  const amapRoad = L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', { subdomains: ['1', '2', '3', '4'], maxZoom: 19, crossOrigin: 'anonymous', attribution: '&copy; 高德地图' });
  const amapSatellite = L.tileLayer('https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}', { subdomains: ['1', '2', '3', '4'], maxZoom: 19, opacity: .5, crossOrigin: 'anonymous', attribution: '&copy; 高德地图' });
  const amapSatelliteLabels = L.tileLayer('https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}', { subdomains: ['1', '2', '3', '4'], maxZoom: 19, crossOrigin: 'anonymous' });
  const amapTerrainRoads = L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', { subdomains: ['1', '2', '3', '4'], maxZoom: 19, opacity: .68, crossOrigin: 'anonymous' });
  const amapTerrain = L.layerGroup([amapSatellite, amapSatelliteLabels, amapTerrainRoads]);
  amapTerrain.addTo(map);
  L.control.layers({ '高德道路': amapRoad, '高德卫星影像（地形 + 道路）': amapTerrain }, null, { position: 'topright', collapsed: false }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  dayOverviewLayer = L.layerGroup().addTo(map);
  map.on('click', event => {
    const target = event.originalEvent?.target;
    if (target?.closest?.('.leaflet-interactive,.leaflet-marker-icon,.leaflet-popup,.leaflet-control')) return;
    clearMapSelection();
  });
  // 低缩放时用更细的线保留相近道路的真实差异，不改变路线几何。
  map.on('zoomend', refreshOverviewRouteWeights);
  document.querySelector('#map').classList.add('map-ready');
  document.head.append(Object.assign(document.createElement('style'), { textContent: '#map.map-ready:before,#map.map-ready:after{display:none}' }));
  $('.map-empty')?.remove();
  return true;
}

function fitSelectionWithDayContext(selectionBounds, maxZoom = 12) {
  if (!map || !selectionBounds?.isValid?.()) return;
  const combined = L.latLngBounds([]);
  if (dayOverviewBounds?.isValid?.()) {
    combined.extend(dayOverviewBounds.getSouthWest());
    combined.extend(dayOverviewBounds.getNorthEast());
  }
  combined.extend(selectionBounds.getSouthWest());
  combined.extend(selectionBounds.getNorthEast());
  // 保留分日总览作为缩放参考，但选中目标始终居中，避免高亮落在可视范围边缘。
  const contextZoom = combined.isValid() ? map.getBoundsZoom(combined, false, L.point(42, 42)) : map.getZoom();
  const selectionSize = selectionBounds.getNorthEast().distanceTo(selectionBounds.getSouthWest());
  const selectionZoom = selectionSize > 25 ? map.getBoundsZoom(selectionBounds, false, L.point(58, 58)) : maxZoom;
  const zoom = Math.min(maxZoom, Math.max(contextZoom, Math.min(selectionZoom, contextZoom + 3)));
  map.flyTo(selectionBounds.getCenter(), zoom, { animate: true, duration: .45 });
}

function setOverviewFocusOpacity(active) {
  const updateLayer = layer => {
    if (layer.eachLayer) { layer.eachLayer(updateLayer); return; }
    if (!layer.setStyle) return;
    layer._overviewBaseStyle ||= {
      opacity: Number.isFinite(layer.options.opacity) ? layer.options.opacity : 1,
      fillOpacity: Number.isFinite(layer.options.fillOpacity) ? layer.options.fillOpacity : 1
    };
    const base = layer._overviewBaseStyle;
    layer.setStyle(active
      ? { opacity: Math.max(.1, base.opacity * .32), fillOpacity: Math.max(.14, base.fillOpacity * .38) }
      : { opacity: base.opacity, fillOpacity: base.fillOpacity });
  };
  dayOverviewLayer?.eachLayer(updateLayer);
  markerLayer?.eachLayer(updateLayer);
  $('#map')?.classList.toggle('has-map-selection', active);
}

async function clearMapSelection() {
  state.selectedIndex = null;
  document.querySelectorAll('.calendar-block.selected,.item.selected').forEach(node => node.classList.remove('selected'));
  if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
  setOverviewFocusOpacity(false);
  const date = state.dayFilter || mapFocusDate;
  await showDayOverview(date);
  $('#mapDayFilter').value = date || '';
}

function showRouteOnMap(path, locations, nodes, routeInfo = {}) {
  if (!map) return;
  const coordinates = path.steps.flatMap(step => step.polyline.split(';').map(pair => mapCoords(...pair.split(',').map(Number))));
  const latLngs = coordinates.map(([lng, lat]) => [lat, lng]);
  if (routeLayer) map.removeLayer(routeLayer);
  routeLayer = L.featureGroup().addTo(map);
  L.polyline(latLngs, { color: '#fff', weight: 10, opacity: .9, interactive: false }).addTo(routeLayer);
  const selectedLine = L.polyline(latLngs, { color: markerColors.drive, weight: 7, opacity: 1, className: 'selected-map-route' }).addTo(routeLayer);
  const routeName = routeInfo.name || nodes.map(node => node.name || node.title).filter(Boolean).join(' → ') || '当前路线';
  const routeDistance = Number(path.distance || 0), routeDuration = Number(path.duration || 0), routeTolls = Number(path.tolls || 0);
  const queryRecord = routeInfo.amap;
  const queryLine = queryRecord?.queriedAt ? `<br><small>高德查询：${new Date(queryRecord.queriedAt).toLocaleString('zh-CN')}${queryRecord.queryPeriod === 'night' ? ' · 夜间结果，待白天重查' : ''}</small>` : '';
  const routePopupHtml = `<b>${escapeHtml(routeName)}</b><br>${routeDistance ? `${(routeDistance / 1000).toFixed(1)} 公里 · ` : ''}${routeDuration ? fmt(routeDuration) : ''}${Number.isFinite(routeTolls) ? `<br>过路费约 ${routeTolls.toFixed(0)} 元` : ''}${queryLine}<br><small>${nodes.map(node => escapeHtml(node.name || node.title || '')).filter(Boolean).join(' → ')}</small>`;
  selectedLine.on('click', event => {
    const popupContent = document.createElement('div');
    popupContent.innerHTML = routePopupHtml;
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button'; deleteButton.className = 'route-map-delete';
    deleteButton.style.cssText = 'display:block;margin-top:10px;background:#fff4f1;color:#a44435;border:1px solid #dfa99f;padding:6px 9px;font-size:12px';
    deleteButton.textContent = routeInfo.routeId ? '删除这条路线' : '从地图移除路线';
    deleteButton.onclick = () => {
      if (routeInfo.routeId && !confirm(`确定删除通用路线“${routeName}”吗？关联此路线的时刻表事件会保留，但会解除路线关联。`)) return;
      if (routeInfo.routeId) removeRoute(routeInfo.routeId);
      if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
      map.closePopup();
    };
    popupContent.append(deleteButton);
    L.popup().setLatLng(event.latlng).setContent(popupContent).openOn(map);
  });
  // 高亮线单独绘制方向箭头，避免总览箭头被淡化后看不出当前路线的行驶方向。
  [.33, .67].forEach(fraction => {
    const pose = routeArrowPose(latLngs, fraction); if (!pose) return;
    L.marker(pose.latLng, {
      icon: L.divIcon({ className: 'route-direction-arrow-wrap selected-route-arrow', iconSize: [18, 18], iconAnchor: [9, 9], html: `<span class="route-direction-arrow is-highlighted" style="--bearing:${pose.bearing}deg">➤</span>` }),
      interactive: false,
      keyboard: false,
      zIndexOffset: 1500
    }).addTo(routeLayer);
  });
  locations.forEach(point => { const [lng, lat] = mapCoords(...point.split(',').map(Number)); L.circleMarker([lat, lng], { radius: 8, color: '#fff', weight: 2.5, fillColor: markerColors.drive, fillOpacity: 1, interactive: false, className: 'selected-map-point' }).addTo(routeLayer); });
  setOverviewFocusOpacity(true);
  fitSelectionWithDayContext(routeLayer.getBounds(), 13);
}

function flightCurveLatLngs(originLocation, destinationLocation) {
  const [originLng, originLat] = mapCoords(...originLocation.split(',').map(Number));
  const [destinationLng, destinationLat] = mapCoords(...destinationLocation.split(',').map(Number));
  const longitudeDelta = destinationLng - originLng, latitudeDelta = destinationLat - originLat;
  const midpoint = { lng: (originLng + destinationLng) / 2, lat: (originLat + destinationLat) / 2 };
  const segmentLength = Math.hypot(longitudeDelta, latitudeDelta) || 1;
  const bend = Math.min(3.5, Math.max(.75, segmentLength * .085));
  const normal = { lng: -latitudeDelta / segmentLength, lat: longitudeDelta / segmentLength };
  const candidates = [1, -1].map(direction => ({ lng: midpoint.lng + normal.lng * bend * direction, lat: midpoint.lat + normal.lat * bend * direction }));
  let control;
  if (Math.abs(longitudeDelta) >= Math.abs(latitudeDelta)) {
    control = longitudeDelta < 0
      ? candidates.sort((a, b) => b.lat - a.lat)[0]
      : candidates.sort((a, b) => a.lat - b.lat)[0];
  } else if (latitudeDelta < 0) {
    control = candidates.sort((a, b) => a.lng - b.lng)[0];
  } else {
    control = candidates.sort((a, b) => b.lng - a.lng)[0];
  }
  return Array.from({ length: 49 }, (_, index) => {
    const progress = index / 48, inverse = 1 - progress;
    const lng = inverse ** 2 * originLng + 2 * inverse * progress * control.lng + progress ** 2 * destinationLng;
    const lat = inverse ** 2 * originLat + 2 * inverse * progress * control.lat + progress ** 2 * destinationLat;
    return [lat, lng];
  });
}

function drawFlightCurve(layer, entry, originPlace, destinationPlace, scheduleIndex) {
  if (!originPlace?.resolved?.location || !destinationPlace?.resolved?.location) return null;
  const latLngs = flightCurveLatLngs(originPlace.resolved.location, destinationPlace.resolved.location);
  const segmentLayer = L.featureGroup().addTo(layer);
  L.polyline(latLngs, { pane: 'flightPane', color: '#f4d56a', weight: 7, opacity: .1, lineCap: 'round', interactive: false }).addTo(segmentLayer);
  const line = L.polyline(latLngs, { pane: 'flightPane', color: markerColors.flight, weight: 2.2, opacity: .48, lineCap: 'round' }).addTo(segmentLayer);
  const addArrow = progress => {
    const index = Math.max(1, Math.min(latLngs.length - 2, Math.round((latLngs.length - 1) * progress)));
    const before = latLngs[index - 1], after = latLngs[index + 1];
    const angle = Math.atan2(-(after[0] - before[0]), after[1] - before[1]) * 180 / Math.PI;
    const icon = L.divIcon({ className: 'flight-arrow-marker', html: `<span style="--flight-arrow-angle:${angle.toFixed(1)}deg">➤</span>`, iconSize: [16, 16], iconAnchor: [8, 8] });
    L.marker(latLngs[index], { pane: 'flightPane', icon, interactive: false, keyboard: false }).addTo(segmentLayer);
  };
  addArrow(.42); addArrow(.72);
  const flight = entry.flightInfo || {};
  const isFirstLeg = destinationPlace.id === flight.stopoverPlaceId;
  const isSecondLeg = originPlace.id === flight.stopoverPlaceId;
  const segmentStart = isSecondLeg ? flight.stopoverDepartureTime : entry.start;
  const segmentEnd = isFirstLeg ? flight.stopoverArrivalTime : entry.end;
  const segmentArrivalDate = isFirstLeg ? entry.date : (flight.arrivalDate || entry.date);
  line.bindPopup(`<b>${escapeHtml(flight.flightNumber || entry.title || '航班')}</b><br>${escapeHtml(originPlace.name)} → ${escapeHtml(destinationPlace.name)}<br>${escapeHtml(entry.date)} ${escapeHtml(segmentStart)} → ${escapeHtml(segmentArrivalDate)} ${escapeHtml(segmentEnd)}${isFirstLeg ? `<br>经停约 ${escapeHtml(flight.stopoverArrivalTime || '--:--')}–${escapeHtml(flight.stopoverDepartureTime || '--:--')}` : ''}`);
  if (Number.isInteger(scheduleIndex)) line.on('click', () => focusScheduleEvent(scheduleIndex));
  return { line, layer: segmentLayer, latLngs };
}

function flightPlaces(entry) {
  const flight = entry.flightInfo || {};
  return [flight.departurePlaceId, flight.stopoverPlaceId, flight.arrivalPlaceId]
    .filter(Boolean)
    .map(id => state.locations.find(place => place.id === id))
    .filter(Boolean);
}

function drawFlightItinerary(layer, entry, scheduleIndex) {
  const places = flightPlaces(entry), lines = [], latLngs = [];
  for (let index = 1; index < places.length; index += 1) {
    const drawn = drawFlightCurve(layer, entry, places[index - 1], places[index], scheduleIndex);
    if (drawn) { lines.push(drawn.line); latLngs.push(...drawn.latLngs); }
  }
  return { lines, latLngs, places };
}

async function ensureAirportPlace(name) {
  if (!name) return null;
  const normalized = value => String(value || '').replace(/国际|机场|红旗坡|伊犁|[\s·()（）]/g, '');
  let place = state.locations.find(item => item.name === name || item.resolved?.name === name);
  if (!place) place = state.locations.find(item => /机场/.test(`${item.name || ''}${item.resolved?.name || ''}`) && normalized(`${item.name}${item.resolved?.name}`)?.includes(normalized(name)));
  if (!place) { place = { id: crypto.randomUUID(), type: 'flight', name, address: name, note: '航班机场（自动关联）' }; state.locations.push(place); }
  if (/航班机场（自动关联）/.test(place.note || '') && place.type !== 'flight') { place.type = 'flight'; place._airportTypeChanged = true; }
  if (!place.resolved?.location) {
    const point = await geocode(place.address || name, name);
    place.resolved = { name: point.name || name, address: point.formatted_address || place.address || name, location: point.location };
    place.address ||= `${point.formatted_address || ''}${point.name || name}`;
  }
  return place;
}

async function linkFlightAirports(entry) {
  if (entry?.type !== 'flight' || !entry.flightInfo) return false;
  const [originPlace, stopoverPlace, destinationPlace] = await Promise.all([
    ensureAirportPlace(entry.flightInfo.departureAirport),
    entry.flightInfo.stopoverAirport ? ensureAirportPlace(entry.flightInfo.stopoverAirport) : null,
    ensureAirportPlace(entry.flightInfo.arrivalAirport)
  ]);
  if (!originPlace || !destinationPlace) return false;
  const typeChanged = [originPlace, stopoverPlace, destinationPlace].filter(Boolean).some(place => place._airportTypeChanged);
  [originPlace, stopoverPlace, destinationPlace].filter(Boolean).forEach(place => { delete place._airportTypeChanged; });
  const changed = typeChanged || entry.flightInfo.departurePlaceId !== originPlace.id || entry.flightInfo.stopoverPlaceId !== stopoverPlace?.id || entry.flightInfo.arrivalPlaceId !== destinationPlace.id;
  entry.flightInfo.departurePlaceId = originPlace.id; entry.flightInfo.arrivalPlaceId = destinationPlace.id;
  if (stopoverPlace) entry.flightInfo.stopoverPlaceId = stopoverPlace.id;
  else delete entry.flightInfo.stopoverPlaceId;
  return changed;
}

let flightAirportLinking;
async function ensureFlightAirportLinks() {
  if (isShareMode) return;
  if (flightAirportLinking) return flightAirportLinking;
  flightAirportLinking = (async () => {
    let changed = false;
    for (const entry of state.schedule.filter(item => item.type === 'flight')) {
      try { changed = await linkFlightAirports(entry) || changed; }
      catch { /* 单个机场查询失败时保留航班，之后可再次自动补齐。 */ }
    }
    if (changed) { renderLocations(); renderSchedule(state.schedule); save(); }
  })().finally(() => { flightAirportLinking = null; });
  return flightAirportLinking;
}

async function showFlightOnMap(index) {
  const entry = state.schedule[index]; if (!entry?.flightInfo || !map) return;
  try {
    if (!isShareMode) await linkFlightAirports(entry);
    const places = flightPlaces(entry);
    if (places.length < 2 || places.some(place => !place.resolved?.location)) throw new Error('机场位置尚未查询完成');
    if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
    routeLayer = L.featureGroup().addTo(map);
    const drawn = drawFlightItinerary(routeLayer, entry, index);
    drawn.lines.forEach(line => line.setStyle({ weight: 4.5, opacity: .7 }));
    places.forEach((place, placeIndex) => { const [lng, lat] = mapCoords(...place.resolved.location.split(',').map(Number)); const role = placeIndex === 0 ? '出发机场' : placeIndex === places.length - 1 ? '到达机场' : `经停机场 · ${entry.flightInfo.stopoverArrivalTime || '--:--'}–${entry.flightInfo.stopoverDepartureTime || '--:--'}`; L.circleMarker([lat, lng], { pane: 'flightPane', radius: 8, color: '#fff', weight: 3, fillColor: markerColors.flight, fillOpacity: .9, className: 'flight-airport-marker selected-map-point' }).bindPopup(`<b>${escapeHtml(place.name)}</b><br>${escapeHtml(role)}<br>${escapeHtml(place.resolved.address || place.address)}`).addTo(routeLayer); });
    setOverviewFocusOpacity(true);
    fitSelectionWithDayContext(L.latLngBounds(drawn.latLngs), 8);
    const flight = entry.flightInfo;
    const itinerary = places.map((place, placeIndex) => placeIndex === 1 && places.length === 3 ? `${place.name}（经停 ${flight.stopoverArrivalTime || '--:--'}–${flight.stopoverDepartureTime || '--:--'}）` : place.name).join(' → ');
    $('#routeDetail').innerHTML = `<b>${escapeHtml(flight.flightNumber || entry.title)}</b><br>${escapeHtml(itinerary)}<br>${escapeHtml(entry.date)} ${escapeHtml(entry.start)} → ${escapeHtml(flight.arrivalDate || entry.date)} ${escapeHtml(entry.end)}${entry.detail ? `<small>${escapeHtml(entry.detail)}</small>` : ''}<small>浅黄色半透明线为分段航班 OD 示意曲线，不代表实际飞行航迹。</small>`;
    save(); renderLocations();
  } catch (error) { $('#routeDetail').textContent = error.message || '暂时无法显示航班机场位置。'; }
}

function removeRoute(routeId) {
  state.routes = state.routes.filter(route => route.id !== routeId);
  const unlink = schedule => (schedule || []).forEach(event => { if (event.routeLinks?.routeId === routeId) delete event.routeLinks.routeId; });
  unlink(state.schedule);
  state.plans.forEach(plan => {
    const key = plan.id;
    const snapshot = parseStoredJson(versionStorageKey(key), null);
    if (!snapshot) return;
    snapshot.routes = (snapshot.routes || []).filter(route => route.id !== routeId);
    unlink(snapshot.schedule);
    localStorage.setItem(versionStorageKey(key), JSON.stringify(snapshot));
  });
  if (!state.plans.length) {
    const shared = readSharedSchedule();
    unlink(Object.values(shared));
    localStorage.setItem(sharedScheduleStorageKey, JSON.stringify(shared));
  }
  renderSchedule(state.schedule); refreshEventCards(); save();
  showDayOverview(state.dayFilter);
}

function addItem(data = {}) {
  const node = template.content.firstElementChild.cloneNode(true);
  node.dataset.id = crypto.randomUUID();
  if (Number.isInteger(data.scheduleIndex)) node.dataset.scheduleIndex = String(data.scheduleIndex);
  $('.type', node).value = data.type || 'spot'; $('.date', node).value = data.date || '';
  $('.start-time', node).value = data.startTime || ''; $('.end-time', node).value = data.endTime || '';
  $('.name', node).value = data.name || ''; $('.address', node).value = data.address || ''; $('.note', node).value = data.note || '';
  if (data.photo) { const p=$('.preview',node);p.src=data.photo;p.hidden=false; }
  $('.delete', node).onclick = () => { node.remove(); save(); renderManualSchedule(); };
  $('.photo', node).onchange = e => { const f=e.target.files[0]; if(!f)return; const r=new FileReader(); r.onload=()=>{const p=$('.preview',node);p.src=r.result;p.hidden=false;save()}; r.readAsDataURL(f); };
  const locate = document.createElement('button'); locate.type = 'button'; locate.className = 'map-focus'; locate.textContent = '在地图中查看';
  locate.onclick = event => { event.stopPropagation(); const index = Number(node.dataset.scheduleIndex); if (Number.isInteger(index)) focusScheduleEvent(index); else focusNode(node); };
  $('.item-main', node).append(locate);
  if (Number.isInteger(data.scheduleIndex)) {
    const event = state.schedule[data.scheduleIndex];
    const place = state.locations.find(item => item.id === event?.locationId);
    const placeName = document.createElement('input'); placeName.className = 'place-query-name'; placeName.placeholder = '地点名称，如：伊宁机场'; placeName.value = place?.name || '';
    $('.item-main', node).insertBefore(placeName, $('.address', node));
    if (place?.address) $('.address', node).value = place.address;
    const createPlace = document.createElement('button'); createPlace.type = 'button'; createPlace.className = 'place-create'; createPlace.textContent = place ? '更新关联地点并查询' : '创建地点并查询';
    createPlace.hidden = event?.type === 'drive' || event?.type === 'flight'; createPlace.onclick = async clickEvent => { clickEvent.stopPropagation(); await createOrUpdatePlaceForNode(node); };
    $('.item-main', node).insertBefore(createPlace, locate);
    const routeInline = document.createElement('section'); routeInline.className = 'route-inline'; routeInline.hidden = event?.type !== 'drive';
    routeInline.innerHTML = '<b>路程起终点</b><div class="route-inline-grid"><input class="inline-origin-name" placeholder="起点名称"><input class="inline-origin-address" placeholder="起点地址"><input class="inline-destination-name" placeholder="终点名称"><input class="inline-destination-address" placeholder="终点地址"></div><textarea class="inline-waypoints" placeholder="途经点（可选），每行：名称｜地址"></textarea><button type="button" class="inline-route-create">查询地点并生成路线</button>';
    $('.item-main', node).insertBefore(routeInline, locate); fillInlineRouteControls(node, data.scheduleIndex);
    $('.inline-route-create', node).onclick = async clickEvent => { clickEvent.stopPropagation(); await createRouteFromNode(node); };
    refreshNodePlaceLink(node, data.scheduleIndex);
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'event-edit'; edit.textContent = '编辑事件 / 关联地点';
    edit.onclick = event => { event.stopPropagation(); openScheduleEditor(Number(node.dataset.scheduleIndex)); };
    $('.item-main', node).append(edit);
    if (event?.type === 'drive' || event?.type === 'flight') { $('.address', node).hidden = true; $('.place-query-name', node).hidden = true; }
  }
  node.addEventListener('change', () => { const type = $('.type', node).value, isDrive = type === 'drive', isFlight = type === 'flight'; $('.place-create', node)?.toggleAttribute('hidden', isDrive || isFlight); $('.place-query-name', node)?.toggleAttribute('hidden', isDrive || isFlight); $('.address', node)?.toggleAttribute('hidden', isDrive || isFlight); $('.route-inline', node)?.toggleAttribute('hidden', !isDrive); syncNodeToSchedule(node); save(); renderRouteTotals(); });
  node.addEventListener('click', event => { if (event.target.closest('input,select,textarea,button,label')) return; const index = Number(node.dataset.scheduleIndex); Number.isInteger(index) ? focusScheduleEvent(index) : focusNode(node); });
  node.addEventListener('dragstart', () => { state.dragging=node; node.classList.add('dragging'); });
  node.addEventListener('dragend', () => {
    node.classList.remove('dragging'); state.dragging=null;
    const orderedNodes = [...itemsEl.children];
    const orderedSchedule = orderedNodes.map(item => state.schedule[Number(item.dataset.scheduleIndex)]).filter(Boolean);
    if (orderedSchedule.length === state.schedule.length) {
      state.schedule = orderedSchedule;
      orderedNodes.forEach((item, index) => { item.dataset.scheduleIndex = String(index); });
      renderSchedule(state.schedule); applyDayFilter();
    }
    save();
  });
  node.addEventListener('dragover', e => { e.preventDefault(); if(state.dragging && state.dragging !== node) { const r=node.getBoundingClientRect(); itemsEl.insertBefore(state.dragging, e.clientY < r.top+r.height/2 ? node : node.nextSibling); } });
  itemsEl.append(node);
}
function refreshNodePlaceLink(node, index) {
  const oldLink = $('.event-place-link', node); oldLink?.remove();
  const event = state.schedule[index];
  if (event?.type === 'drive' || event?.type === 'flight') return;
  const place = state.locations.find(item => item.id === event?.locationId);
  if (!place) return;
  const link = document.createElement('small'); link.className = 'event-place-link'; link.textContent = `关联地点：${place.name || '未命名地点'}${place.address ? '' : '（地址待定）'}`;
  $('.item-main', node).insertBefore(link, $('.place-create', node) || $('.map-focus', node));
  const button = $('.place-create', node); if (button) button.textContent = '更新关联地点并查询';
}
function fillInlineRouteControls(node, index) {
  const event = state.schedule[index]; if (!event || !node) return;
  const links = event.routeLinks || {};
  const origin = state.locations.find(place => place.id === links.originPlaceId) || links.customOrigin || {};
  const destination = state.locations.find(place => place.id === links.destinationPlaceId) || links.customDestination || {};
  $('.inline-origin-name', node).value = origin.name || '';
  $('.inline-origin-address', node).value = origin.address || '';
  $('.inline-destination-name', node).value = destination.name || '';
  $('.inline-destination-address', node).value = destination.address || '';
  $('.inline-waypoints', node).value = (links.viaPlaceIds || []).map(id => state.locations.find(place => place.id === id)).filter(Boolean).map(place => `${place.name || ''}｜${place.address || ''}`).join('\n');
}
function parseInlineWaypoints(text) {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map((line, index) => {
    const parts = line.split(/[｜|]/).map(part => part.trim());
    return parts.length > 1 ? { name: parts[0] || `途经点 ${index + 1}`, address: parts.slice(1).join('｜') } : { name: line, address: line };
  });
}
async function resolveInlinePlace(name, address, type = 'spot') {
  const point = await geocode(address, name);
  let place = state.locations.find(item => item.name === name && item.address === address);
  if (!place) place = await confirmNewPlace({ type, name, address, fromEvent: true });
  if (!place) return null;
  Object.assign(place, { type, name, address, resolved: { name: point.name || name, address: point.formatted_address || address, location: point.location } });
  if (!state.locations.some(item => item.id === place.id)) state.locations.push(place);
  return place;
}
async function createRouteFromNode(node) {
  const index = Number(node.dataset.scheduleIndex), event = state.schedule[index];
  if (!event || event.type !== 'drive') return;
  const origin = { name: $('.inline-origin-name', node).value.trim(), address: $('.inline-origin-address', node).value.trim() };
  const destination = { name: $('.inline-destination-name', node).value.trim(), address: $('.inline-destination-address', node).value.trim() };
  const waypoints = parseInlineWaypoints($('.inline-waypoints', node).value);
  if (!origin.name || !origin.address || !destination.name || !destination.address) { alert('请完整填写起点和终点的名称、地址。'); return; }
  if (waypoints.some(place => !place.name || !place.address)) { alert('请按“名称｜地址”逐行填写途经点。'); return; }
  const button = $('.inline-route-create', node); button.disabled = true; button.textContent = '正在查询地点…';
  try {
    const originPlace = await resolveInlinePlace(origin.name, origin.address);
    const destinationPlace = await resolveInlinePlace(destination.name, destination.address);
    const viaPlaces = [];
    for (const waypoint of waypoints) viaPlaces.push(await resolveInlinePlace(waypoint.name, waypoint.address));
    if (!originPlace || !destinationPlace || viaPlaces.some(place => !place)) throw new Error('已取消新增地点，路线未创建。');
    const links = { originPlaceId: originPlace.id, destinationPlaceId: destinationPlace.id, viaPlaceIds: viaPlaces.map(place => place.id) };
    const route = upsertUniversalRoute(event.title, links);
    event.routeLinks = { ...links, routeId: route.id };
    save(); renderLocations(); renderSchedule(state.schedule); fillInlineRouteControls(node, index);
    button.textContent = '正在生成高德路线…';
    await showDriveSegment(index); await showDayOverview(state.dayFilter);
  } catch (error) { alert(error.message || '高德暂时无法查询地点或生成路线。'); }
  finally { button.disabled = false; button.textContent = '更新地点和路线'; }
}
async function createOrUpdatePlaceForNode(node) {
  const index = Number(node.dataset.scheduleIndex), event = state.schedule[index]; if (!event || event.type === 'drive' || event.type === 'flight') return;
  const name = $('.place-query-name', node).value.trim(); const address = $('.address', node).value.trim();
  if (!name || !address) { alert('请先填写地点名称和地点地址。'); return; }
  const button = $('.place-create', node); button.disabled = true; button.textContent = '正在查询高德…';
  try {
    const point = await geocode(address, name);
    let place = state.locations.find(item => item.id === event.locationId);
    if (!place) place = await confirmNewPlace({ type: event.type === 'transport' ? 'spot' : event.type, name, address, note: event.detail || '', fromEvent: true });
    if (!place) return;
    Object.assign(place, { type: event.type === 'transport' ? 'spot' : event.type, name, address, note: event.detail || '', resolved: { name: point.name || name, address: point.formatted_address || address, location: point.location } });
    event.locationId = place.id; event.address = '';
    refreshNodePlaceLink(node, index); renderLocations(); renderSchedule(state.schedule); save(); focusScheduleEvent(index);
  } catch (error) { alert(error.message || '高德暂时无法定位这个地点。'); }
  finally { button.disabled = false; button.textContent = event.locationId ? '更新关联地点并查询' : '创建地点并查询'; }
}
function renderLocations() {
  const places = $('#places');
  if (!places) return;
  const query = placeSearchText.toLowerCase();
  renderPlaceTypeFilter();
  const typeOrder = ['spot', 'geography', 'food', 'hotel', 'flight', 'transport', 'service', 'fuel', 'supply', ...customPlaceCategories().map(category => category.id), 'drive'];
  const visibleLocations = state.locations.filter(place => (!placeTypeFilter || place.type === placeTypeFilter) && (!query || `${place.name || ''} ${place.address || ''} ${place.note || ''} ${placeTypeName(place.type)}`.toLowerCase().includes(query))).sort((a, b) => (typeOrder.indexOf(a.type) < 0 ? 99 : typeOrder.indexOf(a.type)) - (typeOrder.indexOf(b.type) < 0 ? 99 : typeOrder.indexOf(b.type)) || String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'));
  $('#placeCount').textContent = `(${visibleLocations.length}/${state.locations.length})`;
  const placeTypes = placeTypeOptionsHtml();
  places.innerHTML = visibleLocations.length ? visibleLocations.map(place => `<article class="place-card${selectedPlaceIds.has(place.id) ? ' selected' : ''}" data-place-id="${place.id}"><div><input type="checkbox" class="place-select" aria-label="选择 ${escapeHtml(place.name || '未命名地点')}" ${selectedPlaceIds.has(place.id) ? 'checked' : ''}><span class="place-type type-${escapeHtml(place.type || 'spot')}" style="background:${placeTypeColor(place.type)}22;color:${placeTypeColor(place.type)}">${escapeHtml(placeTypeName(place.type))}</span><b>${escapeHtml(place.name || '未命名地点')}</b></div><select class="place-type-select">${placeTypes}</select><input class="place-name" value="${escapeHtml(place.name || '')}" placeholder="景点、地名、酒店、餐厅等名称"><input class="place-address" value="${escapeHtml(place.address || '')}" placeholder="具体地址待定可留空">${place.photo ? `<img class="place-photo-preview" src="${escapeHtml(place.photo)}" alt="${escapeHtml(place.name || '地点')}图片">` : '<div class="place-photo-placeholder">暂未上传地点图片</div>'}<label class="place-photo-action">${place.photo ? '更换图片' : '上传图片'}<input class="place-photo-input" type="file" accept="image/*"></label>${place.resolved ? `<small class="resolved-place">高德：${escapeHtml(place.resolved.name)} · ${escapeHtml(place.resolved.address)}<br>${escapeHtml(place.resolved.location)}</small>` : '<small class="hint">尚未查询高德位置</small>'}<textarea class="place-note" placeholder="备注">${escapeHtml(place.note || '')}</textarea><button type="button" class="place-save">保存修改</button><button type="button" class="place-resolve">${place.resolved ? '更新高德位置' : '查询高德位置'}</button><button type="button" class="place-map">在地图中查看</button><button type="button" class="place-delete">删除地点</button></article>`).join('') : '<p class="hint">没有符合条件的地点。</p>';
  places.querySelectorAll('.place-card').forEach(card => {
    $('.place-type-select', card).value = state.locations.find(item => item.id === card.dataset.placeId)?.type || 'spot';
    $('.place-select', card).onchange = event => { event.target.checked ? selectedPlaceIds.add(card.dataset.placeId) : selectedPlaceIds.delete(card.dataset.placeId); card.classList.toggle('selected', event.target.checked); };
    const update = () => {
      const place = state.locations.find(item => item.id === card.dataset.placeId); if (!place) return;
      const name = $('.place-name', card).value.trim(), address = $('.place-address', card).value.trim();
      if (!name) { alert('地点名称不能为空。'); $('.place-name', card).focus(); return; }
      const addressChanged = place.address !== address;
      place.type = $('.place-type-select', card).value; place.name = name; place.address = address; place.note = $('.place-note', card).value;
      if (addressChanged) delete place.resolved;
      card.classList.remove('dirty'); save(); renderSchedule(state.schedule); refreshEventCards(); renderLocations(); showDayOverview(state.dayFilter);
    };
    const editableFields = card.querySelectorAll('input:not(.place-select):not(.place-photo-input),textarea,select');
    editableFields.forEach(input => {
      input.addEventListener('input', () => card.classList.add('dirty'));
      input.addEventListener('change', () => card.classList.add('dirty'));
      input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && event.target.tagName !== 'TEXTAREA') { event.preventDefault(); update(); } });
    });
    $('.place-save', card).onclick = update;
    $('.place-photo-input', card).onchange = async event => { const file = event.target.files[0]; if (!file) return; const place = state.locations.find(item => item.id === card.dataset.placeId); if (!place) return; place.photo = await fileToDataUrl(file); save(); renderLocations(); };
    $('.place-delete', card).onclick = () => removeLocations(new Set([card.dataset.placeId]));
    $('.place-resolve', card).onclick = async event => {
      const place = state.locations.find(item => item.id === card.dataset.placeId);
      if (!place?.name || !place?.address) { alert('请先填写地点名称和详细地址。'); return; }
      const button = event.currentTarget; button.disabled = true; button.textContent = '正在查询高德…';
      try {
        const point = await geocode(place.address, place.name);
        place.resolved = { name: point.name || place.name, address: point.formatted_address || place.address, location: point.location };
        save(); renderLocations();
        const [lng, lat] = mapCoords(...point.location.split(',').map(Number)); map.flyTo([lat, lng], 11, { duration: .7 }); L.popup().setLatLng([lat, lng]).setContent(`<b>${escapeHtml(place.name)}</b><br>${escapeHtml(point.formatted_address || place.address)}`).openOn(map);
      } catch (error) { alert(error.message || '高德暂时无法查询这个地点。'); button.disabled = false; button.textContent = '重新查询高德位置'; }
    };
    $('.place-map', card).onclick = async () => { const place = state.locations.find(item => item.id === card.dataset.placeId); if (!place?.address) { alert('这个地点尚未填写具体地址。'); return; } try { const point = place.resolved?.location ? place.resolved : (isShareMode ? null : await geocode(place.address, place.name)); if (!point?.location) { alert('共享版本中尚未保存该地点坐标。'); return; } const [lng, lat] = mapCoords(...point.location.split(',').map(Number)); map.flyTo([lat, lng], 11, { duration: .7 }); L.popup().setLatLng([lat, lng]).setContent(`<b>${escapeHtml(place.name)}</b><br>${escapeHtml(place.address)}`).openOn(map); } catch { alert('暂时无法定位这个地点。'); } };
  });
}
function refreshEventCards() { state.schedule.forEach((event, index) => updateNodeFromSchedule(index)); }
function removeLocations(ids) {
  state.locations = state.locations.filter(place => !ids.has(place.id));
  const removedRouteIds = new Set(state.routes.filter(route => ids.has(route.originPlaceId) || ids.has(route.destinationPlaceId) || (route.viaPlaceIds || []).some(id => ids.has(id))).map(route => route.id));
  state.routes = state.routes.filter(route => !removedRouteIds.has(route.id));
  ids.forEach(id => selectedPlaceIds.delete(id));
  state.schedule.forEach(event => {
    if (ids.has(event.locationId)) delete event.locationId;
    if (!event.routeLinks) return;
    if (removedRouteIds.has(event.routeLinks.routeId)) delete event.routeLinks.routeId;
    if (ids.has(event.routeLinks.originPlaceId)) delete event.routeLinks.originPlaceId;
    if (ids.has(event.routeLinks.destinationPlaceId)) delete event.routeLinks.destinationPlaceId;
    event.routeLinks.viaPlaceIds = (event.routeLinks.viaPlaceIds || []).filter(id => !ids.has(id));
  });
  renderLocations(); renderSchedule(state.schedule); refreshEventCards(); save();
}
function values(node) { return { type:$('.type',node).value,date:$('.date',node).value,startTime:$('.start-time',node).value,endTime:$('.end-time',node).value,name:$('.name',node).value,address:$('.address',node).value,note:$('.note',node).value,photo:$('.preview',node).hidden?'':$('.preview',node).src,scheduleIndex:Number(node.dataset.scheduleIndex) }; }
function updateNodeFromSchedule(index) {
  const event = state.schedule[index];
  const node = [...itemsEl.children].find(item => Number(item.dataset.scheduleIndex) === index);
  if (!event || !node) return;
  $('.date', node).value = event.date; $('.start-time', node).value = event.start; $('.end-time', node).value = event.end || ''; $('.name', node).value = event.title; $('.note', node).value = event.detail || ''; $('.type', node).value = event.type || typeForTitle(event.title);
  const place = state.locations.find(item => item.id === event.locationId); $('.place-query-name', node).value = place?.name || ''; $('.address', node).value = place?.address || event.address || '';
  const isDrive = event.type === 'drive', isFlight = event.type === 'flight'; $('.place-create', node)?.toggleAttribute('hidden', isDrive || isFlight); $('.place-query-name', node)?.toggleAttribute('hidden', isDrive || isFlight); $('.address', node)?.toggleAttribute('hidden', isDrive || isFlight); $('.route-inline', node)?.toggleAttribute('hidden', !isDrive); fillInlineRouteControls(node, index); refreshNodePlaceLink(node, index);
}
function readSharedSchedule() {
  if (isShareMode) return structuredClone(shareData?.sharedSchedule || {});
  try { return JSON.parse(localStorage.getItem(sharedScheduleStorageKey) || '{}'); } catch { return {}; }
}
function applySharedSchedule(entries) {
  if (state.plans.length) return entries;
  const shared = readSharedSchedule();
  const applied = entries.map((event, index) => {
    const sharedId = event.sharedId || (event.date < '2026-08-20' ? `shared-${index}` : undefined);
    return sharedId ? { ...event, ...(shared[sharedId] || {}), sharedId } : event;
  });
  const existingIds = new Set(applied.map(event => event.sharedId).filter(Boolean));
  Object.values(shared).forEach(event => { if (event?.sharedId && !existingIds.has(event.sharedId)) applied.push(structuredClone(event)); });
  return applied.sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
}
function writeSharedSchedule() {
  if (state.plans.length) return;
  const shared = {};
  state.schedule.forEach(event => { if (event.sharedId) shared[event.sharedId] = structuredClone(event); });
  localStorage.setItem(sharedScheduleStorageKey, JSON.stringify(shared));
}
let fileSaveTimer;
function parseStoredJson(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } }
function queueLocalFileSave() {
  if (isShareMode) return;
  clearTimeout(fileSaveTimer);
  $('#fileSaveStatus').textContent = '等待写入本地文件…';
  fileSaveTimer = setTimeout(async () => {
    const payload = {
      activeVersion: state.versionKey,
      plans: state.plans,
      versions: Object.fromEntries(state.plans.map(plan => [plan.id, parseStoredJson(versionStorageKey(plan.id), null)]).filter(([, snapshot]) => snapshot)),
      locations: state.locations,
      routes: state.routes,
      sharedSchedule: {},
      updatedAt: new Date().toISOString()
    };
    try {
      const response = await fetch('/api/planner-data', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error();
      const result = await response.json();
      $('#fileSaveStatus').textContent = `已写入本地文件 · ${new Date(result.savedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    } catch { $('#fileSaveStatus').textContent = '本地文件写入失败'; }
  }, 300);
}
function currentSnapshot() { return { name: $('#tripName').value, items: [...itemsEl.children].map(values), schedule: state.schedule, locations: state.locations, routes: state.routes, placeCategories: state.placeCategories, preferences: state.preferences, placeModelVersion: 1, routeLinkModeVersion: 1, planKey: state.versionKey, updatedAt: new Date().toISOString() }; }
function save(){
  if (isShareMode) return;
  writeSharedSchedule(); const snapshot = currentSnapshot(); localStorage.setItem(universalLocationStorageKey, JSON.stringify(state.locations)); localStorage.setItem(universalRouteStorageKey, JSON.stringify(state.routes)); localStorage.setItem('roadtrip', JSON.stringify(snapshot)); localStorage.setItem(versionStorageKey(state.versionKey), JSON.stringify(snapshot)); queueLocalFileSave();
}
function typeForTitle(title = '') { return /航班|\b[A-Z]{2}\d{3,4}\b/i.test(title) ? 'flight' : /午餐|晚餐|早餐|简餐/.test(title) ? 'food' : /入住|休息|候机/.test(title) ? 'hotel' : /抵达|下机|取行李|租车|验车|还车|起飞/.test(title) ? 'transport' : /加油/.test(title) ? 'fuel' : /服务区/.test(title) ? 'service' : /驾驶|前往|返回|继续|返程|至/.test(title) ? 'drive' : 'spot'; }
function migrateToUnifiedItems(data) {
  if (!data.schedule?.length || data.items?.length >= data.schedule.length) return data;
  const legacy = [...(data.items || [])];
  const schedule = structuredClone(data.schedule);
  schedule.forEach(entry => { const matchIndex = legacy.findIndex(item => item.date === entry.date && (entry.title.includes(item.name) || item.name.includes(entry.title))); if (matchIndex >= 0) { const item = legacy.splice(matchIndex, 1)[0]; Object.assign(entry, { address: item.address, type: item.type, photo: item.photo || '', routeLinks: entry.routeLinks }); } else entry.type ||= typeForTitle(entry.title); });
  legacy.forEach(item => schedule.push({ date: item.date, start: item.startTime || '', end: item.endTime || '', title: item.name, detail: item.note || '', address: item.address, type: item.type, photo: item.photo || '' }));
  schedule.sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
  return { ...data, schedule, items: schedule.map((entry, scheduleIndex) => ({ type: entry.type || typeForTitle(entry.title), date: entry.date, startTime: entry.start, endTime: entry.end, name: entry.title, address: entry.address || '', note: entry.detail || '', photo: entry.photo || '', scheduleIndex })), planKey: data.planKey || defaultPlanId };
}
function migrateLegacyLocations(data) {
  if (data.locations) return data;
  const locations = [];
  const schedule = (data.schedule || []).filter(entry => {
    if (entry.type === 'hotel' && /住宿|酒店|民宿|客栈/.test(entry.title || '')) { locations.push({ id: crypto.randomUUID(), type: 'hotel', name: entry.title, address: '', note: entry.detail || '' }); return false; }
    return true;
  });
  return { ...data, schedule, locations, items: schedule.map((entry, scheduleIndex) => ({ type: entry.type || typeForTitle(entry.title), date: entry.date, startTime: entry.start, endTime: entry.end, name: entry.title, address: entry.address || '', note: entry.detail || '', photo: entry.photo || '', scheduleIndex })) };
}
function migrateToPlaceModel(data) {
  if (data.placeModelVersion === 1) return data;
  const locations = [...(data.locations || [])];
  const placeFor = entry => {
    let place = locations.find(item => item.address && item.address === entry.address);
    if (!place) { place = { id: crypto.randomUUID(), type: entry.type === 'food' ? 'food' : entry.type === 'hotel' ? 'hotel' : 'spot', name: entry.title, address: entry.address, note: entry.detail || '' }; locations.push(place); }
    return place;
  };
  const schedule = (data.schedule || []).map(entry => entry.address && entry.type !== 'drive' ? { ...entry, locationId: placeFor(entry).id, address: '' } : entry);
  return { ...data, schedule, locations, placeModelVersion: 1, items: schedule.map((entry, scheduleIndex) => ({ type: entry.type || typeForTitle(entry.title), date: entry.date, startTime: entry.start, endTime: entry.end, name: entry.title, address: '', note: entry.detail || '', photo: entry.photo || '', scheduleIndex })) };
}
function migrateExplicitRouteLinks(data) {
  if (data.routeLinkModeVersion === 1) return data;
  const schedule = (data.schedule || []).map(entry => entry.type === 'drive' ? { ...entry, routeLinks: {} } : entry);
  return { ...data, schedule, routeLinkModeVersion: 1, items: schedule.map((entry, scheduleIndex) => ({ type: entry.type || typeForTitle(entry.title), date: entry.date, startTime: entry.start, endTime: entry.end, name: entry.title, address: entry.address || '', note: entry.detail || '', photo: entry.photo || '', scheduleIndex })) };
}
function mergeUniversalLocations(data) {
  if (isShareMode) return data;
  let universal = [];
  try { universal = JSON.parse(localStorage.getItem(universalLocationStorageKey) || '[]'); } catch { universal = []; }
  if (!Array.isArray(universal)) universal = [];
  const merged = universal.map(place => ({ ...place }));
  const idMap = new Map();
  const keyFor = place => `${(place.name || '').trim().toLowerCase()}|${(place.address || '').trim().toLowerCase()}`;
  (data.locations || []).forEach(place => {
    const key = keyFor(place);
    let existing = merged.find(item => item.id === place.id) || (key !== '|' ? merged.find(item => keyFor(item) === key) : null);
    if (!existing) { existing = { ...place }; merged.push(existing); }
    else {
      if (!existing.name && place.name) existing.name = place.name;
      if (!existing.address && place.address) existing.address = place.address;
      if (!existing.note && place.note) existing.note = place.note;
      if (!existing.resolved && place.resolved) existing.resolved = place.resolved;
    }
    idMap.set(place.id, existing.id);
  });
  const schedule = (data.schedule || []).map(event => {
    const next = { ...event };
    if (next.locationId && idMap.has(next.locationId)) next.locationId = idMap.get(next.locationId);
    if (next.routeLinks) next.routeLinks = {
      ...next.routeLinks,
      originPlaceId: idMap.get(next.routeLinks.originPlaceId) || next.routeLinks.originPlaceId,
      destinationPlaceId: idMap.get(next.routeLinks.destinationPlaceId) || next.routeLinks.destinationPlaceId,
      viaPlaceIds: (next.routeLinks.viaPlaceIds || []).map(id => idMap.get(id) || id)
    };
    return next;
  });
  const routes = (data.routes || []).map(route => ({ ...route, originPlaceId: idMap.get(route.originPlaceId) || route.originPlaceId, destinationPlaceId: idMap.get(route.destinationPlaceId) || route.destinationPlaceId, viaPlaceIds: (route.viaPlaceIds || []).map(id => idMap.get(id) || id) }));
  return { ...data, schedule, routes, locations: merged };
}
const driveTravelModes = DRIVE_TRAVEL_MODES;
const transportModes = TRANSPORT_MODES;
const normalizedTransportMode = mode => transportModes[mode] ? mode : 'driving';
const transportModeMeta = mode => transportModes[normalizedTransportMode(mode)];
const normalizedTravelMode = mode => driveTravelModes[mode] ? mode : 'recommended';
const driveTravelMeta = mode => driveTravelModes[normalizedTravelMode(mode)];
function routeSignature(route = {}) { return [route.originPlaceId || '', ...(route.viaPlaceIds || []), route.destinationPlaceId || '', normalizedTransportMode(route.transportMode), normalizedTravelMode(route.travelMode)].join('>'); }
function routeEndpointMatches(placeId, customPlace, routePlaceId) {
  if (placeId) return placeId === routePlaceId;
  if (!customPlace || !routePlaceId) return false;
  const routePlace = state.locations.find(place => place.id === routePlaceId);
  if (!routePlace) return false;
  const customKeys = [customPlace.name, customPlace.address].map(normalizePlaceLookup).filter(Boolean);
  const routeKeys = [routePlace.name, routePlace.address, routePlace.resolved?.name, routePlace.resolved?.address].map(normalizePlaceLookup).filter(Boolean);
  return customKeys.some(customKey => routeKeys.some(routeKey => customKey === routeKey || (customKey.length >= 3 && (customKey.includes(routeKey) || routeKey.includes(customKey)))));
}
function routeForScheduleEvent(event) {
  const links = event?.routeLinks || {};
  const direct = state.routes.find(route => route.id === links.routeId);
  if (links.routeId) return direct || null;
  if (direct) return direct;
  const eventName = normalizePlaceLookup(event?.title);
  return state.routes.find(route => {
    const routeName = normalizePlaceLookup(route.name);
    if (!eventName || !routeName || (eventName !== routeName && !eventName.includes(routeName) && !routeName.includes(eventName))) return false;
    if (normalizedTransportMode(route.transportMode) !== normalizedTransportMode(links.transportMode)) return false;
    if (normalizedTravelMode(route.travelMode) !== normalizedTravelMode(links.travelMode)) return false;
    return routeEndpointMatches(links.originPlaceId, links.customOrigin, route.originPlaceId)
      && routeEndpointMatches(links.destinationPlaceId, links.customDestination, route.destinationPlaceId);
  });
}
function upsertUniversalRoute(name, links) {
  const signature = routeSignature(links);
  let route = state.routes.find(item => routeSignature(item) === signature);
  if (!route) { route = { id: crypto.randomUUID(), name: name || '未命名路线', originPlaceId: links.originPlaceId, destinationPlaceId: links.destinationPlaceId, viaPlaceIds: [...(links.viaPlaceIds || [])], transportMode: normalizedTransportMode(links.transportMode), travelMode: normalizedTravelMode(links.travelMode), transit: links.transit }; state.routes.push(route); }
  else if (name && (!route.name || route.name === '未命名路线')) route.name = name;
  return route;
}
function mergeUniversalRoutes(data) {
  if (isShareMode) return data;
  let universal = [];
  try { universal = JSON.parse(localStorage.getItem(universalRouteStorageKey) || '[]'); } catch { universal = []; }
  if (!Array.isArray(universal)) universal = [];
  const merged = universal.map(route => ({ ...route, viaPlaceIds: [...(route.viaPlaceIds || [])] }));
  const resultTimestamp = result => Date.parse(result?.queriedAt || result?.updatedAt || 0) || 0;
  (data.routes || []).forEach(route => {
    const existing = merged.find(item => item.id === route.id || routeSignature(item) === routeSignature(route));
    if (!existing) { merged.push({ ...route, viaPlaceIds: [...(route.viaPlaceIds || [])] }); return; }
    const newerAmap = resultTimestamp(route.amap) >= resultTimestamp(existing.amap) ? route.amap : existing.amap;
    const olderAmap = newerAmap === route.amap ? existing.amap : route.amap;
    const amap = newerAmap ? { ...newerAmap, ...(!newerAmap.steps?.length && olderAmap?.steps?.length ? { steps: olderAmap.steps } : {}) } : undefined;
    Object.assign(existing, route, { viaPlaceIds: [...(route.viaPlaceIds || [])], ...(amap ? { amap: { ...amap } } : {}) });
  });
  return { ...data, routes: merged };
}
function mapNodesForDay(date = state.dayFilter) {
  const eventForPlace = new Map();
  state.schedule.forEach((event, index) => {
    if (date && event.date !== date) return;
    if (event.locationId && !eventForPlace.has(event.locationId)) eventForPlace.set(event.locationId, index);
    if (event.type === 'flight') [event.flightInfo?.departurePlaceId, event.flightInfo?.stopoverPlaceId, event.flightInfo?.arrivalPlaceId].filter(Boolean).forEach(placeId => { if (!eventForPlace.has(placeId)) eventForPlace.set(placeId, index); });
  });
  return state.locations.filter(place => place.address && eventForPlace.has(place.id)).map(place => { const scheduleIndex = eventForPlace.get(place.id); return { ...place, type: state.schedule[scheduleIndex]?.type || place.type, scheduleIndex }; });
}
function routeColorForDate(date) {
  const palette = ['#2563eb', '#d97706', '#059669', '#7c3aed', '#dc2626', '#0891b2', '#be123c', '#65a30d', '#374151'];
  const dates = [...new Set(state.schedule.map(item => item.date).filter(Boolean))].sort();
  return palette[Math.max(0, dates.indexOf(date)) % palette.length];
}
function overviewRouteWeight(allDates = false) {
  const zoom = map?.getZoom?.() || 7;
  if (zoom <= 6) return allDates ? 3.2 : 3.6;
  if (zoom <= 8) return allDates ? 3.5 : 4;
  if (zoom <= 10) return allDates ? 3.9 : 4.5;
  return allDates ? 4.4 : 5;
}
function refreshOverviewRouteWeights() {
  dayOverviewLayer?.eachLayer(layer => {
    if (!layer._routeOverviewStyle || !layer.setStyle) return;
    layer.setStyle({ ...layer._routeOverviewStyle, weight: overviewRouteWeight(layer._routeAllDates) });
    if (layer._routeOriginalLatLngs) {
      const displayLatLngs = translateRouteForDisplay(layer._routeOriginalLatLngs, layer._routeVisualOffset);
      layer.setLatLngs(displayLatLngs);
      layer._routeArrowMarkers?.forEach(marker => {
        const pose = routeArrowPose(displayLatLngs, marker._routeArrowFraction);
        if (!pose) return;
        marker.setLatLng(pose.latLng);
        marker.getElement()?.querySelector('.route-direction-arrow')?.style.setProperty('--bearing', `${pose.bearing}deg`);
      });
    }
  });
}
function routeOverviewStyle(date, allDates = false) {
  if (!allDates) return { color: routeColorForDate(date), weight: overviewRouteWeight(false), opacity: .9, smoothFactor: 0, lineCap: 'round', lineJoin: 'round' };
  const dates = [...new Set(state.schedule.map(item => item.date).filter(Boolean))].sort();
  const index = Math.max(0, dates.indexOf(date));
  return { color: routeColorForDate(date), weight: overviewRouteWeight(true), opacity: .72, smoothFactor: 0, lineCap: 'round', lineJoin: 'round' };
}
function routePointDistanceMeters(first, second) {
  const latitude = ((first[0] + second[0]) / 2) * Math.PI / 180;
  return Math.hypot((second[0] - first[0]) * 111320, (second[1] - first[1]) * 111320 * Math.cos(latitude));
}
function corridorRouteSamples(latLngs, spacing = 250) {
  if (!latLngs.length) return [];
  const samples = [{ point: latLngs[0], distanceFromPrevious: 0 }];
  let carriedDistance = 0;
  for (let index = 1; index < latLngs.length; index += 1) {
    carriedDistance += routePointDistanceMeters(latLngs[index - 1], latLngs[index]);
    if (carriedDistance >= spacing) { samples.push({ point: latLngs[index], distanceFromPrevious: carriedDistance }); carriedDistance = 0; }
  }
  if (samples.at(-1)?.point !== latLngs.at(-1)) samples.push({ point: latLngs.at(-1), distanceFromPrevious: carriedDistance });
  return samples;
}
// 视觉分道只处理真正共用较长走廊的路线：既要连续相近超过 20km，
// 也要占较短路线至少 18%。端点是否相同并不作为判断条件。
const routeVisualOverlapPolicy = { proximityMeters: 400, minCorridorMeters: 20_000, minShorterRouteRatio: .18 };
function sharedRouteCorridorMeters(first, second) {
  const gridSize = .004, proximity = routeVisualOverlapPolicy.proximityMeters;
  const grid = new Map();
  corridorRouteSamples(second).forEach(sample => {
    const [lat, lng] = sample.point, key = `${Math.floor(lat / gridSize)}:${Math.floor(lng / gridSize)}`;
    const entries = grid.get(key) || []; entries.push(sample.point); grid.set(key, entries);
  });
  let currentRun = 0, longestRun = 0;
  corridorRouteSamples(first).forEach(sample => {
    const [lat, lng] = sample.point, row = Math.floor(lat / gridSize), col = Math.floor(lng / gridSize);
    const candidates = [];
    for (let y = -1; y <= 1; y += 1) for (let x = -1; x <= 1; x += 1) candidates.push(...(grid.get(`${row + y}:${col + x}`) || []));
    if (candidates.some(candidate => routePointDistanceMeters(sample.point, candidate) <= proximity)) {
      currentRun += sample.distanceFromPrevious;
      longestRun = Math.max(longestRun, currentRun);
    } else currentRun = 0;
  });
  return longestRun;
}
function routeLengthMeters(latLngs) {
  let length = 0;
  for (let index = 1; index < latLngs.length; index += 1) {
    const [lat1, lng1] = latLngs[index - 1], [lat2, lng2] = latLngs[index];
    const latitude = ((lat1 + lat2) / 2) * Math.PI / 180;
    const north = (lat2 - lat1) * 111320;
    const east = (lng2 - lng1) * 111320 * Math.cos(latitude);
    length += Math.hypot(north, east);
  }
  return length;
}
function routesShareVisualCorridor(first, second) {
  const firstLength = routeLengthMeters(first), secondLength = routeLengthMeters(second);
  const shorterLength = Math.min(firstLength, secondLength);
  if (!shorterLength) return false;
  // 双向采样可以避免某一路线的折点更多时，低估共同走廊长度。
  const sharedMeters = Math.max(sharedRouteCorridorMeters(first, second), sharedRouteCorridorMeters(second, first));
  return sharedMeters >= routeVisualOverlapPolicy.minCorridorMeters
    && sharedMeters / shorterLength >= routeVisualOverlapPolicy.minShorterRouteRatio;
}
function translateRouteForDisplay(latLngs, offset) {
  if (!map || !offset || latLngs.length < 2) return latLngs;
  const points = latLngs.map(point => map.latLngToLayerPoint(point));
  let start = points[0], end = points[points.length - 1];
  if (start.distanceTo(end) < 2) {
    for (let index = points.length - 1; index > 0; index -= 1) {
      if (points[0].distanceTo(points[index]) >= 2) { end = points[index]; break; }
    }
  }
  const dx = end.x - start.x, dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const moveX = -dy / length * offset, moveY = dx / length * offset;
  // 整条路线使用同一个平移向量，所有高德原始点和拐点的相对形状均保持不变。
  return points.map(point => map.layerPointToLatLng(L.point(point.x + moveX, point.y + moveY)));
}
function routeArrowPose(latLngs, fraction = .52) {
  if (!map || latLngs.length < 2) return null;
  // 以当前地图投影后的真实折线长度取点、取切线；不要按高德折点数量取中点，
  // 否则某些折点特别密集的路线会让箭头看起来朝向错误。
  const points = latLngs.map(point => map.latLngToLayerPoint(point));
  const segments = [];
  let totalLength = 0;
  for (let index = 1; index < points.length; index += 1) {
    const length = points[index - 1].distanceTo(points[index]);
    if (!length) continue;
    segments.push({ from: points[index - 1], to: points[index], length, start: totalLength });
    totalLength += length;
  }
  if (!totalLength) return null;
  const target = totalLength * Math.min(.9, Math.max(.1, fraction));
  const segment = segments.find(item => item.start + item.length >= target) || segments.at(-1);
  const progress = Math.max(0, Math.min(1, (target - segment.start) / segment.length));
  const point = L.point(segment.from.x + (segment.to.x - segment.from.x) * progress, segment.from.y + (segment.to.y - segment.from.y) * progress);
  return {
    latLng: map.layerPointToLatLng(point),
    bearing: Math.atan2(segment.to.y - segment.from.y, segment.to.x - segment.from.x) * 180 / Math.PI
  };
}
function addRouteDirectionArrows(latLngs, color, event, routeIndex) {
  if (latLngs.length < 3) return [];
  const fractions = [1 / 3, 2 / 3];
  return fractions.flatMap((fraction, arrowIndex) => {
    const pose = routeArrowPose(latLngs, fraction); if (!pose) return [];
    const marker = L.marker(pose.latLng, { icon: L.divIcon({ className: 'route-direction-arrow-wrap', iconSize: [12, 12], iconAnchor: [6, 6], html: `<span class="route-direction-arrow" style="--bearing:${pose.bearing}deg;color:${color}">➤</span>` }), interactive: true, keyboard: false, zIndexOffset: 250 + routeIndex * 2 + arrowIndex });
    marker._routeArrowFraction = fraction;
    marker.on('click', () => focusScheduleEvent(event.scheduleIndex, { skipDriveQuery: true }));
    marker.addTo(dayOverviewLayer);
    return [marker];
  });
}
function renderMapRouteLegend(date) {
  if (!mapRouteLegend) { mapRouteLegend = document.createElement('div'); mapRouteLegend.className = 'map-route-legend'; $('#map')?.append(mapRouteLegend); }
  if (!date && !Number.isInteger(state.selectedIndex)) {
    const dates = [...new Set(state.schedule.map(item => item.date).filter(Boolean))].sort();
    mapRouteLegend.innerHTML = `<b>行程日期</b>${dates.map(item => `<div><i class="route-legend-swatch" style="background:${routeColorForDate(item)}"></i>${escapeHtml(item)}</div>`).join('')}<small>路线颜色按日期区分；点击日期或卡片后可查看地点类别。</small>`;
    mapRouteLegend.hidden = !dates.length;
    return;
  }
  const activeDate = date || state.schedule[state.selectedIndex]?.date || '';
  const activeEvents = state.schedule.filter(event => !activeDate || event.date === activeDate);
  const placeTypes = [...new Set(activeEvents.flatMap(event => {
    if (event.type === 'drive') return [];
    if (event.type === 'flight') return ['flight'];
    const place = state.locations.find(item => item.id === event.locationId);
    return [place?.type || event.type];
  }).filter(Boolean).map(mapDisplayType))];
  const driveCount = activeEvents.filter(event => event.type === 'drive').length;
  const routeLegend = driveCount ? `<div><i class="route-legend-swatch" style="background:${routeColorForDate(activeDate)}"></i>路程${driveCount > 1 ? `（${driveCount} 段）` : ''}</div>` : '';
  mapRouteLegend.innerHTML = `<b>${activeDate ? `${escapeHtml(activeDate)} 图例` : '地图图例'}</b>${routeLegend}${placeTypes.map(type => `<div><i style="background:${placeTypeColor(type)}"></i>${escapeHtml(mapDisplayTypeName(type))}</div>`).join('')}<small>路程颜色与地图对应；点位颜色按地点库类别显示。</small>`;
  mapRouteLegend.hidden = !(driveCount || placeTypes.length);
}
async function showDayOverview(date) {
  const requestId = ++dayOverviewRequestId;
  if (!map) return;
  renderMapRouteLegend(date);
  if (!isShareMode) await ensureFlightAirportLinks();
  if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
  map.closePopup();
  dayOverviewLayer.clearLayers(); markerLayer.clearLayers();
  setOverviewFocusOpacity(false);
  dayOverviewBounds = null;
  const events = state.schedule.map((event, index) => ({ ...event, scheduleIndex: index })).filter(event => !date || event.date === date);
  const placeIds = new Set();
  const eventForPlace = new Map();
  const customPointEntries = [];
  events.forEach(event => {
    if (event.locationId) { placeIds.add(event.locationId); if (!eventForPlace.has(event.locationId)) eventForPlace.set(event.locationId, event); }
    if (event.type === 'flight') {
      [event.flightInfo?.departurePlaceId, event.flightInfo?.stopoverPlaceId, event.flightInfo?.arrivalPlaceId].filter(Boolean).forEach(id => { placeIds.add(id); if (!eventForPlace.has(id)) eventForPlace.set(id, event); });
      return;
    }
    if (event.type !== 'drive') return;
    const route = routeForScheduleEvent(event);
    const links = route ? { ...event.routeLinks, ...route } : event.routeLinks || {};
    [links.originPlaceId, ...(links.viaPlaceIds || []), links.destinationPlaceId].filter(Boolean).forEach(id => { placeIds.add(id); if (!eventForPlace.has(id)) eventForPlace.set(id, event); });
    if (!links.originPlaceId && links.customOrigin?.address) customPointEntries.push({ key: `${event.scheduleIndex}:origin`, ...links.customOrigin, event });
    if (!links.destinationPlaceId && links.customDestination?.address) customPointEntries.push({ key: `${event.scheduleIndex}:destination`, ...links.customDestination, event });
  });
  const places = state.locations.filter(place => placeIds.has(place.id) && (place.address || place.resolved?.location));
  const resolved = new Map();
  let resolvedChanged = false;
  await Promise.all(places.map(async place => {
    try {
      if (isShareMode && !place.resolved?.location) return;
      const point = place.resolved?.location ? place.resolved : await geocode(place.address, place.name);
      resolved.set(place.id, point.location);
      if (!place.resolved?.location) { place.resolved = { name: point.name || place.name, address: point.formatted_address || place.address, location: point.location }; resolvedChanged = true; }
    }
    catch { /* 地址待完善的地点不阻塞其余地图内容。 */ }
  }));
  await Promise.all(customPointEntries.map(async pointEntry => {
    try { if (isShareMode) return; const point = await geocode(pointEntry.address, pointEntry.name || pointEntry.title); resolved.set(pointEntry.key, point.location); }
    catch { /* 单个自定义起终点失败不阻塞当天其他内容。 */ }
  }));
  if (resolvedChanged) save();
  if (requestId !== dayOverviewRequestId) return;
  const bounds = [];
  places.forEach(place => {
    const point = resolved.get(place.id); if (!point) return;
    const [lng, lat] = mapCoords(...point.split(',').map(Number));
    const event = eventForPlace.get(place.id);
    if (event?.type !== 'flight') bounds.push([lat, lng]);
    const isFlightPlace = event?.type === 'flight';
    const marker = L.circleMarker([lat, lng], mapPointStyle(place.type || event?.type, { radius: isFlightPlace ? 2.5 : 3.5, ...(isFlightPlace ? { pane: 'flightPane', className: 'flight-airport-marker' } : {}) })).bindPopup(`<b>${escapeHtml(place.name)}</b><br>${escapeHtml(place.address)}`).addTo(markerLayer);
    if (event) marker.on('click', () => focusScheduleEvent(event.scheduleIndex));
  });
  customPointEntries.forEach(pointEntry => {
    const point = resolved.get(pointEntry.key); if (!point) return;
    const [lng, lat] = mapCoords(...point.split(',').map(Number)); bounds.push([lat, lng]);
    L.circleMarker([lat, lng], mapPointStyle('drive')).bindPopup(`<b>${escapeHtml(pointEntry.name || pointEntry.title || '自定义地点')}</b><br>${escapeHtml(pointEntry.address)}`).on('click', () => focusScheduleEvent(pointEntry.event.scheduleIndex)).addTo(markerLayer);
  });
  events.filter(event => event.type === 'flight').forEach(event => {
    drawFlightItinerary(dayOverviewLayer, event, event.scheduleIndex);
  });
  const routeEvents = events.filter(event => event.type === 'drive');
  let displayedRouteCount = events.filter(event => event.type === 'flight').length;
  let routeCacheChanged = false;
  const routeRenderRecords = [];
  for (const [routeIndex, event] of routeEvents.entries()) {
    const route = routeForScheduleEvent(event);
    const links = route ? { ...event.routeLinks, ...route } : event.routeLinks || {};
    const originKey = links.originPlaceId || (links.customOrigin?.address ? `${event.scheduleIndex}:origin` : '');
    const destinationKey = links.destinationPlaceId || (links.customDestination?.address ? `${event.scheduleIndex}:destination` : '');
    const pointKeys = [originKey, ...(links.viaPlaceIds || []), destinationKey].filter(Boolean);
    if (pointKeys.length < 2 || pointKeys.some(id => !resolved.has(id))) continue;
    try {
      let path;
      if (route?.amap?.steps?.length) path = { ...route.amap, steps: route.amap.steps };
      else {
        if (isShareMode) continue;
        const paths = [];
        for (let i = 1; i < pointKeys.length; i += 1) {
          const response = await fetch('/api/route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ origin: resolved.get(pointKeys[i - 1]), destination: resolved.get(pointKeys[i]), mode: normalizedTransportMode(links.transportMode), strategy: driveTravelMeta(links.travelMode).strategy, city: links.transit?.city, cityd: links.transit?.cityd }) });
          const data = await response.json(); if (!response.ok) throw new Error(data.error); paths.push(data.route.paths[0]);
        }
        path = { duration: paths.reduce((sum, item) => sum + Number(item.duration), 0), distance: paths.reduce((sum, item) => sum + Number(item.distance), 0), tolls: paths.reduce((sum, item) => sum + Number(item.tolls || 0), 0), tollDistance: paths.reduce((sum, item) => sum + Number(item.toll_distance || 0), 0), steps: paths.flatMap(item => item.steps) };
        if (route) {
          route.amap = { ...(route.amap || {}), distance: path.distance, duration: path.duration, tolls: path.tolls, tollDistance: path.tollDistance, transportMode: normalizedTransportMode(links.transportMode), travelMode: normalizedTravelMode(links.travelMode), strategy: driveTravelMeta(links.travelMode).strategy, steps: path.steps.map(step => ({ polyline: step.polyline || '' })) };
          routeCacheChanged = true;
        }
      }
      if (requestId !== dayOverviewRequestId) return;
      const latLngs = path.steps.flatMap(step => (step.polyline || '').split(';').filter(Boolean).map(pair => { const [lng, lat] = mapCoords(...pair.split(',').map(Number)); return [lat, lng]; }));
      if (!latLngs.length) continue;
      bounds.push(...latLngs);
      routeRenderRecords.push({ latLngs, event, route, routeIndex });
    } catch { /* 单条路线失败时仍显示当天其他路线与地点。 */ }
  }
  const offsets = routeRenderRecords.map(() => 0);
  if (!date) {
    const nearbyGraph = routeRenderRecords.map(() => new Set());
    for (let first = 0; first < routeRenderRecords.length; first += 1) for (let second = first + 1; second < routeRenderRecords.length; second += 1) {
      const firstRoute = routeRenderRecords[first].latLngs, secondRoute = routeRenderRecords[second].latLngs;
      if (!routesShareVisualCorridor(firstRoute, secondRoute)) continue;
      nearbyGraph[first].add(second);
      nearbyGraph[second].add(first);
    }
    const visited = new Set();
    nearbyGraph.forEach((neighbors, first) => {
      if (visited.has(first) || !neighbors.size) return;
      const component = [], queue = [first]; visited.add(first);
      while (queue.length) {
        const current = queue.shift(); component.push(current);
        nearbyGraph[current].forEach(next => { if (!visited.has(next)) { visited.add(next); queue.push(next); } });
      }
      // 每个连续近距离组只保留一条最长主路线；其他路线都相对这条主路线移动。
      const main = component.reduce((best, current) => routeLengthMeters(routeRenderRecords[current].latLngs) > routeLengthMeters(routeRenderRecords[best].latLngs) ? current : best, component[0]);
      component.filter(current => current !== main).forEach(current => {
        const direction = `${routeRenderRecords[current].event.date}:${routeRenderRecords[current].routeIndex}`.localeCompare(`${routeRenderRecords[main].event.date}:${routeRenderRecords[main].routeIndex}`) <= 0 ? -1 : 1;
        offsets[current] = direction * 5;
      });
    });
  }
  routeRenderRecords.forEach((record, recordIndex) => {
    const { latLngs, event, route, routeIndex } = record;
    const visualOffset = Math.max(-12, Math.min(12, offsets[recordIndex]));
    const overviewStyle = routeOverviewStyle(event.date, !date);
    // 所有高德原始点都保留；仅对较短的近距离路线整体平移以形成视觉分道。
    const displayLatLngs = translateRouteForDisplay(latLngs, visualOffset);
    const line = L.polyline(displayLatLngs, overviewStyle);
    line._routeOverviewStyle = overviewStyle;
    line._routeAllDates = !date;
    line._routeOriginalLatLngs = latLngs;
    line._routeVisualOffset = visualOffset;
    line.on('mouseover', () => line.setStyle({ weight: Math.max(4, overviewRouteWeight(line._routeAllDates) + 2), opacity: 1 }));
    line.on('mouseout', () => line.setStyle({ ...overviewStyle, weight: overviewRouteWeight(line._routeAllDates) }));
    line.on('click', clickEvent => {
      focusScheduleEvent(event.scheduleIndex, { skipDriveQuery: true });
      if (!route?.id) return;
      const popup = document.createElement('div'); popup.innerHTML = `<b>${escapeHtml(route.name || event.title || '当前路线')}</b><br><small>${event.date} · ${escapeHtml(event.title || '')}</small>`;
      if (!isShareMode) {
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '删除这条通用路线'; remove.style.cssText = 'display:block;margin-top:8px;background:#fff4f1;color:#a44435;border:1px solid #dfa99f;padding:5px 8px;font-size:11px';
        remove.onclick = () => { if (!confirm(`确定删除通用路线“${route.name || event.title}”吗？关联事件会保留，但会解除路线关联。`)) return; removeRoute(route.id); map.closePopup(); };
        popup.append(remove);
      }
      L.popup().setLatLng(clickEvent.latlng).setContent(popup).openOn(map);
    });
    line.addTo(dayOverviewLayer);
    line._routeArrowMarkers = addRouteDirectionArrows(displayLatLngs, overviewStyle.color, event, routeIndex);
    displayedRouteCount += 1;
  });
  if (routeCacheChanged) save();
  renderRouteTotals();
  if (bounds.length && requestId === dayOverviewRequestId) {
    dayOverviewBounds = L.latLngBounds(bounds);
    map.fitBounds(dayOverviewBounds, { padding: [38, 38], maxZoom: 12 });
  }
  if (!Number.isInteger(state.selectedIndex)) {
    $('#routeDetail').innerHTML = `<b>${date ? `${escapeHtml(date)} 地图总览` : '全程地图总览'}</b><small>已显示 ${places.filter(place => resolved.has(place.id)).length + customPointEntries.filter(point => resolved.has(point.key)).length} 个关联地点与 ${displayedRouteCount} 条行程线路。点击时间表卡片可在此查看该事件的详细信息。</small>`;
  }
  if (requestId === dayOverviewRequestId) renderedOverviewDate = date || '';
}
function load(rawData, versionKey = rawData.planKey || defaultPlanId) {
  const data = migrateFlightStopovers(repairEventNamedLocations(mergeUniversalRoutes(mergeUniversalLocations(migrateExplicitRouteLinks(migrateToPlaceModel(migrateLegacyLocations(clearInitialPendingAddresses(migrateToUnifiedItems(rawData)))))))));
  state.versionKey = state.plans.some(plan => plan.id === versionKey) ? versionKey : state.plans[0]?.id || defaultPlanId;
  renderPlanSelect(); itemsEl.innerHTML = ''; $('#tripName').value = data.name || state.plans.find(plan => plan.id === state.versionKey)?.name || '我的自驾行程';
  state.schedule = applySharedSchedule((data.schedule || []).map(event => {
    const normalized = event.type === 'spot' && typeForTitle(event.title) !== 'spot' ? { ...event, type: typeForTitle(event.title) } : { ...event };
    if (normalized.type === 'drive') delete normalized.locationId;
    return normalized;
  }));
  state.locations = data.locations || []; state.routes = data.routes || []; state.placeCategories = (data.placeCategories || []).filter(category => category?.id && category?.name).map(category => ({ id: category.id, name: category.name, color: normalizeCategoryColor(category.color) }));
  state.schedule.forEach(event => {
    const links = event.routeLinks;
    if (event.type !== 'drive' || !links) return;
    let route;
    if (links.originPlaceId && links.destinationPlaceId) route = upsertUniversalRoute(event.title, links);
    else route = routeForScheduleEvent(event);
    if (route) event.routeLinks = { ...links, routeId: route.id };
  });
  const usedRouteIds = new Set(state.schedule.map(event => event.routeLinks?.routeId).filter(Boolean));
  state.plans.forEach(plan => { try { const snapshot = JSON.parse(localStorage.getItem(versionStorageKey(plan.id)) || 'null'); (snapshot?.schedule || []).forEach(event => { if (event.routeLinks?.routeId) usedRouteIds.add(event.routeLinks.routeId); }); } catch {} });
  state.routes = state.routes.filter(route => usedRouteIds.has(route.id));
  state.preferences = { ...state.preferences, ...(data.preferences || {}) }; state.dayFilter = '';
  state.schedule.forEach((entry, scheduleIndex) => {
    const oldItem = (data.items || [])[scheduleIndex] || {}; const place = state.locations.find(item => item.id === entry.locationId);
    addItem({ type: entry.type || typeForTitle(entry.title), date: entry.date, startTime: entry.start, endTime: entry.end || '', name: entry.title, address: place?.address || entry.address || '', note: entry.detail || '', photo: oldItem.photo || entry.photo || '', scheduleIndex });
  });
  renderLocations(); save(); applyDayFilter();
}
function loadPreset(key, forceOriginal = false) {
  if (isShareMode && shareData?.versions?.[key]) {
    load(structuredClone(shareData.versions[key]), key);
    renderSchedule(state.schedule);
    return;
  }
  if (!forceOriginal) { const draft = localStorage.getItem(versionStorageKey(key)); if (draft) { load(JSON.parse(draft), key); renderSchedule(state.schedule); return; } }
  const presetKey = PRESET_PLANS[key] ? key : 'b';
  const plan = PRESET_PLANS[presetKey];
  if (!plan) return;
  state.schedule = structuredClone(PRESET_SCHEDULES[presetKey] || []);
  const typeFor = typeForTitle;
  const sourceStops = plan.items.map(([type, date, name, address, note]) => { const [startTime, endTime] = presetNodeTimes[`${date}|${name}`] || ['', '']; return { type, date, startTime, endTime, name, address: ['hotel', 'food'].includes(type) ? '' : address, note, used: false }; });
  state.schedule.forEach(entry => {
    const stop = sourceStops.find(item => !item.used && item.date === entry.date && (entry.title.includes(item.name) || item.name.includes(entry.title)));
    if (stop) { entry.address = stop.address; entry.type = stop.type; stop.used = true; }
    else entry.type = typeFor(entry.title);
  });
  const locations = sourceStops.filter(item => ['hotel', 'food'].includes(item.type)).map(item => ({ id: crypto.randomUUID(), type: item.type, name: item.name, address: '', note: item.note || '' }));
  sourceStops.filter(item => !item.used && !['hotel', 'food'].includes(item.type)).forEach(item => state.schedule.push({ date: item.date, start: item.startTime || '00:00', end: item.endTime || '', title: item.name, detail: item.note, address: item.address, type: item.type }));
  state.schedule.sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
  const planItems = state.schedule.map((entry, scheduleIndex) => ({ type: entry.type || typeFor(entry.title), date: entry.date, startTime: entry.start, endTime: entry.end, name: entry.title, address: entry.address || '', note: entry.detail || '', scheduleIndex }));
  load({ name: state.plans.find(item => item.id === key)?.name || '新疆自驾游', items: planItems, schedule: state.schedule, locations }, key);
  $('#duration').textContent = '—'; $('#distance').textContent = '已载入预设行程，正在显示点位';
  showStopsOnMap(planItems);
  renderSchedule(state.schedule);
}
function syncNodeToSchedule(node) {
  const index = Number(node.dataset.scheduleIndex);
  if (!Number.isInteger(index) || !state.schedule[index]) { renderManualSchedule(); return; }
  const item = values(node);
  state.schedule[index] = { ...state.schedule[index], date: item.date, start: item.startTime, end: item.endTime, title: item.name, detail: item.note, address: state.schedule[index].locationId ? '' : item.address, type: item.type };
  renderSchedule(state.schedule);
  applyDayFilter();
}
function scheduleHourHeight() {
  const panelHeight = schedulePanel.clientHeight || Math.max(300, window.innerHeight - 92);
  const headHeight = schedulePanel.querySelector('.aside-head')?.offsetHeight || 34;
  const scheduleHeight = $('#schedule')?.clientHeight || Math.max(320, panelHeight - headHeight - 18);
  // 7:00–23:00 共 16 小时：网格始终填满时间表模块的可视高度，而不是固定 30px/小时。
  const usableHeight = Math.max(256, scheduleHeight - 52);
  return Math.max(16, Math.floor(usableHeight / 16));
}
function refreshScheduleBatchControls() {
  const count = selectedScheduleIndexes.size;
  const back = $('#scheduleShiftBack'), forward = $('#scheduleShiftForward');
  if (back) back.disabled = count === 0;
  if (forward) forward.disabled = count === 0;
  const hint = $('#scheduleHint');
  if (hint && count) hint.textContent = `已选 ${count} 项，可批量移动`;
}
function bindScheduleSelection() {
  const schedule = $('#schedule'); if (!schedule) return;
  schedule.classList.toggle('schedule-selecting', scheduleSelectionMode);
  const modeButton = $('#scheduleSelectMode');
  refreshScheduleBatchControls();
  if (!scheduleSelectionMode) return;
  let startX = 0, startY = 0, marquee = null, selecting = false;
  const finish = () => { if (!selecting) return; selecting = false; marquee?.remove(); marquee = null; refreshScheduleBatchControls(); };
  schedule.onpointerdown = event => {
    if (event.button !== 0 || event.target.closest('button,select,input')) return;
    if (event.target.closest('.calendar-block')) return;
    event.preventDefault(); selecting = true; startX = event.clientX; startY = event.clientY;
    if (!event.shiftKey) selectedScheduleIndexes.clear();
    marquee = document.createElement('div'); marquee.className = 'calendar-marquee'; document.body.append(marquee);
    const update = move => {
      if (!selecting) return;
      const left = Math.min(startX, move.clientX), top = Math.min(startY, move.clientY), width = Math.abs(move.clientX - startX), height = Math.abs(move.clientY - startY);
      if (width > 4 || height > 4) suppressScheduleClick = true;
      Object.assign(marquee.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
      const box = { left, top, right: left + width, bottom: top + height };
      schedule.querySelectorAll('.calendar-block').forEach(block => {
        const rect = block.getBoundingClientRect();
        const hit = rect.left < box.right && rect.right > box.left && rect.top < box.bottom && rect.bottom > box.top;
        if (hit) selectedScheduleIndexes.add(Number(block.dataset.scheduleIndex));
      });
      schedule.querySelectorAll('.calendar-block').forEach(block => block.classList.toggle('batch-selected', selectedScheduleIndexes.has(Number(block.dataset.scheduleIndex))));
      refreshScheduleBatchControls();
    };
    const up = () => { window.removeEventListener('pointermove', update); window.removeEventListener('pointerup', up); finish(); };
    window.addEventListener('pointermove', update); window.addEventListener('pointerup', up);
  };
}
function shiftSelectedSchedule(minutes) {
  if (!selectedScheduleIndexes.size) return;
  scheduleUndoStack.push(JSON.stringify(state.schedule));
  if (scheduleUndoStack.length > 20) scheduleUndoStack.shift();
  const toMinutes = value => { const [h, m] = String(value || '00:00').split(':').map(Number); return h * 60 + m; };
  const format = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  selectedScheduleIndexes.forEach(index => {
    const entry = state.schedule[index]; if (!entry) return;
    const start = toMinutes(entry.start), end = toMinutes(entry.end || entry.start);
    const shiftedStart = Math.max(0, Math.min(1435, start + minutes));
    const duration = Math.max(0, end - start);
    entry.start = format(shiftedStart); entry.end = format(Math.min(1439, shiftedStart + duration));
  });
  renderSchedule(state.schedule); applyDayFilter(); refreshEventCards(); save();
}
function snapScheduleDrop(date, rawMinute, indexes = []) {
  const excluded = new Set(indexes.map(Number));
  const previousEnds = state.schedule.filter((entry, index) => entry.date === date && !excluded.has(index) && clockToMinute(entry.end || entry.start) <= rawMinute).map(entry => clockToMinute(entry.end || entry.start));
  const previousEnd = previousEnds.length ? Math.max(...previousEnds) : null;
  return previousEnd !== null && rawMinute - previousEnd <= 45 ? previousEnd : Math.max(7 * 60, Math.min(22 * 60 + 55, Math.round(rawMinute / 5) * 5));
}
function undoScheduleChange() {
  const snapshot = scheduleUndoStack.pop(); if (!snapshot) return;
  state.schedule = JSON.parse(snapshot);
  selectedScheduleIndexes.clear(); renderSchedule(state.schedule); applyDayFilter(); refreshEventCards(); renderLocations(); save();
}
document.addEventListener('keydown', event => {
  if (isShareMode) return;
  if (!(event.ctrlKey || event.metaKey)) return;
  const target = event.target;
  if (target.matches?.('input,textarea,[contenteditable="true"]')) return;
  const key = event.key.toLowerCase();
  if (key === 'c') {
    if (!selectedScheduleIndexes.size) return;
    scheduleClipboard = JSON.stringify([...selectedScheduleIndexes].sort((a, b) => a - b).map(index => state.schedule[index]).filter(Boolean));
    navigator.clipboard?.writeText(scheduleClipboard).catch(() => {});
    event.preventDefault(); return;
  }
  if (key === 'v') {
    event.preventDefault();
    const paste = async () => {
      let raw = scheduleClipboard;
      if (!raw) { try { raw = await navigator.clipboard.readText(); } catch { return; } }
      let copied; try { copied = JSON.parse(raw); } catch { return; }
      if (!Array.isArray(copied) || !copied.length) return;
      const target = schedulePasteTarget;
      const sourceStart = copied[0]?.start ? clockToMinute(copied[0].start) : 0;
      const targetStart = target?.start ? clockToMinute(target.start) : sourceStart;
      const timeDelta = target ? targetStart - sourceStart : 0;
      const clones = copied.map(entry => {
        const clone = { ...entry, routeLinks: entry.routeLinks ? JSON.parse(JSON.stringify(entry.routeLinks)) : undefined, flightInfo: entry.flightInfo ? { ...entry.flightInfo } : undefined, sharedId: entry.date < '2026-08-20' ? `shared-paste-${crypto.randomUUID()}` : undefined };
        if (target?.date) { clone.date = target.date; if (clone.start) clone.start = minuteToClock(Math.max(0, Math.min(1435, clockToMinute(clone.start) + timeDelta))); if (clone.end) clone.end = minuteToClock(Math.max(5, Math.min(1439, clockToMinute(clone.end) + timeDelta))); }
        if (clone.date < '2026-08-20') clone.sharedId = `shared-paste-${crypto.randomUUID()}`;
        return clone;
      });
      scheduleUndoStack.push(JSON.stringify(state.schedule)); if (scheduleUndoStack.length > 20) scheduleUndoStack.shift();
      const targetIndex = schedulePasteTargetId ? state.schedule.findIndex(entry => entry.sharedId === schedulePasteTargetId) : -1;
      const insertAt = targetIndex >= 0 ? targetIndex : (Number.isInteger(schedulePasteAnchor) ? schedulePasteAnchor : (selectedScheduleIndexes.size ? Math.max(...selectedScheduleIndexes) + 1 : state.schedule.length));
      state.schedule.splice(insertAt, 0, ...clones); selectedScheduleIndexes.clear(); clones.forEach((_, offset) => selectedScheduleIndexes.add(insertAt + offset)); scheduleSelectionAnchor = insertAt;
      save(); renderSchedule(state.schedule); applyDayFilter(); refreshEventCards(); showDayOverview(state.dayFilter);
    };
    paste(); return;
  }
  if (key !== 'z' || event.shiftKey) return;
  event.preventDefault(); undoScheduleChange();
});
function renderSchedule(entries) {
  const schedule = $('#schedule');
  const previousScroll = schedule.querySelector('.schedule-scroll') ? { left: schedule.querySelector('.schedule-scroll').scrollLeft, top: schedule.querySelector('.schedule-scroll').scrollTop } : null;
  if (!entries.length) { schedule.innerHTML = '<p class="hint">为节点填写日期和起止时间后，将在这里按天展示。</p>'; return; }
  const allDates = [...new Set(entries.map(item => item.date))].sort();
  const filter = $('#dayFilter');
  const selected = state.dayFilter;
  filter.innerHTML = `<option value="">全部日期</option>${allDates.map(date => `<option value="${date}">${date}</option>`).join('')}`;
  filter.value = selected;
  const mapFilter = $('#mapDayFilter');
  mapFilter.innerHTML = `<option value="">全部日期</option>${allDates.map(date => `<option value="${date}">${date}</option>`).join('')}`;
  mapFilter.value = selected;
  const dates = selected ? allDates.filter(date => date === selected) : allDates;
  const startHour = 7, endHour = 23;
  const startMinute = startHour * 60, endMinute = endHour * 60, visibleHours = endHour - startHour, hourHeight = scheduleHourHeight();
  const calendarFontScale = Math.max(.85, Math.min(1.55, hourHeight / 30));
  schedule.dataset.hourHeight = String(hourHeight);
  const toMinute = time => { const [hour, minute] = (time || '06:00').split(':').map(Number); return hour * 60 + minute; };
  const eventEndMinute = item => item.type === 'flight' && item.flightInfo?.arrivalDate > item.date ? endMinute : toMinute(item.end || '24:00');
  const classify = item => /驾驶|前往|返回|至/.test(item.title) ? 'drive' : /午餐|晚餐|早餐|简餐/.test(item.title) ? 'meal' : /休息|入住|候机/.test(item.title) ? 'rest' : /可选|取消/.test(item.detail) ? 'warn' : '';
  const header = dates.map(date => { const d = new Date(`${date}T12:00:00`); return `<div class="calendar-head"><b>${d.toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'})}</b><small>周${'日一二三四五六'[d.getDay()]}</small></div>`; }).join('');
  const rail = Array.from({ length: visibleHours }, (_, i) => `<div class="time-label">${String(i + startHour).padStart(2, '0')}:00</div>`).join('');
  const columns = dates.map(date => {
    const dayEvents = entries.map((item, index) => ({ ...item, index })).filter(item => item.date === date).sort((a, b) => toMinute(a.start) - toMinute(b.start) || eventEndMinute(b) - eventEndMinute(a));
    // 重叠事件采用嵌套缩进：长时段作为外层，包含或交叉的短时段叠放在其内部，不再横向分栏。
    const placed = [];
    dayEvents.forEach(item => {
      const start = toMinute(item.start), end = eventEndMinute(item);
      const active = placed.filter(entry => entry.start < end && entry.end > start);
      const containers = active.filter(entry => entry.start <= start && entry.end >= end);
      let depth = containers.length ? Math.max(...containers.map(entry => entry.depth)) + 1 : 0;
      while (active.some(entry => entry.depth === depth)) depth += 1;
      placed.push({ item, start, end, depth: Math.min(depth, 5) });
    });
    const blocks = placed.map(({ item, depth, start, end }) => {
      const rawStart = toMinute(item.start), rawEnd = eventEndMinute(item);
      if (rawEnd <= startMinute || rawStart >= endMinute) return '';
      const visibleStart = Math.max(startMinute, rawStart), visibleEnd = Math.min(endMinute, rawEnd);
      const top = (visibleStart - startMinute) / 60 * hourHeight;
      const height = Math.max(4, (visibleEnd - visibleStart) / 60 * hourHeight - 1);
      const compactClass = height < 10 ? ' compact' : '';
      const shortClass = height < 28 ? ' short' : '';
      const tallClass = height >= 56 ? ' tall' : '';
      const roomyClass = height >= 38 ? ' roomy' : '';
      const label = /驾驶|前往|返回|继续|返程|至/.test(item.title) ? '路程' : (eventTypeNames[item.type] || '安排');
      const indent = depth * 18;
      const width = `calc(100% - ${12 + indent}px)`;
      const left = `${6 + indent}px`;
      const nestedChildren = placed.filter(entry => entry.depth > depth && entry.start < end && entry.end > start);
      const hasNestedChildren = nestedChildren.length > 0;
      const nestingClass = `${depth ? ' nested-child' : ''}${hasNestedChildren ? ' nested-parent' : ''}`;
      const place = state.locations.find(location => location.id === item.locationId);
      const eventLinks = item.routeLinks || {};
      const sharedRoute = routeForScheduleEvent(item);
      const links = sharedRoute ? { ...eventLinks, ...sharedRoute } : eventLinks;
      const origin = state.locations.find(location => location.id === links.originPlaceId) || links.customOrigin;
      const destination = state.locations.find(location => location.id === links.destinationPlaceId) || links.customDestination;
      const viaCount = (links.viaPlaceIds || []).length;
      const queryRecord = sharedRoute?.amap;
      const driveAmapMeta = queryRecord ? [
        Number(queryRecord.distance) ? `${(Number(queryRecord.distance) / 1000).toFixed(1)} 公里` : '',
        Number(queryRecord.duration) ? `预计 ${fmt(Number(queryRecord.duration))}` : '',
        Number.isFinite(Number(queryRecord.tolls)) ? `过路费约 ${Number(queryRecord.tolls).toFixed(0)} 元` : '',
        queryRecord.queriedAt ? `高德查询 ${new Date(queryRecord.queriedAt).toLocaleString('zh-CN')}${queryRecord.queryPeriod === 'night' ? '（夜间结果，待白天重查）' : ''}` : ''
      ].filter(Boolean).join(' · ') : '';
      const normalizeSummaryText = value => String(value || '').replace(/[\s·，,。；;：:（）()→\-—_/]/g, '').toLowerCase();
      const titleText = normalizeSummaryText(item.title);
      const placeNameText = normalizeSummaryText(place?.name);
      const placeNameAddsInfo = placeNameText && !titleText.includes(placeNameText) && !placeNameText.includes(titleText);
      const placeMeta = place
        ? (placeNameAddsInfo ? place.name : '')
        : (normalizeSummaryText(item.detail) === titleText ? '' : (item.detail || '地点待关联'));
      const flightMeta = [
        item.flightInfo?.stopoverAirport ? `经停 ${item.flightInfo.stopoverAirport}${item.flightInfo.stopoverArrivalTime || item.flightInfo.stopoverDepartureTime ? ` ${item.flightInfo.stopoverArrivalTime || '--:--'}–${item.flightInfo.stopoverDepartureTime || '--:--'}` : ''}` : '',
        item.detail && normalizeSummaryText(item.detail) !== titleText ? item.detail : '',
        item.flightInfo?.arrivalDate > item.date ? `次日 ${item.end} 抵达` : ''
      ].filter((part, index, parts) => part && parts.findIndex(other => normalizeSummaryText(other) === normalizeSummaryText(part)) === index).join(' · ');
      const detailMeta = item.detail && normalizeSummaryText(item.detail) !== titleText && normalizeSummaryText(item.detail) !== normalizeSummaryText(placeMeta) ? item.detail : '';
      const priceItems = normalizedPriceItems(item.priceInfo);
      const calculatedPrice = priceItems.perPersonItems.reduce((sum, entry) => sum + Number(entry.amount || 0) * Number(entry.people || 1), 0) + priceItems.sharedItems.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
      const priceNotes = [...priceItems.perPersonItems.map(entry => `${entry.note || '单人费用'} ${entry.amount || 0}×${entry.people || 1}`), ...priceItems.sharedItems.map(entry => entry.note || '共同费用')].filter(Boolean).join('；');
      const priceMeta = calculatedPrice ? `费用 ${calculatedPrice.toFixed(2)} 元${priceNotes ? `（${priceNotes}）` : ''}` : '';
      const baseMeta = item.type === 'drive'
        ? (origin && destination ? [`${origin.name || '起点'} → ${destination.name || '终点'}${viaCount ? ` · ${viaCount} 个途经点` : ''}`, driveAmapMeta].filter(Boolean).join(' · ') : '起点、终点待关联')
        : item.type === 'flight'
          ? flightMeta
          : [placeMeta, detailMeta].filter(Boolean).join(' · ');
      const meta = [baseMeta, priceMeta].filter(Boolean).join(' · ');
      const weatherIsCurrent = item.weather?.placeId === item.locationId && item.weather?.eventDate === item.date && item.weather?.eventStart === (item.start || '');
      const driveWeatherIsCurrent = item.weather?.eventDate === item.date && item.weather?.eventStart === (item.start || '') && item.weather?.eventEnd === (item.end || item.start || '');
      const flightWeatherIsCurrent = item.weather?.eventDate === item.date && item.weather?.eventStart === (item.start || '') && item.weather?.eventEnd === (item.end || item.start || '') && item.weather?.arrivalDate === (item.flightInfo?.arrivalDate || item.date) && item.weather?.departureAirport === (item.flightInfo?.departureAirport || '') && item.weather?.arrivalAirport === (item.flightInfo?.arrivalAirport || '');
      const weatherText = item.type === 'drive'
        ? (driveWeatherIsCurrent ? [item.weather?.origin && `起点 ${weatherSummary(item.weather.origin)}`, item.weather?.destination && `终点 ${weatherSummary(item.weather.destination)}`].filter(Boolean).join(' · ') : '')
        : item.type === 'flight'
          ? (flightWeatherIsCurrent ? [item.weather?.origin && `起飞 ${weatherSummary(item.weather.origin)}`, item.weather?.destination && `降落 ${weatherSummary(item.weather.destination)}`].filter(Boolean).join(' · ') : '')
          : (weatherIsCurrent ? weatherSummary(item.weather) : '');
      const tooltip = `${item.start}${item.end ? `–${item.end}` : ''} · ${label} · ${item.title}${meta ? ` · ${meta}` : ''}`;
      const headerMarkup = `<span class="calendar-event-header"><time>${item.start}${item.end ? `–${item.end}` : ''}</time><em>${label}</em></span>`;
      const bodyMarkup = `<b>${escapeHtml(item.title)}</b>${meta ? `<small>${escapeHtml(meta)}</small>` : ''}${weatherText ? `<small class="weather-meta">${escapeHtml(weatherText)}</small>` : ''}`;
      let renderedContent = `${headerMarkup}${bodyMarkup}`;
      if (hasNestedChildren) {
        const occupied = nestedChildren
          .map(entry => ({ start: Math.max(visibleStart, entry.start), end: Math.min(visibleEnd, entry.end) }))
          .filter(interval => interval.end > interval.start)
          .sort((a, b) => a.start - b.start || a.end - b.end)
          .reduce((merged, interval) => {
            const previous = merged[merged.length - 1];
            if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
            else merged.push({ ...interval });
            return merged;
          }, []);
        const freeIntervals = [];
        let cursor = visibleStart;
        occupied.forEach(interval => {
          if (interval.start > cursor) freeIntervals.push({ start: cursor, end: interval.start });
          cursor = Math.max(cursor, interval.end);
        });
        if (cursor < visibleEnd) freeIntervals.push({ start: cursor, end: visibleEnd });
        const contentInterval = freeIntervals.sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
        const startsAtParentTop = contentInterval?.start === visibleStart;
        const headerReserve = startsAtParentTop ? 13 : 0;
        const contentTop = contentInterval ? (contentInterval.start - visibleStart) / 60 * hourHeight + headerReserve : 0;
        const contentHeight = contentInterval ? Math.max(0, (contentInterval.end - contentInterval.start) / 60 * hourHeight - headerReserve - 2) : 0;
        const contentClass = contentHeight < 8 ? ' content-hidden' : contentHeight < 20 ? ' content-compact' : contentHeight < 38 ? ' content-brief' : '';
        renderedContent = `<span class="calendar-parent-header">${headerMarkup}</span><span class="calendar-parent-content${contentClass}" style="top:${contentTop}px;height:${contentHeight}px">${bodyMarkup}</span>`;
      }
      return `<div class="calendar-block type-${item.type || 'spot'} ${classify(item)}${compactClass}${shortClass}${tallClass}${roomyClass}${nestingClass}${state.selectedIndex === item.index ? ' selected' : ''}${selectedScheduleIndexes.has(item.index) ? ' batch-selected' : ''}" data-nesting-depth="${depth}" data-compact-label="${escapeHtml(`${label} · ${item.title}`)}" title="${escapeHtml(tooltip)}" draggable="true" data-schedule-index="${item.index}" style="top:${top}px;height:${height}px;left:${left};right:auto;width:${width};z-index:${depth + 1}">${renderedContent}</div>`;
    }).join('');
    return `<div class="calendar-day" data-date="${date}">${blocks}</div>`;
  }).join('');
  const gridWidth = schedulePanel.classList.contains('is-expanded') || selected ? '100%' : `${Math.max(520, 64 + dates.length * 220)}px`;
  schedule.innerHTML = `<div class="schedule-scroll"><div class="calendar-grid" style="--days:${dates.length};--grid-width:${gridWidth};--hour-height:${hourHeight}px;--half-hour-height:${hourHeight / 2}px;--calendar-height:${hourHeight * visibleHours}px;--calendar-font-scale:${calendarFontScale}"><div class="calendar-corner"></div>${header}<div class="time-rail">${rail}</div>${columns}</div></div>`;
  if (previousScroll) {
    const nextScroll = schedule.querySelector('.schedule-scroll');
    if (nextScroll) { nextScroll.scrollLeft = previousScroll.left; nextScroll.scrollTop = previousScroll.top; }
  }
  $('#scheduleHint').textContent = `${entries.length} 项安排`;
  bindScheduleSelection();
}
let scheduleResizeTimer;
new ResizeObserver(() => {
  clearTimeout(scheduleResizeTimer);
  scheduleResizeTimer = setTimeout(() => {
    if (!state.schedule.length) return;
    const nextHeight = scheduleHourHeight();
    if (Number($('#schedule').dataset.hourHeight) !== nextHeight) { renderSchedule(state.schedule); applyDayFilter(); }
  }, 80);
}).observe(schedulePanel);
function renderManualSchedule() {
  const entries = [...itemsEl.children].map(values).filter(item => item.date && item.startTime).map(item => ({ date: item.date, start: item.startTime, end: item.endTime, title: item.name || item.address, detail: item.note || '' }));
  renderSchedule(entries);
}
function applyDayFilter() {
  const selected = state.dayFilter;
  [...itemsEl.children].forEach(node => { node.hidden = Boolean(selected && $('.date', node).value !== selected); });
}
function revealCorrespondingNode(node) {
  if (!node) return;
  document.querySelectorAll('.item.selected').forEach(item => item.classList.remove('selected'));
  node.classList.add('selected');
  node.classList.remove('jump-highlight'); requestAnimationFrame(() => node.classList.add('jump-highlight')); setTimeout(() => node.classList.remove('jump-highlight'), 900);
  const aside = node.closest('aside');
  aside?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (aside) aside.scrollTo({ top: Math.max(0, node.offsetTop - aside.offsetTop - aside.clientHeight / 2 + node.offsetHeight / 2), behavior: 'smooth' });
}
async function focusNode(node) {
  const index = Number(node.dataset.scheduleIndex); if (Number.isInteger(index)) state.selectedIndex = index;
  document.querySelectorAll('.item.selected').forEach(item => item.classList.remove('selected'));
  node.classList.add('selected');
  document.querySelectorAll('.calendar-block').forEach(block => block.classList.toggle('selected', Number(block.dataset.scheduleIndex) === state.selectedIndex));
  const item = values(node);
  if (!item.address || !map) return;
  try {
    const point = await geocode(item.address, item.name);
    const [lng, lat] = mapCoords(...point.location.split(',').map(Number));
    if (routeLayer) map.removeLayer(routeLayer);
    routeLayer = L.layerGroup().addTo(map);
    const color = markerColors[item.type] || markerColors.spot;
    L.circleMarker([lat, lng], { radius: 14, color: '#fff', weight: 6, fillColor: color, fillOpacity: .95, interactive: false, className: 'selected-map-point' }).addTo(routeLayer);
    setOverviewFocusOpacity(true);
    fitSelectionWithDayContext(L.latLngBounds([[lat, lng]]), 12);
    L.popup().setLatLng([lat, lng]).setContent(`<b>${escapeHtml(item.name)}</b><br>${escapeHtml(item.address)}`).openOn(map);
  } catch { /* 地址尚未能定位时保留节点选中状态 */ }
}
async function showDriveSegment(index) {
  const entry = state.schedule[index];
  const eventLinks = entry.routeLinks || {};
  const sharedRoute = routeForScheduleEvent(entry);
  const links = sharedRoute ? { ...eventLinks, ...sharedRoute, routeId: sharedRoute.id } : eventLinks;
  const selectedOrigin = state.locations.find(place => place.id === links.originPlaceId && place.address);
  const selectedDestination = state.locations.find(place => place.id === links.destinationPlaceId && place.address);
  const customOrigin = links.customOrigin?.address ? links.customOrigin : null;
  const customDestination = links.customDestination?.address ? links.customDestination : null;
  const origin = selectedOrigin || customOrigin;
  const destination = selectedDestination || customDestination;
  const waypoints = (links.viaPlaceIds || []).map(placeId => state.locations.find(place => place.id === placeId)).filter(place => place?.address);
  const stops = [origin, ...waypoints, destination].filter(Boolean);
  if (!origin || !destination) { $('#routeDetail').textContent = '该路程尚未明确设置起点和终点。请点击“编辑事件 / 关联地点”，从地点库选择或自定义填写。'; return; }
  const record = sharedRoute?.amap;
  if (record?.steps?.length) {
    const locations = stops.map(stop => stop.resolved?.location).filter(Boolean);
    showRouteOnMap(record, locations, stops.map(stop => ({ ...stop, name: stop.title || stop.name })), { name: sharedRoute?.name || entry.title, routeId: sharedRoute?.id, amap: record });
    showSavedDriveInfo(entry);
    return record;
  }
  if (isShareMode) { showSavedDriveInfo(entry); return null; }
  return calculateDriveRoute(stops, sharedRoute, entry.title, false, links.travelMode, links.transportMode, links.transit);
}
async function calculateDriveRoute(stops, sharedRoute, routeName, persist = true, travelMode = 'recommended', transportMode = 'driving', transit = {}) {
  $('#routeDetail').textContent = '正在调用高德计算此段路线…';
  try {
    const travel = driveTravelMeta(travelMode);
    const transport = normalizedTransportMode(transportMode);
    const geos = await Promise.all(stops.map(stop => geocode(stop.address, stop.title || stop.name)));
    const paths = [];
    for (let i = 1; i < geos.length; i += 1) { const response = await fetch('/api/route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ origin: geos[i - 1].location, destination: geos[i].location, mode: transport, strategy: travel.strategy, city: transit?.city, cityd: transit?.cityd }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); paths.push(data.route.paths[0]); await pause(400); }
    const path = { duration: paths.reduce((sum, item) => sum + Number(item.duration), 0), distance: paths.reduce((sum, item) => sum + Number(item.distance), 0), tolls: paths.reduce((sum, item) => sum + Number(item.tolls || 0), 0), tollDistance: paths.reduce((sum, item) => sum + Number(item.toll_distance || 0), 0), steps: paths.flatMap(item => item.steps) };
    $('#duration').textContent = fmt(Number(path.duration)); $('#distance').textContent = `${(Number(path.distance) / 1000).toFixed(1)} 公里 · 此段路程`;
    const buffer = Number(state.preferences.buffer || 30);
    const queriedAt = new Date(); const isNightQuery = queriedAt.getHours() >= 21 || queriedAt.getHours() < 7;
    const amapRecord = { distance: path.distance, duration: path.duration, tolls: path.tolls, tollDistance: path.tollDistance, transportMode: transport, travelMode: normalizedTravelMode(travelMode), strategy: travel.strategy, queriedAt: queriedAt.toISOString(), queryPeriod: isNightQuery ? 'night' : 'day', engine: 'amap-v5', steps: path.steps.map(step => ({ polyline: step.polyline || '' })) };
    path.amap = amapRecord;
    showRouteOnMap(path, geos.map(item => item.location), stops.map(item => ({ ...item, name: item.title || item.name })), { name: sharedRoute?.name || routeName, routeId: sharedRoute?.id, amap: amapRecord });
    const tollText = transport === 'driving' ? `，过路费约 ${path.tolls.toFixed(0)} 元${path.tollDistance ? `（收费路段 ${(path.tollDistance / 1000).toFixed(1)} 公里）` : ''}` : '';
    const notice = transport === 'driving' ? `高德普通驾车接口不能指定未来出发时刻；夜间封闭、季节管制和临时交通规则可能使查询路线绕行。这里的时间仅作最低参考，按当前“${escapeHtml(state.preferences.pace)}”节奏建议额外预留 ${buffer} 分钟，并在实际出发前重新导航确认。` : '该结果为高德当前可用方案参考，实际步行、骑行或公共交通请以出发时导航与班次为准。';
    $('#routeDetail').innerHTML = `<b>${stops.map(stop => escapeHtml(stop.title || stop.name)).join(' → ')}</b><br>${escapeHtml(transport === 'driving' ? travel.label : transportModeMeta(transport).label)}：${(Number(path.distance) / 1000).toFixed(1)} 公里，预计 ${fmt(Number(path.duration))}${tollText}。<small>查询于 ${queriedAt.toLocaleString('zh-CN')}${transport === 'driving' && isNightQuery ? '（夜间查询）' : ''}。${notice}</small>`;
    if (sharedRoute && persist) { sharedRoute.amap = amapRecord; save(); renderRouteTotals(); }
    return path;
  } catch (error) { $('#routeDetail').textContent = error.message || '该路程暂时无法计算。'; }
}
function showSavedDriveInfo(entry) {
  const route = routeForScheduleEvent(entry);
  const links = route ? { ...entry.routeLinks, ...route } : entry.routeLinks || {};
  const origin = state.locations.find(place => place.id === links.originPlaceId) || links.customOrigin;
  const destination = state.locations.find(place => place.id === links.destinationPlaceId) || links.customDestination;
  const record = route?.amap;
  const title = `${origin?.name || '起点'} → ${destination?.name || '终点'}`;
  if (!record) { $('#routeDetail').innerHTML = `<b>${escapeHtml(title)}</b><small>该路线尚未保存高德查询结果；请在编辑事件中点击“获取高德路线”。</small>`; return; }
  const transportMode = normalizedTransportMode(links.transportMode || record.transportMode);
  const modeLabel = transportMode === 'driving' ? driveTravelMeta(links.travelMode || record.travelMode).label : transportModeMeta(transportMode).label;
  const tollText = transportMode === 'driving' ? ` · 过路费约 ${Number(record.tolls || 0).toFixed(0)} 元` : '';
  $('#routeDetail').innerHTML = `<b>${escapeHtml(entry.title || title)}</b><br><span>${escapeHtml(entry.date || '')}${entry.start ? ` · ${escapeHtml(entry.start)}–${escapeHtml(entry.end || '')}` : ''}</span><br>${escapeHtml(modeLabel)}：${(Number(record.distance || 0) / 1000).toFixed(1)} 公里 · ${fmt(Number(record.duration || 0))}${tollText}。${entry.detail ? `<br><small>${escapeHtml(entry.detail)}</small>` : ''}<small>查询于 ${new Date(record.queriedAt).toLocaleString('zh-CN')}${transportMode === 'driving' && record.queryPeriod === 'night' ? '（夜间结果，建议白天重查）' : ''}；地图点击不会重新计算。</small>`;
}
function showEventDetail(entry, extra = '') {
  const place = state.locations.find(item => item.id === entry.locationId);
  const time = [entry.start, entry.end].filter(Boolean).join('–');
  const lines = [
    `<b>${escapeHtml(entry.title || '未命名事件')}</b>`,
    `<span>${escapeHtml(entry.date || '')}${time ? ` · ${escapeHtml(time)}` : ''} · ${escapeHtml(eventTypeNames[entry.type] || typeNames[entry.type] || '事件')}</span>`,
    place?.name ? `<span>地点：${escapeHtml(place.name)}</span>` : '',
    entry.detail ? `<small>${escapeHtml(entry.detail)}</small>` : '',
    extra
  ].filter(Boolean);
  $('#routeDetail').innerHTML = lines.join('<br>');
}
async function focusScheduleEvent(index, { skipDriveQuery = false } = {}) {
  const entry = state.schedule[index]; if (!entry) return;
  state.selectedIndex = index;
  mapFocusDate = entry.date || '';
  renderMapRouteLegend(entry.date);
  const node = [...itemsEl.children].find(item => Number(item.dataset.scheduleIndex) === index);
  document.querySelectorAll('.calendar-block').forEach(block => block.classList.toggle('selected', Number(block.dataset.scheduleIndex) === index));
  // 当天总览已存在时不重建所有点线，卡片切换仅更新高亮图层。
  if (renderedOverviewDate !== (entry.date || '')) await showDayOverview(entry.date);
  if (state.selectedIndex !== index) return;
  $('#mapDayFilter').value = entry.date;
  if (entry.type === 'flight') {
    await showFlightOnMap(index);
  } else if (entry.type === 'drive' || /驾驶|前往|返回|继续|返程|至/.test(entry.title)) {
    if (skipDriveQuery) showSavedDriveInfo(entry);
    else await showDriveSegment(index);
  }
  else if (entry.locationId && state.locations.find(place => place.id === entry.locationId)?.address) {
    const place = state.locations.find(item => item.id === entry.locationId);
    try {
      const point = place.resolved?.location ? place.resolved : (isShareMode ? null : await geocode(place.address, place.name));
      if (!point?.location) { $('#routeDetail').innerHTML = `<b>${escapeHtml(entry.title)}</b><small>共享版本中尚未保存该地点坐标。</small>`; return; }
      if (state.selectedIndex !== index) return;
      const [lng, lat] = mapCoords(...point.location.split(',').map(Number));
      if (routeLayer) map.removeLayer(routeLayer);
      routeLayer = L.layerGroup().addTo(map);
      const color = markerColors[entry.type] || markerColors.spot;
      L.circleMarker([lat, lng], { radius: 14, color: '#fff', weight: 6, fillColor: color, fillOpacity: .95, interactive: false, className: 'selected-map-point' }).addTo(routeLayer);
      setOverviewFocusOpacity(true);
      fitSelectionWithDayContext(L.latLngBounds([[lat, lng]]), 12);
      L.popup().setLatLng([lat, lng]).setContent(`<b>${escapeHtml(entry.title)}</b><br>关联地点：${escapeHtml(place.name)}`).openOn(map);
    } catch { /* 地点无法解析时仍保留当天地图总览。 */ }
    showEventDetail(entry, `<small>已定位关联地点：${escapeHtml(place.name)}。</small>`);
  } else if (node) { focusNode(node); showEventDetail(entry, '<small>这是时间事件；关联具体地点后即可在地图中定位。</small>'); }
}
function updateEditorRouteQueryState(route) {
  const button = $('#resolveEditorRoute'), status = $('#editorRouteStatus'), record = route?.amap;
  if (!record?.queriedAt) {
    button.textContent = '获取高德路线';
    status.hidden = true; status.textContent = '';
    return;
  }
  button.textContent = '重新生成高德路线';
  status.hidden = false;
  const transportMode = normalizedTransportMode(route?.transportMode || record.transportMode);
  const modeLabel = transportMode === 'driving' ? driveTravelMeta(route?.travelMode || record.travelMode).label : transportModeMeta(transportMode).label;
  const tollText = transportMode === 'driving' ? ` · 过路费约 ${Number(record.tolls || 0).toFixed(0)} 元` : '';
  status.textContent = `现有高德结果：${modeLabel} · ${(Number(record.distance || 0) / 1000).toFixed(1)} 公里 · ${fmt(Number(record.duration || 0))}${tollText} · 查询于 ${new Date(record.queriedAt).toLocaleString('zh-CN')}${transportMode === 'driving' && record.queryPeriod === 'night' ? '（夜间结果，建议白天重查）' : ''}`;
}
function updateEditorFieldVisibility() {
  const type = $('#editorType').value, isDrive = type === 'drive', isFlight = type === 'flight';
  routeEditorSection.hidden = !isDrive;
  if (isDrive) routeEditorSection.open = true;
  flightFields.hidden = !isFlight;
  eventLocationField.hidden = isDrive || isFlight;
  weatherFields.hidden = false;
  $('#editorAddress').closest('label').hidden = isFlight;
  if (!isDrive) pendingEditorRoute = null;
}
function updateRouteTransportModeUi() {
  const mode = normalizedTransportMode($('#routeTransportMode')?.value);
  const isDriving = mode === 'driving', isTransit = mode === 'transit';
  $('#routeTravelModeField').hidden = !isDriving;
  $('#routeTransitCities').hidden = !isTransit;
  $('#routeWaypointsField').hidden = !isDriving;
  $('#addRouteWaypoint').hidden = !isDriving;
  $('#routeWaypointOrder').hidden = !isDriving;
  const hint = $('#routeModeHint');
  if (hint) hint.textContent = isDriving ? '自驾支持途经点和过路费估算；更改方式或策略后请重新获取路线。' : isTransit ? '公共交通需要起点城市；跨城时还需填写终点城市，暂不支持途经点。' : `${transportModeMeta(mode).label}路线按高德当前可用方案计算，暂不支持途经点。`;
}
function updateEditorWeatherState(entry) {
  const status = $('#editorWeatherStatus'), button = $('#queryEditorWeather');
  if (!entry) { status.hidden = true; return; }
  const text = entry.type === 'drive'
    ? [entry.weather?.origin && `起点：${weatherSummary(entry.weather.origin)}`, entry.weather?.destination && `终点：${weatherSummary(entry.weather.destination)}`].filter(Boolean).join('；')
    : entry.type === 'flight'
      ? [entry.weather?.origin && `起飞：${weatherSummary(entry.weather.origin)}`, entry.weather?.destination && `降落：${weatherSummary(entry.weather.destination)}`].filter(Boolean).join('；')
    : (entry.weather?.placeId === entry.locationId ? weatherSummary(entry.weather) : '');
  status.hidden = !text; status.textContent = text;
  button.textContent = text ? '重新查询天气' : '查询天气';
}
let editorWaypointOrder = [];
function renderWaypointOrder() {
  const container = $('#routeWaypointOrder'); if (!container) return;
  container.innerHTML = editorWaypointOrder.map((id, index) => {
    const place = state.locations.find(item => item.id === id);
    const option = [...($('#routeWaypoints')?.options || [])].find(item => item.value === id);
    const label = place ? `${placeTypeName(place.type)} · ${place.name || '未命名地点'}` : (option?.textContent || '未命名地点');
    if (!place && !option) return '';
    return `<div class="waypoint-order-item" data-waypoint-id="${escapeHtml(id)}"><b>${index + 1}</b><span>${escapeHtml(label)}</span><button type="button" data-waypoint-move="up" ${index === 0 ? 'disabled' : ''}>上移</button><button type="button" data-waypoint-move="down" ${index === editorWaypointOrder.length - 1 ? 'disabled' : ''}>下移</button><button type="button" data-waypoint-move="remove">移除</button></div>`;
  }).join('');
  container.querySelectorAll('button[data-waypoint-move]').forEach(button => button.onclick = event => {
    event.preventDefault(); event.stopPropagation();
    const row = button.closest('[data-waypoint-id]'), id = row?.dataset.waypointId, action = button.dataset.waypointMove;
    const index = editorWaypointOrder.indexOf(id); if (index < 0) return;
    if (action === 'remove') editorWaypointOrder.splice(index, 1);
    if (action === 'up' && index > 0) [editorWaypointOrder[index - 1], editorWaypointOrder[index]] = [editorWaypointOrder[index], editorWaypointOrder[index - 1]];
    if (action === 'down' && index < editorWaypointOrder.length - 1) [editorWaypointOrder[index + 1], editorWaypointOrder[index]] = [editorWaypointOrder[index], editorWaypointOrder[index + 1]];
    [...$('#routeWaypoints').options].forEach(option => { option.selected = editorWaypointOrder.includes(option.value); });
    renderWaypointOrder();
  });
}
$('#routeWaypoints').onchange = () => {
  const selected = [...$('#routeWaypoints').options].filter(option => option.selected).map(option => option.value);
  editorWaypointOrder = [...editorWaypointOrder.filter(id => selected.includes(id)), ...selected.filter(id => !editorWaypointOrder.includes(id))];
  renderWaypointOrder();
};
$('#addRouteWaypoint').onclick = async () => {
  const place = await confirmNewPlace({ type: 'geography', fromEvent: true });
  if (!place) return;
  const select = $('#routeWaypoints');
  if (![...select.options].some(option => option.value === place.id)) select.append(new Option(`${placeTypeName(place.type)} · ${place.name || '未命名地点'}`, place.id));
  select.value = place.id;
  if (!editorWaypointOrder.includes(place.id)) editorWaypointOrder.push(place.id);
  renderWaypointOrder();
};
function bindLocationSearch(inputId, selectId, places = state.locations, onPick = null) {
  const input = $(`#${inputId}`), select = $(`#${selectId}`); if (!input || !select) return;
  const syncInput = () => { const place = places.find(item => item.id === select.value); input.value = place ? `${place.name || ''}${place.address ? ` · ${place.address}` : ''}` : ''; if (place) onPick?.(place); };
  input.oninput = () => {
    const query = input.value.trim().toLowerCase(); if (!query) { select.value = ''; return; }
    const place = places.find(item => { const label = `${item.name || ''} · ${item.address || ''}`.toLowerCase(); return label === query || (item.name || '').toLowerCase() === query || (item.address || '').toLowerCase() === query; });
    if (place) { select.value = place.id; onPick?.(place); }
  };
  input.onchange = () => { const query = input.value.trim().toLowerCase(); const place = places.find(item => `${item.name || ''} · ${item.address || ''}`.toLowerCase() === query || (item.name || '').toLowerCase() === query || (item.address || '').toLowerCase() === query); if (place) { select.value = place.id; onPick?.(place); } else if (!query) select.value = ''; syncInput(); };
  syncInput();
}
function openScheduleEditor(index, isNew = false) {
  if (isShareMode) return;
  const entry = state.schedule[index]; if (!entry) return;
  editingScheduleIndex = index; editingNewEvent = isNew; pendingEditorRoute = null;
  editorDeleteButton.hidden = isNew;
  const node = [...itemsEl.children].find(item => Number(item.dataset.scheduleIndex) === index);
  const item = node ? values(node) : { type: entry.type || 'spot', address: entry.address || '' };
  $('#editorDate').value = entry.date; $('#editorStart').value = entry.start; $('#editorEnd').value = entry.end || ''; $('#editorName').value = entry.title; $('#editorNote').value = entry.detail || ''; $('#editorAddress').value = item.address || ''; $('#editorType').value = item.type || 'spot';
  renderEditorPriceItems(entry.priceInfo);
  const placeOptions = state.locations.map(place => `<option value="${place.id}">${escapeHtml(placeTypeName(place.type))} · ${escapeHtml(place.name || '未命名地点')}${place.address ? '' : '（地址待定）'}</option>`).join('');
  $('#editorPlaceList').innerHTML = state.locations.map(place => `<option value="${escapeHtml(`${place.name || ''}${place.address ? ` · ${place.address}` : ''}`)}"></option>`).join('');
  $('#eventLocation').innerHTML = `<option value="">暂不关联地点</option>${placeOptions}`;
  $('#eventLocation').value = entry.locationId || '';
  $('#routeOrigin').innerHTML = `<option value="">不从地点库选择</option>${placeOptions}`; $('#routeDestination').innerHTML = `<option value="">不从地点库选择</option>${placeOptions}`; $('#routeWaypoints').innerHTML = placeOptions;
  bindLocationSearch('eventLocationSearch', 'eventLocation', state.locations, place => { $('#editorAddress').value = place.address || ''; }); bindLocationSearch('routeOriginSearch', 'routeOrigin'); bindLocationSearch('routeDestinationSearch', 'routeDestination');
  $('#routeLibrarySelect').innerHTML = `<option value="">新建路线 / 暂不选择</option>${state.routes.map(route => `<option value="${route.id}">${escapeHtml(route.name || '未命名路线')}</option>`).join('')}`;
  const eventLinks = entry.routeLinks || {}; const sharedRoute = routeForScheduleEvent(entry); const links = sharedRoute ? { ...eventLinks, ...sharedRoute } : eventLinks;
  editorWaypointOrder = [...(links.viaPlaceIds || [])];
  $('#routeLibrarySelect').value = eventLinks.routeId || ''; $('#routeTransportMode').value = normalizedTransportMode(links.transportMode); $('#routeTravelMode').value = normalizedTravelMode(links.travelMode); $('#routeTransitCity').value = links.transit?.city || ''; $('#routeTransitCityd').value = links.transit?.cityd || ''; $('#routeOrigin').value = links.originPlaceId || ''; $('#routeDestination').value = links.destinationPlaceId || ''; $('#routeOriginName').value = links.customOrigin?.name || ''; $('#routeOriginAddress').value = links.customOrigin?.address || ''; $('#routeDestinationName').value = links.customDestination?.name || ''; $('#routeDestinationAddress').value = links.customDestination?.address || ''; [...$('#routeWaypoints').options].forEach(option => { option.selected = editorWaypointOrder.includes(option.value); }); renderWaypointOrder();
  bindLocationSearch('routeOriginSearch', 'routeOrigin'); bindLocationSearch('routeDestinationSearch', 'routeDestination');
  const flight = entry.flightInfo || {};
  $('#editorFlightNumber').value = flight.flightNumber || ''; $('#editorFlightArrivalDate').value = flight.arrivalDate || entry.date; $('#editorFlightDeparture').value = flight.departureAirport || ''; $('#editorFlightArrival').value = flight.arrivalAirport || ''; $('#editorFlightDepartureTerminal').value = flight.departureTerminal || ''; $('#editorFlightArrivalTerminal').value = flight.arrivalTerminal || '';
  $('#editorFlightStopoverAirport').value = flight.stopoverAirport || ''; $('#editorFlightStopoverArrivalTime').value = flight.stopoverArrivalTime || ''; $('#editorFlightStopoverDepartureTime').value = flight.stopoverDepartureTime || '';
  updateEditorFieldVisibility();
  updateRouteTransportModeUi();
  updateEditorRouteQueryState(sharedRoute);
  updateEditorWeatherState(entry);
  $('#eventEditor').showModal();
}
function cancelScheduleEditor() {
  if (editingNewEvent && Number.isInteger(editingScheduleIndex)) {
    state.schedule.splice(editingScheduleIndex, 1);
    [...itemsEl.children].find(item => Number(item.dataset.scheduleIndex) === editingScheduleIndex)?.remove();
    renderSchedule(state.schedule); applyDayFilter();
  }
  editingNewEvent = false; editingScheduleIndex = null; pendingEditorRoute = null; $('#eventEditor').close();
}
function removeEventFromStoredVersion(versionKey, event) {
  const snapshot = parseStoredJson(versionStorageKey(versionKey), null); if (!snapshot?.schedule) return;
  const removedIndex = snapshot.schedule.findIndex(item => event.sharedId ? item.sharedId === event.sharedId : item.date === event.date && item.start === event.start && item.title === event.title);
  if (removedIndex < 0) return;
  snapshot.schedule.splice(removedIndex, 1);
  snapshot.items = (snapshot.items || []).filter(item => Number(item.scheduleIndex) !== removedIndex && !(item.date === event.date && item.startTime === event.start && item.name === event.title)).map(item => {
    const scheduleIndex = Number(item.scheduleIndex);
    return Number.isInteger(scheduleIndex) && scheduleIndex > removedIndex ? { ...item, scheduleIndex: scheduleIndex - 1 } : item;
  });
  localStorage.setItem(versionStorageKey(versionKey), JSON.stringify(snapshot));
}
function deleteScheduleEvent(index) {
  if (isShareMode) return;
  const event = state.schedule[index]; if (!event || !confirm(`确定删除“${event.title}”吗？\n\n关联的通用地点和通用路线会保留。`)) return;
  if (event.sharedId && !state.plans.length) {
    const shared = readSharedSchedule(); delete shared[event.sharedId];
    localStorage.setItem(sharedScheduleStorageKey, JSON.stringify(shared));
    state.plans.forEach(plan => removeEventFromStoredVersion(plan.id, event));
  }
  state.schedule.splice(index, 1);
  [...itemsEl.children].forEach(node => {
    const scheduleIndex = Number(node.dataset.scheduleIndex);
    if (scheduleIndex === index) node.remove();
    else if (scheduleIndex > index) node.dataset.scheduleIndex = String(scheduleIndex - 1);
  });
  if (state.selectedIndex === index) state.selectedIndex = null;
  else if (state.selectedIndex > index) state.selectedIndex -= 1;
  editingNewEvent = false; editingScheduleIndex = null; pendingEditorRoute = null; $('#eventEditor').close();
  save(); renderSchedule(state.schedule); applyDayFilter(); renderRouteTotals();
  showDayOverview(state.dayFilter);
}
$('#schedule').onclick = event => {
  const block = event.target.closest('[data-schedule-index]');
  if (scheduleSelectionMode) {
    if (suppressScheduleClick) { suppressScheduleClick = false; return; }
    if (block) {
      const index = Number(block.dataset.scheduleIndex);
      schedulePasteAnchor = index;
      schedulePasteTargetId = state.schedule[index]?.sharedId || null;
      schedulePasteTarget = { date: state.schedule[index]?.date, start: state.schedule[index]?.start };
      if (event.shiftKey && Number.isInteger(scheduleSelectionAnchor)) {
        const indexes = [...document.querySelectorAll('.calendar-block')].map(node => Number(node.dataset.scheduleIndex));
        const a = indexes.indexOf(scheduleSelectionAnchor), b = indexes.indexOf(index);
        if (a >= 0 && b >= 0) indexes.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(item => selectedScheduleIndexes.add(item));
      } else if (event.altKey) selectedScheduleIndexes.delete(index);
      else if (event.ctrlKey || event.metaKey) { if (selectedScheduleIndexes.has(index)) selectedScheduleIndexes.delete(index); else selectedScheduleIndexes.add(index); scheduleSelectionAnchor = index; }
      else { selectedScheduleIndexes.clear(); selectedScheduleIndexes.add(index); scheduleSelectionAnchor = index; }
      document.querySelectorAll('.calendar-block').forEach(node => node.classList.toggle('batch-selected', selectedScheduleIndexes.has(Number(node.dataset.scheduleIndex)))); refreshScheduleBatchControls();
    } else {
      selectedScheduleIndexes.clear(); scheduleSelectionAnchor = null; schedulePasteTargetId = null;
      const day = event.target.closest('.calendar-day') || document.elementFromPoint(event.clientX, event.clientY)?.closest('.calendar-day');
      if (day) {
        const hourHeight = scheduleHourHeight(); const rawMinute = 7 * 60 + (event.clientY - day.getBoundingClientRect().top) / hourHeight * 60;
        const candidates = state.schedule.map((entry, index) => ({ entry, index, end: clockToMinute(entry.end || entry.start) })).filter(item => item.entry.date === day.dataset.date && item.end <= rawMinute).sort((a, b) => b.end - a.end);
        const previous = candidates[0];
        schedulePasteAnchor = previous ? previous.index + 1 : state.schedule.findIndex(entry => entry.date === day.dataset.date);
        if (schedulePasteAnchor < 0) schedulePasteAnchor = state.schedule.length;
        schedulePasteTarget = { date: day.dataset.date, start: minuteToClock(previous?.end ?? 7 * 60) };
      } else { schedulePasteAnchor = null; schedulePasteTarget = null; }
      document.querySelectorAll('.calendar-block.batch-selected').forEach(node => node.classList.remove('batch-selected')); refreshScheduleBatchControls();
    }
    if (block) focusScheduleEvent(Number(block.dataset.scheduleIndex));
    return;
  }
  if (block) focusScheduleEvent(Number(block.dataset.scheduleIndex));
};
$('#schedule').ondblclick = event => { const block = event.target.closest('[data-schedule-index]'); if (block) openScheduleEditor(Number(block.dataset.scheduleIndex)); };
$('#schedule').ondragstart = event => {
  if (isShareMode) { event.preventDefault(); return; }
  const block = event.target.closest('.calendar-block'); if (!block) return;
  const index = Number(block.dataset.scheduleIndex);
  const indexes = (selectedScheduleIndexes.has(index) ? [...selectedScheduleIndexes] : [index]).sort((a, b) => clockToMinute(state.schedule[a]?.start) - clockToMinute(state.schedule[b]?.start) || a - b);
  activeScheduleDragIndexes = indexes;
  if (!selectedScheduleIndexes.has(index)) { selectedScheduleIndexes.clear(); selectedScheduleIndexes.add(index); scheduleSelectionAnchor = index; }
  suppressScheduleClick = true;
  event.dataTransfer.setData('text/plain', JSON.stringify(indexes)); event.dataTransfer.effectAllowed = 'move';
  indexes.forEach(item => document.querySelector(`.calendar-block[data-schedule-index="${item}"]`)?.classList.add('dragging'));
};
$('#schedule').ondragend = event => { activeScheduleDragIndexes = []; document.querySelectorAll('.calendar-block.dragging').forEach(item => item.classList.remove('dragging')); document.querySelectorAll('.calendar-day.drop-target,.calendar-drop-preview').forEach(day => day.classList.remove('drop-target') || day.remove()); };
$('#schedule').ondragover = event => {
  const day = event.target.closest('.calendar-day'); if (!day) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.calendar-day.drop-target').forEach(item => item.classList.toggle('drop-target', item === day));
  const indexes = activeScheduleDragIndexes;
  const first = state.schedule[indexes?.[0]]; if (!first) return;
  const hourHeight = scheduleHourHeight(), raw = 7 * 60 + (event.clientY - day.getBoundingClientRect().top) / hourHeight * 60, snapped = snapScheduleDrop(day.dataset.date, raw, indexes || []);
  let preview = day.querySelector('.calendar-drop-preview'); if (!preview) { preview = document.createElement('div'); preview.className = 'calendar-drop-preview'; day.append(preview); }
  const duration = Math.max(5, clockToMinute(first.end || first.start) - clockToMinute(first.start)); const end = Math.min(23 * 60, snapped + duration); preview.textContent = `预计 ${minuteToClock(snapped)}–${minuteToClock(end)}${indexes.length > 1 ? `（${indexes.length} 项）` : ''}`; Object.assign(preview.style, { top: `${(snapped - 7 * 60) / 60 * hourHeight}px`, height: `${Math.max(22, duration / 60 * hourHeight - 2)}px` });
};
$('#schedule').ondrop = event => {
  const day = event.target.closest('.calendar-day'); if (!day) return;
  event.preventDefault(); let indexes = activeScheduleDragIndexes.length ? [...activeScheduleDragIndexes] : null; if (!indexes) { try { indexes = JSON.parse(event.dataTransfer.getData('text/plain')); } catch { indexes = [Number(event.dataTransfer.getData('text/plain'))]; } }
  indexes = indexes.map(Number).filter(index => state.schedule[index]); if (!indexes.length) return;
  scheduleUndoStack.push(JSON.stringify(state.schedule)); if (scheduleUndoStack.length > 20) scheduleUndoStack.shift();
  const bounds = day.getBoundingClientRect(); const startMinute = 7 * 60; const hourHeight = scheduleHourHeight(); const rawMinute = startMinute + (event.clientY - bounds.top) / hourHeight * 60; const nextStart = snapScheduleDrop(day.dataset.date, rawMinute, indexes);
  const anchor = state.schedule[indexes[0]], requestedDelta = nextStart - clockToMinute(anchor.start);
  const groupStart = Math.min(...indexes.map(index => clockToMinute(state.schedule[index].start)));
  const groupEnd = Math.max(...indexes.map(index => clockToMinute(state.schedule[index].end || state.schedule[index].start)));
  const delta = Math.max(7 * 60 - groupStart, Math.min(23 * 60 - groupEnd, requestedDelta));
  indexes.forEach(index => { const entry = state.schedule[index]; const duration = Math.max(5, clockToMinute(entry.end || entry.start) - clockToMinute(entry.start)); const shiftedStart = clockToMinute(entry.start) + delta; entry.date = day.dataset.date; entry.start = minuteToClock(shiftedStart); entry.end = minuteToClock(shiftedStart + duration); updateNodeFromSchedule(index); });
  state.selectedIndex = indexes[0]; save(); renderSchedule(state.schedule); applyDayFilter();
  showDayOverview(state.dayFilter);
};
$('#editorCancel').onclick = cancelScheduleEditor;
editorDeleteButton.onclick = () => deleteScheduleEvent(editingScheduleIndex);
$('#eventEditor').oncancel = event => { event.preventDefault(); cancelScheduleEditor(); };
$('#editorType').onchange = updateEditorFieldVisibility;
$('#routeTransportMode').onchange = updateRouteTransportModeUi;
$('#queryEditorWeather').onclick = () => queryEventWeather(editingScheduleIndex);
$('#routeLibrarySelect').onchange = event => {
  pendingEditorRoute = null;
  const route = state.routes.find(item => item.id === event.target.value); if (!route) return;
  $('#routeTransportMode').value = normalizedTransportMode(route.transportMode);
  $('#routeTravelMode').value = normalizedTravelMode(route.travelMode);
  $('#routeTransitCity').value = route.transit?.city || ''; $('#routeTransitCityd').value = route.transit?.cityd || '';
  $('#routeOrigin').value = route.originPlaceId || ''; $('#routeDestination').value = route.destinationPlaceId || '';
  $('#routeOriginName').value = ''; $('#routeOriginAddress').value = ''; $('#routeDestinationName').value = ''; $('#routeDestinationAddress').value = '';
  editorWaypointOrder = [...(route.viaPlaceIds || [])];
  [...$('#routeWaypoints').options].forEach(option => { option.selected = editorWaypointOrder.includes(option.value); }); renderWaypointOrder();
  updateRouteTransportModeUi();
  updateEditorRouteQueryState(route);
};
$('#resolveEditorPlace').onclick = async event => {
  const index = editingScheduleIndex, entry = state.schedule[index]; if (!entry || ['drive', 'flight'].includes($('#editorType').value)) return;
  const name = $('#editorName').value.trim(), address = $('#editorAddress').value.trim();
  if (!name || !address) { alert('请先填写活动 / 地点名称和地点地址。'); return; }
  const button = event.currentTarget; button.disabled = true; button.textContent = '正在查询高德位置…';
  try {
    let place = state.locations.find(item => item.id === $('#eventLocation').value);
    if (!place) place = findMatchingLocation(state.locations, address, name);
    if (!place) {
      const point = await geocode(address, name);
      place = findMatchingLocation(state.locations, address, name, point.location);
      if (!place) place = await confirmNewPlace({ type: $('#editorType').value, name: suggestedPlaceName(address, point.name, name), address, note: $('#editorNote').value.trim(), fromEvent: true });
      if (!place) { button.textContent = '查询高德位置并关联'; return; }
    } else if (place.address !== address || !place.resolved) {
      place.address = address; delete place.resolved;
      const point = await geocode(place.address, place.name);
      place.resolved = { name: point.name || place.name, address: point.formatted_address || place.address, location: point.location };
    }
    if (normalizePlaceLookup(place.name) === normalizePlaceLookup(name)) place.name = suggestedPlaceName(address, place.resolved?.name, place.name);
    entry.locationId = place.id; entry.address = '';
    if (![...$('#eventLocation').options].some(option => option.value === place.id)) $('#eventLocation').append(new Option(`${placeTypeName(place.type)} · ${place.name}`, place.id));
    $('#eventLocation').value = place.id; save(); renderLocations(); renderSchedule(state.schedule); updateNodeFromSchedule(index); focusScheduleEvent(index);
    button.textContent = '已关联高德位置';
  } catch (error) { alert(error.message || '高德暂时无法查询这个地点。'); button.textContent = '重新查询高德位置'; }
  finally { button.disabled = false; }
};
$('#resolveEditorRoute').onclick = async event => {
  const index = editingScheduleIndex, entry = state.schedule[index]; if (!entry || $('#editorType').value !== 'drive') return;
  const button = event.currentTarget; button.disabled = true; button.textContent = '正在查询地点…';
  try {
    let origin = state.locations.find(place => place.id === $('#routeOrigin').value);
    let destination = state.locations.find(place => place.id === $('#routeDestination').value);
    if (!origin) {
      const name = $('#routeOriginName').value.trim(), address = $('#routeOriginAddress').value.trim();
      if (!name || !address) throw new Error('请从地点库选择起点，或完整填写自定义起点名称和地址。');
      origin = await resolveInlinePlace(name, address);
    }
    if (!destination) {
      const name = $('#routeDestinationName').value.trim(), address = $('#routeDestinationAddress').value.trim();
      if (!name || !address) throw new Error('请从地点库选择终点，或完整填写自定义终点名称和地址。');
      destination = await resolveInlinePlace(name, address);
    }
    if (!origin.address || !destination.address) throw new Error('起点和终点必须先填写详细地址。');
    [[$('#routeOrigin'), origin], [$('#routeDestination'), destination]].forEach(([select, place]) => {
      if (![...select.options].some(option => option.value === place.id)) select.append(new Option(`${placeTypeName(place.type)} · ${place.name}`, place.id));
      select.value = place.id;
    });
    const transportMode = normalizedTransportMode($('#routeTransportMode').value);
    const viaPlaceIds = transportMode === 'driving' ? [...editorWaypointOrder] : [];
    const transit = transportMode === 'transit' ? { city: $('#routeTransitCity').value.trim(), cityd: $('#routeTransitCityd').value.trim() } : undefined;
    if (transportMode === 'transit' && !transit.city) throw new Error('公共交通请填写公交起点城市。');
    const links = { originPlaceId: origin.id, destinationPlaceId: destination.id, viaPlaceIds, transportMode, travelMode: normalizedTravelMode($('#routeTravelMode').value), transit };
    const selectedRoute = state.routes.find(item => item.id === $('#routeLibrarySelect').value);
    const routeName = $('#editorName').value.trim() || `${origin.name} → ${destination.name}`;
    button.textContent = selectedRoute?.amap ? '正在重新生成高德路线预览…' : '正在获取高德路线预览…';
    const waypoints = viaPlaceIds.map(placeId => state.locations.find(place => place.id === placeId)).filter(place => place?.address);
    const path = await calculateDriveRoute([origin, ...waypoints, destination], null, routeName, false, links.travelMode, links.transportMode, links.transit);
    if (!path) throw new Error('高德暂时无法生成这条路线。');
    pendingEditorRoute = { links, name: routeName, amap: path.amap };
    updateEditorRouteQueryState({ amap: path.amap });
    $('#editorRouteStatus').textContent += ' · 预览结果，点击“保存更新”后才会覆盖';
  } catch (error) { alert(error.message || '高德暂时无法生成这条路线。'); button.textContent = '重新获取高德路线'; }
  finally { button.disabled = false; }
};
$('#editorForm').onsubmit = async event => {
  event.preventDefault(); const index = editingScheduleIndex; if (!Number.isInteger(index) || !state.schedule[index]) return;
  const type = $('#editorType').value; const transportMode = normalizedTransportMode($('#routeTransportMode').value); let routeLinks = type === 'drive' ? { originPlaceId: $('#routeOrigin').value || undefined, destinationPlaceId: $('#routeDestination').value || undefined, customOrigin: $('#routeOriginAddress').value.trim() ? { name: $('#routeOriginName').value.trim() || '自定义起点', address: $('#routeOriginAddress').value.trim() } : undefined, customDestination: $('#routeDestinationAddress').value.trim() ? { name: $('#routeDestinationName').value.trim() || '自定义终点', address: $('#routeDestinationAddress').value.trim() } : undefined, viaPlaceIds: transportMode === 'driving' ? [...editorWaypointOrder] : [], transportMode, travelMode: normalizedTravelMode($('#routeTravelMode').value), transit: transportMode === 'transit' ? { city: $('#routeTransitCity').value.trim(), cityd: $('#routeTransitCityd').value.trim() } : undefined } : undefined;
  let title = $('#editorName').value.trim(); const address = $('#editorAddress').value.trim();
  let locationId = type === 'drive' || type === 'flight' ? undefined : ($('#eventLocation').value || undefined);
  if (type !== 'drive' && type !== 'flight' && address) {
    let place = state.locations.find(item => item.id === locationId);
    if (!place) {
      place = findMatchingLocation(state.locations, address, title);
      if (!place) {
        let point;
        try { point = await geocode(address, title); }
        catch (error) { alert(error.message || '高德暂时无法确认该地点，请检查地址后重试。'); return; }
        place = findMatchingLocation(state.locations, address, title, point.location);
        if (!place) place = await confirmNewPlace({ type, name: suggestedPlaceName(address, point.name, title || address), address, note: $('#editorNote').value.trim(), fromEvent: true });
        if (!place) return;
      }
      locationId = place.id;
    }
    if (place.address !== address || !place.resolved) {
      place.address = address; delete place.resolved;
      try { const point = await geocode(place.address, place.name); place.resolved = { name: point.name || place.name, address: point.formatted_address || place.address, location: point.location }; }
      catch (error) { alert(error.message || '高德暂时无法确认该地点，请检查地址后重试。'); return; }
    }
    if (normalizePlaceLookup(place.name) === normalizePlaceLookup(title)) place.name = suggestedPlaceName(address, place.resolved?.name, place.name);
  }
  if (routeLinks?.originPlaceId && routeLinks?.destinationPlaceId) {
    const route = upsertUniversalRoute(title, routeLinks);
    if (pendingEditorRoute && routeSignature(pendingEditorRoute.links) === routeSignature(routeLinks)) route.amap = { ...pendingEditorRoute.amap };
    routeLinks = { ...routeLinks, routeId: route.id };
  }
  const flightInfo = type === 'flight' ? { flightNumber: $('#editorFlightNumber').value.trim().toUpperCase(), departureAirport: $('#editorFlightDeparture').value.trim(), arrivalAirport: $('#editorFlightArrival').value.trim(), departureTerminal: $('#editorFlightDepartureTerminal').value.trim(), arrivalTerminal: $('#editorFlightArrivalTerminal').value.trim(), arrivalDate: $('#editorFlightArrivalDate').value || $('#editorDate').value, stopoverAirport: $('#editorFlightStopoverAirport').value.trim(), stopoverArrivalTime: $('#editorFlightStopoverArrivalTime').value, stopoverDepartureTime: $('#editorFlightStopoverDepartureTime').value, source: 'manual' } : undefined;
  if (flightInfo?.stopoverAirport && (!flightInfo.stopoverArrivalTime || !flightInfo.stopoverDepartureTime)) { alert('填写经停机场后，请同时填写经停到达和再次起飞时间。'); return; }
  if (flightInfo && (flightInfo.arrivalDate < $('#editorDate').value || (flightInfo.arrivalDate === $('#editorDate').value && clockToMinute($('#editorEnd').value) <= clockToMinute($('#editorStart').value)))) { alert('航班到达日期和时间必须晚于起飞日期和时间。'); return; }
  if (flightInfo?.flightNumber && flightInfo.departureAirport && flightInfo.arrivalAirport) title = `${flightInfo.flightNumber} ${flightInfo.departureAirport} → ${flightInfo.arrivalAirport}`;
  const priceInfo = collectEditorPriceInfo();
  const updated = { ...state.schedule[index], date: $('#editorDate').value, start: $('#editorStart').value, end: $('#editorEnd').value, title, detail: $('#editorNote').value, address: '', type, locationId, routeLinks, flightInfo, priceInfo };
  if (type === 'flight') { try { await linkFlightAirports(updated); } catch (error) { alert(error.message || '暂时无法确认机场位置，请检查机场名称后重试。'); return; } }
  state.schedule[index] = updated;
  const node = [...itemsEl.children].find(item => Number(item.dataset.scheduleIndex) === index);
  if (node) updateNodeFromSchedule(index);
  save(); renderLocations(); renderSchedule(state.schedule); applyDayFilter(); renderRouteTotals(); $('#eventEditor').close();
  editingNewEvent = false; editingScheduleIndex = null; pendingEditorRoute = null;
  focusScheduleEvent(index); await showDayOverview(state.dayFilter);
};
$('#addScheduleBtn').onclick = () => {
  const date = state.dayFilter || state.schedule[0]?.date || '2026-08-15';
  const entry = { date, start: '09:00', end: '10:00', title: '新安排', detail: '', address: '', type: 'spot', ...(date < '2026-08-20' ? { sharedId: `shared-new-${crypto.randomUUID()}` } : {}) };
  const index = state.schedule.length; state.schedule.push(entry);
  addItem({ type: entry.type, date: entry.date, startTime: entry.start, endTime: entry.end, name: entry.title, address: '', note: '', scheduleIndex: index });
  renderSchedule(state.schedule); applyDayFilter(); openScheduleEditor(index, true);
};
const flightImporter = $('#flightImporter');
$('#importFlightBtn').onclick = () => {
  $('#flightImportForm').reset();
  $('#flightDate').value = state.dayFilter || state.schedule[0]?.date || new Date().toISOString().slice(0, 10);
  $('#flightArrivalDate').value = $('#flightDate').value;
  flightImporter.showModal();
  requestAnimationFrame(() => $('#flightNumber').focus());
};
$('#flightImportCancel').onclick = () => flightImporter.close();
flightImporter.oncancel = event => { event.preventDefault(); flightImporter.close(); };
$('#flightImportForm').onsubmit = async event => {
  event.preventDefault();
  const date = $('#flightDate').value, arrivalDate = $('#flightArrivalDate').value, start = $('#flightDepartureTime').value, end = $('#flightArrivalTime').value;
  const flightNumber = $('#flightNumber').value.trim().toUpperCase(), departureAirport = $('#flightDeparture').value.trim(), arrivalAirport = $('#flightArrival').value.trim();
  if (!date || !arrivalDate || !start || !end || !flightNumber || !departureAirport || !arrivalAirport) return;
  if (arrivalDate < date || (arrivalDate === date && clockToMinute(end) <= clockToMinute(start))) { alert('到达日期和时间必须晚于起飞日期和时间。'); return; }
  const departureTerminal = $('#flightDepartureTerminal').value.trim(), arrivalTerminal = $('#flightArrivalTerminal').value.trim(), note = $('#flightNote').value.trim();
  const stopoverAirport = $('#flightStopoverAirport').value.trim(), stopoverArrivalTime = $('#flightStopoverArrivalTime').value, stopoverDepartureTime = $('#flightStopoverDepartureTime').value;
  if (stopoverAirport && (!stopoverArrivalTime || !stopoverDepartureTime)) { alert('填写经停机场后，请同时填写经停到达和再次起飞时间。'); return; }
  const terminalText = [departureTerminal ? `出发 ${departureTerminal}` : '', arrivalTerminal ? `到达 ${arrivalTerminal}` : ''].filter(Boolean).join(' · ');
  const entry = { date, start, end, title: `${flightNumber} ${departureAirport} → ${arrivalAirport}`, detail: [terminalText, note].filter(Boolean).join('；'), address: '', type: 'flight', flightInfo: { flightNumber, departureAirport, arrivalAirport, departureTerminal, arrivalTerminal, arrivalDate, stopoverAirport, stopoverArrivalTime, stopoverDepartureTime, source: 'manual' }, ...(date < '2026-08-20' ? { sharedId: `shared-flight-${crypto.randomUUID()}` } : {}) };
  const submit = event.submitter; if (submit) { submit.disabled = true; submit.textContent = '正在查询机场位置…'; }
  try { await linkFlightAirports(entry); }
  catch (error) { alert(error.message || '暂时无法确认机场位置，请检查机场名称后重试。'); if (submit) { submit.disabled = false; submit.textContent = '确认导入'; } return; }
  const index = state.schedule.length; state.schedule.push(entry);
  addItem({ type: entry.type, date, startTime: start, endTime: end, name: entry.title, address: '', note: entry.detail, scheduleIndex: index });
  save(); renderLocations(); renderSchedule(state.schedule); applyDayFilter(); flightImporter.close(); if (submit) { submit.disabled = false; submit.textContent = '确认导入'; } focusScheduleEvent(index);
};
$('#addBtn').onclick=()=>addItem();
$('#tripName').oninput = () => {
  const plan = state.plans.find(item => item.id === state.versionKey);
  if (plan) plan.name = $('#tripName').value.trim() || '未命名计划';
  renderPlanSelect(); save();
};
$('#addPlaceBtn').onclick = async () => {
  const place = await confirmNewPlace({ type: placeTypeFilter || 'spot' });
  if (!place) return;
  $(`.place-card[data-place-id="${place.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
};
$('#addPlaceCategoryBtn').onclick = () => {
  $('#placeCategoryEditorForm').reset();
  $('#newPlaceCategoryColor').value = '#2f73a9';
  placeCategoryEditor.showModal();
  requestAnimationFrame(() => $('#newPlaceCategoryName').focus());
};
$('#placeCategoryEditorCancel').onclick = () => placeCategoryEditor.close();
placeCategoryEditor.oncancel = event => { event.preventDefault(); placeCategoryEditor.close(); };
$('#placeCategoryEditorForm').onsubmit = event => {
  event.preventDefault();
  const name = $('#newPlaceCategoryName').value.trim();
  if (!name) { $('#newPlaceCategoryName').focus(); return; }
  if (customPlaceCategories().some(category => category.name === name)) { alert('当前计划已经有同名地点类别。'); return; }
  const category = { id: `custom-${crypto.randomUUID().slice(0, 8)}`, name, color: normalizeCategoryColor($('#newPlaceCategoryColor').value) };
  state.placeCategories.push(category);
  save(); renderLocations(); showDayOverview(state.dayFilter);
  placeCategoryEditor.close();
};
function cancelPlaceConfirmation() {
  placeEditor.close();
  pendingPlaceConfirmation?.(null); pendingPlaceConfirmation = null;
}
$('#placeEditorCancel').onclick = cancelPlaceConfirmation;
placeEditor.oncancel = event => { event.preventDefault(); cancelPlaceConfirmation(); };
$('#placeEditorForm').onsubmit = async event => {
  event.preventDefault();
  const name = $('#newPlaceName').value.trim();
  if (!name) { $('#newPlaceName').focus(); return; }
  const photoFile = $('#newPlacePhoto').files[0];
  const draft = { type: $('#newPlaceType').value, name, address: $('#newPlaceAddress').value.trim(), note: $('#newPlaceNote').value.trim(), ...(photoFile ? { photo: await fileToDataUrl(photoFile) } : {}) };
  const submit = event.submitter; if (submit) { submit.disabled = true; submit.textContent = draft.address ? '保存并查询高德…' : '正在保存…'; }
  let place = findMatchingLocation(state.locations, draft.address, draft.name);
  if (!place) place = { id: crypto.randomUUID(), ...draft };
  else Object.assign(place, draft);
  if (draft.address) {
    try {
      const point = await geocode(draft.address, draft.name);
      const samePointPlace = findMatchingLocation(state.locations, draft.address, draft.name, point.location);
      if (samePointPlace && samePointPlace.id !== place.id) { Object.assign(samePointPlace, draft); place = samePointPlace; }
      place.resolved = { name: point.name || draft.name, address: point.formatted_address || draft.address, location: point.location };
    }
    catch (error) { alert(error.message || '高德暂时无法确认该地点，请检查名称和完整地址后重试。'); if (submit) { submit.disabled = false; submit.textContent = '保存地点'; } return; }
  }
  if (!state.locations.some(item => item.id === place.id)) state.locations.push(place);
  save();
  renderLocations(); placeEditor.close();
  if (submit) { submit.disabled = false; submit.textContent = '保存地点'; }
  pendingPlaceConfirmation?.(place); pendingPlaceConfirmation = null;
};
$('#placeLibraryBtn').onclick = () => { locationsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' }); locationsPanel.classList.remove('jump-highlight'); requestAnimationFrame(() => locationsPanel.classList.add('jump-highlight')); };
$('#placeSearch').oninput = event => { placeSearchText = event.target.value.trim(); renderLocations(); };
$('#placeTypeFilter').onchange = event => { placeTypeFilter = event.target.value; renderLocations(); };
$('#selectAllPlaces').onclick = () => {
  const visibleCards = [...$('#places').querySelectorAll('.place-card')];
  const shouldSelect = visibleCards.some(card => !selectedPlaceIds.has(card.dataset.placeId));
  visibleCards.forEach(card => shouldSelect ? selectedPlaceIds.add(card.dataset.placeId) : selectedPlaceIds.delete(card.dataset.placeId));
  renderLocations();
};
$('#deleteSelectedPlaces').onclick = () => {
  if (!selectedPlaceIds.size) { alert('请先勾选需要删除的地点。'); return; }
  if (confirm(`确定删除选中的 ${selectedPlaceIds.size} 个地点吗？相关事件和路程关联也会解除。`)) removeLocations(new Set(selectedPlaceIds));
};
$('#resolveSelectedPlaces').onclick = async event => {
  const selected = state.locations.filter(place => selectedPlaceIds.has(place.id));
  if (!selected.length) { alert('请先勾选需要查询的地点。'); return; }
  const missing = selected.filter(place => !place.name || !place.address);
  if (missing.length) { alert(`有 ${missing.length} 个地点缺少名称或地址，请补全后再查询。`); return; }
  const button = event.currentTarget; button.disabled = true; button.textContent = `正在查询 0/${selected.length}`;
  let completed = 0, failed = 0;
  for (const place of selected) {
    try { const point = await geocode(place.address, place.name); place.resolved = { name: point.name || place.name, address: point.formatted_address || place.address, location: point.location }; }
    catch { failed += 1; }
    completed += 1; button.textContent = `正在查询 ${completed}/${selected.length}`;
  }
  save(); renderLocations(); button.disabled = false; button.textContent = '批量查询位置';
  $('#distance').textContent = `地点库已查询 ${completed - failed} 个位置${failed ? `，${failed} 个未找到` : ''}`;
};
$('#batchAddPlaces').onclick = () => {
  const typeMap = { '景点': 'spot', '地名': 'geography', '地点': 'geography', '城市': 'geography', '饮食': 'food', '餐饮': 'food', '住宿': 'hotel', '酒店': 'hotel', '机场': 'flight', '服务区': 'service', '加油站': 'fuel', '补给': 'supply', '交通': 'transport' };
  const lines = $('#batchPlaceInput').value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) { alert('请先粘贴要新增的地点。'); return; }
  const parsed = lines.map((line, index) => {
    const [typeLabel = '景点', name = '', ...addressParts] = line.split(/[｜|]/).map(part => part.trim());
    return { line: index + 1, type: typeMap[typeLabel] || 'spot', name, address: addressParts.join('｜') };
  });
  const invalid = parsed.filter(place => !place.name);
  if (invalid.length) { alert(`第 ${invalid.map(place => place.line).join('、')} 行缺少地点名称。`); return; }
  parsed.forEach(place => state.locations.push({ id: crypto.randomUUID(), type: place.type, name: place.name, address: place.address, note: '' }));
  $('#batchPlaceInput').value = ''; save(); renderLocations();
};
document.querySelector('#exportBtn').onclick=()=>{ const b=new Blob([JSON.stringify({name:$('#tripName').value,items:[...itemsEl.children].map(values),schedule:state.schedule,locations:state.locations,routes:state.routes,preferences:state.preferences,placeModelVersion:1,routeLinkModeVersion:1},null,2)],{type:'application/json'});const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(b),download:'roadtrip.json'});a.click();URL.revokeObjectURL(a.href); };
function changeDayFilter(value) {
  state.dayFilter = value;
  state.selectedIndex = null;
  mapFocusDate = '';
  state.schedule.length ? renderSchedule(state.schedule) : renderManualSchedule();
  applyDayFilter();
  renderRouteTotals();
  showDayOverview(state.dayFilter);
}
$('#dayFilter').onchange = event => changeDayFilter(event.target.value);
$('#mapDayFilter').onchange = event => changeDayFilter(event.target.value);
$('#planSelect').onchange = async e => {
  const key = e.target.value;
  loadPreset(key);
  if (!isShareMode) await ensureFlightAirportLinks();
};
const planDialog = document.createElement('dialog');
planDialog.className = 'event-editor';
planDialog.innerHTML = '<form id="planForm" class="editor-form"><h3 id="planDialogTitle">新建计划</h3><p id="planDialogHint" class="hint"></p><label id="planNameField">计划名称<input id="planDialogName" required maxlength="60" autocomplete="off"></label><div class="editor-actions"><button type="button" id="planDialogCancel" class="ghost">取消</button><button type="submit" id="planDialogSubmit">确认</button></div></form>';
document.body.append(planDialog);
let planDialogMode = '';
function openPlanDialog(mode) {
  if (isShareMode) return;
  const plan = state.plans.find(item => item.id === state.versionKey);
  planDialogMode = mode;
  const title = $('#planDialogTitle', planDialog), hint = $('#planDialogHint', planDialog), field = $('#planNameField', planDialog), input = $('#planDialogName', planDialog), submit = $('#planDialogSubmit', planDialog);
  const isDelete = mode === 'delete';
  title.textContent = isDelete ? '确认删除计划' : mode === 'copy' ? '复制计划' : '新建计划';
  hint.textContent = isDelete ? `此操作不可恢复。请输入“${plan?.name || ''}”以确认删除。` : mode === 'copy' ? '将完整复制当前计划的时间表、地点与路线。' : '新计划创建后可单独编辑，不会影响当前计划。';
  field.firstChild.textContent = isDelete ? '确认计划名称' : '计划名称';
  input.value = isDelete ? '' : mode === 'copy' ? `${plan?.name || '未命名计划'} 副本` : '新建计划';
  input.placeholder = isDelete ? plan?.name || '' : '请输入计划名称'; submit.textContent = isDelete ? '确认删除' : mode === 'copy' ? '复制计划' : '创建计划';
  planDialog.showModal(); input.focus(); input.select();
}
$('#planDialogCancel', planDialog).onclick = () => planDialog.close();
$('#planForm', planDialog).onsubmit = event => {
  event.preventDefault(); const name = $('#planDialogName', planDialog).value.trim(); const current = state.plans.find(item => item.id === state.versionKey);
  if (!name) return;
  if (planDialogMode === 'delete') {
    if (!current || name !== current.name) { $('#planDialogHint', planDialog).textContent = '计划名称不匹配，请重新输入。'; return; }
    localStorage.removeItem(versionStorageKey(current.id)); state.plans = state.plans.filter(item => item.id !== current.id); state.versionKey = state.plans[0].id;
    renderPlanSelect(); const next = parseStoredJson(versionStorageKey(state.versionKey), null);
    if (next) { load(next, state.versionKey); renderSchedule(state.schedule); } else loadPreset(state.versionKey);
  } else {
    const id = planIdFromName(name);
    const snapshot = planDialogMode === 'copy'
      ? { ...structuredClone(currentSnapshot()), name, planKey: id, updatedAt: new Date().toISOString() }
      : { name, items: [], schedule: [], locations: structuredClone(state.locations), routes: structuredClone(state.routes), placeCategories: [], preferences: structuredClone(state.preferences), placeModelVersion: 1, routeLinkModeVersion: 1, planKey: id };
    state.plans.push({ id, name }); state.versionKey = id; localStorage.setItem(versionStorageKey(id), JSON.stringify(snapshot)); renderPlanSelect(); load(snapshot, id);
    snapshot.schedule.length ? renderSchedule(state.schedule) : renderManualSchedule();
  }
  planDialog.close(); save();
};
$('#newPlanBtn').onclick = () => openPlanDialog('new');
$('#copyPlanBtn').onclick = () => openPlanDialog('copy');
$('#deletePlanBtn').onclick = () => { if (state.plans.length > 1) openPlanDialog('delete'); };
const geocode = createGeocodeService(api, { pause, aliases: amapKeywords });
const weatherCodeLabel = code => ({ 0: '晴', 1: '大致晴', 2: '多云', 3: '阴', 45: '雾', 48: '雾凇', 51: '毛毛雨', 53: '毛毛雨', 55: '毛毛雨', 61: '小雨', 63: '中雨', 65: '大雨', 71: '小雪', 73: '中雪', 75: '大雪', 80: '阵雨', 81: '阵雨', 82: '强阵雨', 95: '雷雨', 96: '冰雹雷雨', 99: '强冰雹雷雨' }[Number(code)] || '天气待定');
function weatherSummary(weather) {
  if (!weather) return '';
  const condition = weather.conditionText || weatherCodeLabel(weather.weatherCode);
  const parts = [`${condition} ${Number(weather.temperature).toFixed(0)}°C`];
  if (Number.isFinite(Number(weather.precipitationProbability))) parts.push(`降水 ${Number(weather.precipitationProbability).toFixed(0)}%`);
  if (Number.isFinite(Number(weather.windSpeed))) parts.push(`风 ${Number(weather.windSpeed).toFixed(0)}km/h`);
  return parts.join(' · ');
}
async function queryEventWeather(index, { silent = false } = {}) {
  const event = state.schedule[index];
  if (!event) return;
  const editorActive = editingScheduleIndex === index && $('#eventEditor').open;
  const eventType = editorActive ? $('#editorType').value : event.type;
  const eventDate = editorActive ? $('#editorDate').value : event.date;
  const eventStart = editorActive ? $('#editorStart').value : event.start;
  const eventEnd = editorActive ? $('#editorEnd').value : event.end;
  const flightArrivalDate = editorActive ? ($('#editorFlightArrivalDate').value || eventDate) : (event.flightInfo?.arrivalDate || eventDate);
  const button = $('#queryEditorWeather'), status = $('#editorWeatherStatus');
  if (button) { button.disabled = true; button.textContent = '查询中…'; }
  try {
    const requestWeather = async (place, date, time) => {
      if (!place?.address) throw new Error('请先关联或填写具有明确地址的地点。');
      let point = place.resolved?.location;
      if (!point) {
        const result = await geocode(place.address, place.name);
        point = result.location;
        if (place.id) place.resolved = { name: result.name || place.name, address: result.formatted_address || place.address, location: point };
      }
      const [lng, lat] = gcjToWgs(...point.split(',').map(Number));
      const response = await fetch(`/api/weather?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lng)}&date=${encodeURIComponent(date)}&time=${encodeURIComponent(time || '12:00')}`);
      const weather = await response.json(); if (!response.ok) throw new Error(weather.error || '天气查询失败');
      return weather;
    };
    if (eventType === 'drive') {
      const route = routeForScheduleEvent(event), links = route ? { ...event.routeLinks, ...route } : event.routeLinks || {};
      const origin = (editorActive && ($('#routeOrigin').value ? state.locations.find(place => place.id === $('#routeOrigin').value) : { name: $('#routeOriginName').value.trim(), address: $('#routeOriginAddress').value.trim() })) || state.locations.find(place => place.id === links.originPlaceId) || links.customOrigin;
      const destination = (editorActive && ($('#routeDestination').value ? state.locations.find(place => place.id === $('#routeDestination').value) : { name: $('#routeDestinationName').value.trim(), address: $('#routeDestinationAddress').value.trim() })) || state.locations.find(place => place.id === links.destinationPlaceId) || links.customDestination;
      const [originWeather, destinationWeather] = await Promise.all([requestWeather(origin, eventDate, eventStart), requestWeather(destination, eventDate, eventEnd || eventStart)]);
      event.weather = { origin: originWeather, destination: destinationWeather, eventDate, eventStart: eventStart || '', eventEnd: eventEnd || eventStart || '' };
    } else if (eventType === 'flight') {
      const flight = event.flightInfo || {};
      const departureAirport = editorActive ? $('#editorFlightDeparture').value.trim() : flight.departureAirport;
      const arrivalAirport = editorActive ? $('#editorFlightArrival').value.trim() : flight.arrivalAirport;
      const origin = state.locations.find(place => place.name === departureAirport || place.resolved?.name === departureAirport) || state.locations.find(place => place.id === flight.departurePlaceId) || { name: departureAirport, address: departureAirport };
      const destination = state.locations.find(place => place.name === arrivalAirport || place.resolved?.name === arrivalAirport) || state.locations.find(place => place.id === flight.arrivalPlaceId) || { name: arrivalAirport, address: arrivalAirport };
      const [originWeather, destinationWeather] = await Promise.all([requestWeather(origin, eventDate, eventStart), requestWeather(destination, flightArrivalDate, eventEnd || eventStart)]);
      event.weather = { origin: originWeather, destination: destinationWeather, eventDate, eventStart: eventStart || '', eventEnd: eventEnd || eventStart || '', arrivalDate: flightArrivalDate, departureAirport, arrivalAirport };
    } else {
      const place = state.locations.find(item => item.id === (editorActive ? $('#eventLocation').value : event.locationId));
      const weather = await requestWeather(place, eventDate, eventStart);
      event.weather = { ...weather, placeId: place.id, eventDate, eventStart: eventStart || '' };
    }
    save(); renderSchedule(state.schedule); applyDayFilter(); renderLocations();
    if (status) { status.hidden = false; status.textContent = eventType === 'drive' ? `起点：${weatherSummary(event.weather.origin)}；终点：${weatherSummary(event.weather.destination)}` : eventType === 'flight' ? `起飞：${weatherSummary(event.weather.origin)}；降落：${weatherSummary(event.weather.destination)}` : weatherSummary(event.weather); }
  } catch (error) {
    if (!silent) alert(error.message || '天气查询失败');
    if (silent) throw error;
  } finally {
    if (button) { button.disabled = false; button.textContent = '重新查询天气'; }
  }
}
async function updateVisibleScheduleWeather() {
  const date = state.dayFilter;
  const targets = state.schedule
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => !date || event.date === date);
  if (!targets.length) return;
  const button = $('#updateScheduleWeather');
  const originalText = button?.textContent;
  if (button) { button.disabled = true; button.textContent = `更新中 0/${targets.length}`; }
  let succeeded = 0;
  const failed = [];
  for (let i = 0; i < targets.length; i += 1) {
    const { index, event } = targets[i];
    try {
      await queryEventWeather(index, { silent: true });
      succeeded += 1;
    } catch (error) {
      failed.push(`${event.title || '未命名事件'}：${error.message || '无法查询'}`);
    }
    if (button) button.textContent = `更新中 ${i + 1}/${targets.length}`;
  }
  if (button) { button.disabled = false; button.textContent = originalText || '更新卡片天气'; }
  const scope = date || '全部日期';
  alert(failed.length ? `${scope}：已更新 ${succeeded} 张卡片；${failed.length} 张未更新（通常是地点尚未确定）。\n${failed.slice(0, 3).join('\n')}` : `${scope}：已更新 ${succeeded} 张卡片天气。`);
}
updateScheduleWeatherButton.addEventListener('click', updateVisibleScheduleWeather);
function pngFilePart(value) {
  return String(value || 'roadtrip').trim().replace(/[\\/:*?"<>|\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'roadtrip';
}
function downloadCanvasPng(canvas, filename) {
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL('image/png');
  link.click();
}
function nextPaint() { return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); }
function flattenMapLatLngs(latLngs) {
  return (latLngs || []).flatMap(item => Array.isArray(item) ? flattenMapLatLngs(item) : item ? [item] : []);
}
function layerOpacity(element, stopAt) {
  let opacity = 1;
  for (let current = element; current && current !== stopAt; current = current.parentElement) {
    const value = Number.parseFloat(getComputedStyle(current).opacity);
    if (Number.isFinite(value)) opacity *= value;
  }
  return opacity;
}
function drawLeafletLayerToCanvas(context, layer, scale) {
  const toPoint = latLng => map.latLngToContainerPoint(latLng);
  if (layer instanceof L.Polyline) {
    const points = flattenMapLatLngs(layer.getLatLngs()).map(toPoint);
    if (points.length < 2) return;
    context.save();
    context.globalAlpha = Number.isFinite(layer.options.opacity) ? layer.options.opacity : 1;
    context.strokeStyle = layer.options.color || '#2f73a9';
    context.lineWidth = (layer.options.weight || 3) * scale;
    context.lineCap = layer.options.lineCap || 'round';
    context.lineJoin = layer.options.lineJoin || 'round';
    context.beginPath();
    points.forEach((point, index) => index ? context.lineTo(point.x * scale, point.y * scale) : context.moveTo(point.x * scale, point.y * scale));
    context.stroke(); context.restore();
    return;
  }
  if (layer instanceof L.CircleMarker) {
    const point = toPoint(layer.getLatLng()), radius = (layer.options.radius || 4) * scale;
    context.save();
    context.globalAlpha = Number.isFinite(layer.options.fillOpacity) ? layer.options.fillOpacity : 1;
    context.fillStyle = layer.options.fillColor || layer.options.color || '#1d6b4f';
    context.beginPath(); context.arc(point.x * scale, point.y * scale, radius, 0, Math.PI * 2); context.fill();
    if (layer.options.weight) { context.globalAlpha = Number.isFinite(layer.options.opacity) ? layer.options.opacity : 1; context.strokeStyle = layer.options.color || '#fff'; context.lineWidth = layer.options.weight * scale; context.stroke(); }
    context.restore();
    return;
  }
  const markerClass = layer instanceof L.Marker ? (layer.options.icon?.options?.className || '') : '';
  if (layer instanceof L.Marker && (layer._routeArrowFraction !== undefined || markerClass.includes('flight-arrow-marker'))) {
    const point = toPoint(layer.getLatLng());
    const style = layer.options.icon?.options?.html || '';
    const bearing = Number((style.match(/--(?:bearing|flight-arrow-angle):([\-\d.]+)deg/) || [])[1] || 0);
    const color = (style.match(/color:([^";]+)/) || [])[1] || (markerClass.includes('flight-arrow-marker') ? markerColors.flight : '#1d6b4f');
    context.save(); context.translate(point.x * scale, point.y * scale); context.rotate((bearing + 90) * Math.PI / 180); context.fillStyle = color; context.font = `${11 * scale}px system-ui`; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText('➤', 0, 0); context.restore();
  }
}
function drawMapExportLegend(context, scale) {
  const dates = [...new Set(state.schedule.filter(event => event.type === 'drive' && event.date).map(event => event.date))].sort();
  const rows = dates.map(date => ({ label: date, color: routeColorForDate(date) }));
  rows.push(
    { label: '地点（按地点类型着色）', color: markerColors.spot, marker: true },
    { label: '机场', color: markerColors.flight, marker: true },
    { label: '航线', color: markerColors.flight, flight: true }
  );
  if (!rows.length) return;
  const padding = 10 * scale, lineHeight = 16 * scale, width = 176 * scale, height = padding * 2 + rows.length * lineHeight;
  context.save();
  context.fillStyle = '#fffffff2'; context.strokeStyle = '#d8e1da'; context.lineWidth = scale;
  context.beginPath(); context.roundRect(12 * scale, 12 * scale, width, height, 7 * scale); context.fill(); context.stroke();
  context.font = `${10 * scale}px system-ui`; context.textBaseline = 'middle'; context.fillStyle = '#315540';
  rows.forEach((row, index) => {
    const y = 12 * scale + padding + index * lineHeight + lineHeight / 2;
    if (row.marker) {
      context.fillStyle = row.color;
      context.beginPath(); context.arc(34 * scale, y, 4 * scale, 0, Math.PI * 2); context.fill();
      context.strokeStyle = '#fff'; context.lineWidth = scale; context.stroke();
    } else {
      context.globalAlpha = row.flight ? .5 : 1;
      context.strokeStyle = row.color; context.lineWidth = row.flight ? 2.4 * scale : 3.2 * scale; context.lineCap = 'round';
      context.beginPath(); context.moveTo(22 * scale, y); context.lineTo(46 * scale, y); context.stroke();
    }
    context.fillText(row.label, 54 * scale, y);
  });
  context.restore();
}
function renderCurrentMapCanvas() {
  const target = $('#map');
  const bounds = target.getBoundingClientRect();
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bounds.width * scale); canvas.height = Math.round(bounds.height * scale);
  const context = canvas.getContext('2d');
  context.fillStyle = '#f7f4ed'; context.fillRect(0, 0, canvas.width, canvas.height);
  target.querySelectorAll('.leaflet-tile').forEach(tile => {
    if (!tile.complete || !tile.naturalWidth) return;
    const rect = tile.getBoundingClientRect();
    context.save(); context.globalAlpha = layerOpacity(tile, target);
    try { context.drawImage(tile, (rect.left - bounds.left) * scale, (rect.top - bounds.top) * scale, rect.width * scale, rect.height * scale); } catch { /* 单张瓦片失败不影响路线与其他底图。 */ }
    context.restore();
  });
  const layers = [];
  const collect = group => group?.eachLayer?.(layer => { if (layer.eachLayer && !(layer instanceof L.Polyline)) collect(layer); else layers.push(layer); });
  collect(dayOverviewLayer); collect(markerLayer); collect(routeLayer);
  layers.sort((left, right) => {
    const z = layer => Number(map.getPane(layer.options?.pane || 'overlayPane')?.style.zIndex || 400);
    return z(left) - z(right);
  }).forEach(layer => drawLeafletLayerToCanvas(context, layer, scale));
  drawMapExportLegend(context, scale);
  return canvas;
}
async function exportAllSchedulePng() {
  if (!window.html2canvas) { alert('PNG 导出组件尚未加载，请稍后重试或刷新页面。'); return; }
  const button = $('#exportSchedulePng');
  const oldFilter = state.dayFilter;
  const oldText = button.textContent;
  try {
    button.disabled = true; button.textContent = '正在生成…';
    state.dayFilter = '';
    renderSchedule(state.schedule);
    await nextPaint();
    const grid = $('#schedule .calendar-grid');
    if (!grid) throw new Error('时间表为空，无法导出。');
    grid.classList.add('png-export');
    await nextPaint();
    const canvas = await window.html2canvas(grid, {
      backgroundColor: '#fffdf8', scale: 2, useCORS: true, logging: false,
      width: grid.scrollWidth, height: grid.scrollHeight, windowWidth: grid.scrollWidth, windowHeight: grid.scrollHeight
    });
    pendingScheduleExportCanvas = canvas;
    $('#scheduleExportPreviewImage').src = canvas.toDataURL('image/png');
    scheduleExportPreview.showModal();
  } catch (error) {
    alert(error.message || '时间表 PNG 导出失败。');
  } finally {
    $('#schedule .calendar-grid')?.classList.remove('png-export');
    state.dayFilter = oldFilter;
    renderSchedule(state.schedule); applyDayFilter();
    button.disabled = false; button.textContent = oldText;
  }
}
async function exportDrivingMapPng() {
  if (!window.html2canvas || !map) { alert('地图 PNG 导出组件尚未就绪，请刷新页面后重试。'); return; }
  const button = $('#exportMapPng');
  const oldText = button.textContent;
  const oldFilter = state.dayFilter;
  try {
    button.disabled = true; button.textContent = '正在生成…';
    await showDayOverview('');
    map.invalidateSize();
    await new Promise(resolve => setTimeout(resolve, 500));
    const canvas = renderCurrentMapCanvas();
    pendingMapExportCanvas = canvas;
    $('#mapExportPreviewImage').src = canvas.toDataURL('image/png');
    mapExportPreview.showModal();
  } catch (error) {
    alert('地图 PNG 导出失败。请等待底图加载完成后重试。');
  } finally {
    await showDayOverview(oldFilter);
    button.disabled = false; button.textContent = oldText;
  }
}
exportSchedulePngButton.addEventListener('click', exportAllSchedulePng);
exportMapPngButton.addEventListener('click', exportDrivingMapPng);
$('#closeMapExportPreview').onclick = () => mapExportPreview.close();
$('#downloadMapExportPreview').onclick = () => {
  if (!pendingMapExportCanvas) return;
  downloadCanvasPng(pendingMapExportCanvas, `${pngFilePart($('#tripName').value)}-自驾地图.png`);
};
$('#closeScheduleExportPreview').onclick = () => scheduleExportPreview.close();
$('#downloadScheduleExportPreview').onclick = () => {
  if (!pendingScheduleExportCanvas) return;
  downloadCanvasPng(pendingScheduleExportCanvas, `${pngFilePart($('#tripName').value)}-全部日期时间表.png`);
};
async function showStopsOnMap(nodes) {
  if (!map) return;
  dayOverviewLayer?.clearLayers();
  const results = await Promise.allSettled(nodes.map(node => geocode(node.address, node.name)));
  let resolvedChanged = false;
  const stops = results.flatMap((result, index) => {
    if (result.status !== 'fulfilled') return [];
    const node = nodes[index], point = result.value;
    const place = state.locations.find(item => item.id === node.id);
    if (place && point.location) { place.resolved = { name: point.name || place.name, address: point.formatted_address || place.address, location: point.location }; resolvedChanged = true; }
    return [{ node, point: point.location }];
  });
  if (resolvedChanged) { save(); renderLocations(); }
  if (!stops.length) return;
  markerLayer.clearLayers();
  const latLngs = stops.map(({ node, point }) => { const [lng, lat] = mapCoords(...point.split(',').map(Number)); const marker = L.circleMarker([lat, lng], mapPointStyle(node.type)).bindPopup(`${node.date} · ${node.name}`).addTo(markerLayer); if (Number.isInteger(node.scheduleIndex)) marker.on('click', () => focusScheduleEvent(node.scheduleIndex)); return [lat, lng]; });
  map.fitBounds(L.latLngBounds(latLngs), { padding: [38, 38], maxZoom: 10 });
}
const fmt = seconds => { const h=Math.floor(seconds/3600),m=Math.round(seconds%3600/60);return h?`${h}小时${m}分`:`${m}分钟`; };
function routeTotals() {
  const events = state.schedule.filter(event => event.type === 'drive' && (!state.dayFilter || event.date === state.dayFilter));
  const days = new Map(); let pending = 0;
  events.forEach(event => {
    const route = routeForScheduleEvent(event);
    if (!route?.amap) { pending += 1; return; }
    const day = days.get(event.date) || { distance: 0, duration: 0, tolls: 0, count: 0 };
    day.distance += Number(route.amap.distance || 0); day.duration += Number(route.amap.duration || 0); day.tolls += Number(route.amap.tolls || 0); day.count += 1;
    days.set(event.date, day);
  });
  const total = [...days.values()].reduce((sum, day) => ({ distance: sum.distance + day.distance, duration: sum.duration + day.duration, tolls: sum.tolls + day.tolls, count: sum.count + day.count }), { distance: 0, duration: 0, tolls: 0, count: 0 });
  return { days, total, pending, eventCount: events.length };
}
function renderRouteTotals(showDetail = false) {
  const { days, total, pending, eventCount } = routeTotals();
  $('#duration').textContent = total.count ? fmt(total.duration) : '—';
  $('#distance').textContent = total.count ? `${(total.distance / 1000).toFixed(1)} 公里 · 过路费约 ${total.tolls.toFixed(0)} 元 · ${total.count}/${eventCount} 段已确认${pending ? ` · ${pending} 段待查询` : ''}` : `${eventCount} 段路程尚未查询`;
  const detail = $('#routeSummaryDetail');
  if (!showDetail) return;
  const rows = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, day]) => `<div class="route-summary-day"><b>${escapeHtml(date)}</b> · ${(day.distance / 1000).toFixed(1)} 公里 · ${fmt(day.duration)} · 过路费 ${day.tolls.toFixed(0)} 元 · ${day.count} 段</div>`).join('');
  detail.innerHTML = `<b>${state.dayFilter ? `${escapeHtml(state.dayFilter)} 路程汇总` : '方案分日路程汇总'}</b><div class="route-summary-days">${rows || '<div class="route-summary-day">尚无已查询的路程。</div>'}</div><small>仅相加已保存的高德路线；${pending ? `另有 ${pending} 段待明确起终点或查询。` : '全部已确认路段均已统计。'}</small>`;
  detail.hidden = false;
}
$('#routeBtn').onclick = () => {
  const detail = $('#routeSummaryDetail');
  if (!detail.hidden) { detail.hidden = true; return; }
  renderRouteTotals(true);
};
async function initializePlanner() {
  let cached = isShareMode ? null : localStorage.getItem('roadtrip');
  setPlanCatalog({});
  const hydrate = fileData => {
    if (!fileData) return;
    const normalized = setPlanCatalog(fileData);
    const activeKey = state.versionKey;
    if (isShareMode) {
      const active = normalized.versions?.[activeKey];
      if (active) cached = JSON.stringify(active);
      const stamp = fileData.updatedAt ? new Date(fileData.updatedAt).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' }) : '';
      $('#fileSaveStatus').textContent = `共享只读版${stamp ? ` · 更新于 ${stamp}` : ''}`;
      return;
    }
    if (normalized.locations) localStorage.setItem(universalLocationStorageKey, JSON.stringify(normalized.locations));
    if (normalized.routes) localStorage.setItem(universalRouteStorageKey, JSON.stringify(normalized.routes));
    state.plans.forEach(plan => { if (normalized.versions?.[plan.id]) localStorage.setItem(versionStorageKey(plan.id), JSON.stringify(normalized.versions[plan.id])); });
    const active = normalized.versions?.[activeKey];
    if (active) { cached = JSON.stringify(active); localStorage.setItem('roadtrip', cached); }
    const stamp = fileData.updatedAt ? new Date(fileData.updatedAt).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' }) : '';
    $('#fileSaveStatus').textContent = '已从本地文件载入';
  };
  if (isShareMode) hydrate(shareData);
  else try {
    const response = await fetch('/api/planner-data'); const result = await response.json(); hydrate(result.data);
  } catch { $('#fileSaveStatus').textContent = cached ? '本地文件读取失败，已使用浏览器缓存' : '未能读取本地文件'; }
  if (cached) {
    const data = JSON.parse(cached); const inferredKey = state.plans.some(plan => plan.id === data.planKey) ? data.planKey : state.versionKey;
    load(data, inferredKey); save(); state.schedule.length ? renderSchedule(state.schedule) : renderManualSchedule();
  } else loadPreset(state.versionKey || defaultPlanId);
  await initMap();
  if (!isShareMode) await ensureFlightAirportLinks();
  await showDayOverview('');
  renderRouteTotals();
}
initializePlanner();
