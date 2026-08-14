// 会话层：计划快照、数据合并、保存/载入与预设载入。
// 纯数据与持久化编排，不直接渲染 DOM；渲染回调（renderSchedule 等）由 runtime 注入。
export function createSession({
  state, $, itemsEl, values, persistence, isShareMode, shareData, defaultPlanId,
  migrate, renderPlanSelect, setPlanCatalog,
  utils: { normalizeCategoryColor, normalizePlaceLookup, findMatchingLocation, suggestedPlaceName, syncUniversalPlace, versionStorageKey, sharedScheduleStorageKey, typeForTitle, presetNodeTimes, PRESET_PLANS, PRESET_SCHEDULES },
  routes: { upsertUniversalRoute, routeForScheduleEvent, mergeUniversalRoutes },
  render: { addItem, renderLocations, renderSchedule, renderManualSchedule, applyDayFilter, showDayOverview, renderRouteTotals, showStopsOnMap },
  history, selectedIndexes, getFileRevision, setFileRevision
}) {
  let planSnapshots = {};
  let universalCatalog = null;

  function planIdFromName(name) { return `${String(name || 'plan').trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '') || 'plan'}-${crypto.randomUUID().slice(0, 8)}`; }
  function snapshotForPlan(key) { return planSnapshots[key] ? structuredClone(planSnapshots[key]) : null; }
  function storePlanSnapshot(key, snapshot) { if (key && snapshot) planSnapshots[key] = structuredClone(snapshot); }
  function removePlanSnapshot(key) { delete planSnapshots[key]; }
  function setSnapshots(versions) { planSnapshots = structuredClone(versions || {}); }
  // 文件容器顶层通用库：独立于任何计划快照，载入计划时作为通用库基础而非被计划地点覆盖。
  function setUniversalCatalog(catalog) {
    universalCatalog = { locations: catalog?.locations || [], routes: catalog?.routes || [] };
  }
  // 载入文件容器：登记计划目录、快照与顶层通用库，返回 normalized 容器供调用方继续取 active 快照。
  function loadFileContainer(fileData) {
    const normalized = setPlanCatalog(fileData);
    setSnapshots(normalized.versions || {});
    setUniversalCatalog(fileData);
    return normalized;
  }

  function clonePlaceForPlan(place) { return structuredClone({ ...place, id: crypto.randomUUID() }); }
  function syncPlaceToUniversal(place) {
    if (!place) return place;
    state.universalLocations ||= [];
    return syncUniversalPlace(place, state.universalLocations);
  }
  function importUniversalPlace(place) {
    if (!place) return null;
    const existing = findMatchingLocation(state.locations, place.address, place.name, place.resolved?.location);
    if (existing) return existing;
    const copy = clonePlaceForPlan(place);
    state.locations.push(copy);
    return copy;
  }
  function findPlaceInPlanOrUniversal(address, name = '', resolvedLocation = '') {
    return findMatchingLocation(state.locations, address, name, resolvedLocation) || importUniversalPlace(findMatchingLocation(state.universalLocations, address, name, resolvedLocation));
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

  function readSharedSchedule() {
    if (isShareMode) return structuredClone(shareData?.sharedSchedule || {});
    return persistence.read(sharedScheduleStorageKey, {});
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
    persistence.write(sharedScheduleStorageKey, shared);
  }

  function parseStoredJson(key, fallback) {
    const plan = state.plans.find(item => versionStorageKey(item.id) === key);
    return plan ? (snapshotForPlan(plan.id) || fallback) : fallback;
  }
  function fileSavePayload() {
    return {
      activeVersion: state.versionKey,
      plans: state.plans,
      versions: Object.fromEntries(state.plans.map(plan => [plan.id, snapshotForPlan(plan.id)]).filter(([, snapshot]) => snapshot)),
      locations: state.universalLocations,
      routes: state.routes,
      sharedSchedule: {},
      updatedAt: new Date().toISOString(),
      baseUpdatedAt: getFileRevision()
    };
  }
  function queueLocalFileSave() {
    if (!isShareMode) persistence.queueFileSave(fileSavePayload);
  }
  function currentSnapshot() { return { name: $('#tripName').value, items: [...itemsEl.children].map(values), schedule: state.schedule, expenses: state.expenses, locations: state.locations, routes: state.routes, placeCategories: state.placeCategories, preferences: state.preferences, placeModelVersion: 1, routeLinkModeVersion: 1, planKey: state.versionKey, updatedAt: new Date().toISOString() }; }
  function restorePlannerState(raw) {
    const data = JSON.parse(raw);
    selectedIndexes.clear();
    loadFileContainer(data);
    const active = data.versions?.[state.versionKey] || Object.values(data.versions || {})[0];
    if (active) {
      load(active, state.versionKey); state.universalLocations = data.locations || [];
      renderSchedule(state.schedule); showDayOverview(state.dayFilter); renderRouteTotals();
    }
    save();
  }

  function save() {
    if (isShareMode) return;
    (state.locations || []).forEach(syncPlaceToUniversal);
    // UI history must not depend on the asynchronous file autosave lifecycle.
    // A drag can happen immediately after load; it still needs to be undoable.
    history.commit();
    if (!persistence.autoSaveEnabled) return;
    writeSharedSchedule(); const snapshot = currentSnapshot(); storePlanSnapshot(state.versionKey, snapshot); queueLocalFileSave();
  }

  function mergeUniversalLocations(data) {
    if (isShareMode) return data;
    let universal = [];
    if (!Array.isArray(universal)) universal = [];
    const merged = universal.map(place => ({ ...place }));
    (data.locations || []).forEach(place => {
      const existing = findMatchingLocation(merged, place.address, place.name, place.resolved?.location);
      if (existing) Object.assign(existing, { ...structuredClone(place), id: existing.id });
      else merged.push(structuredClone(place));
    });
    // 计划内地点保留自己的 id；通用库只作为可导入的缓存，不重写事件关联。
    return { ...data, locations: data.locations || [], universalLocations: merged };
  }

  function load(rawData, versionKey = rawData.planKey || defaultPlanId) {
    const data = repairEventNamedLocations(mergeUniversalRoutes(mergeUniversalLocations(migrate(rawData, typeForTitle))));
    state.versionKey = state.plans.some(plan => plan.id === versionKey) ? versionKey : state.plans[0]?.id || defaultPlanId;
    renderPlanSelect(); itemsEl.innerHTML = ''; $('#tripName').value = data.name || state.plans.find(plan => plan.id === state.versionKey)?.name || '我的自驾行程';
    state.schedule = applySharedSchedule((data.schedule || []).map(event => {
      const normalized = event.type === 'spot' && typeForTitle(event.title) !== 'spot' ? { ...event, type: typeForTitle(event.title) } : { ...event };
      if (normalized.type === 'drive') delete normalized.locationId;
      return normalized;
    }));
    state.expenses = (data.expenses || []).map(expense => ({ ...expense, amount: Number(expense.amount || 0) }));
    state.locations = data.locations || [];
    state.universalLocations = universalCatalog?.locations?.length ? universalCatalog.locations : (data.universalLocations || data.locations || []);
    state.routes = data.routes || []; state.placeCategories = (data.placeCategories || []).filter(category => category?.id && category?.name).map(category => ({ id: category.id, name: category.name, color: normalizeCategoryColor(category.color) }));
    state.schedule.forEach(event => {
      const links = event.routeLinks;
      if (event.type !== 'drive' || !links) return;
      let route;
      if (links.originPlaceId && links.destinationPlaceId) route = upsertUniversalRoute(event.title, links);
      else route = routeForScheduleEvent(event);
      if (route) event.routeLinks = { ...links, routeId: route.id };
    });
    const usedRouteIds = new Set(state.schedule.map(event => event.routeLinks?.routeId).filter(Boolean));
    state.plans.forEach(plan => { const snapshot = snapshotForPlan(plan.id); (snapshot?.schedule || []).forEach(event => { if (event.routeLinks?.routeId) usedRouteIds.add(event.routeLinks.routeId); }); });
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
    if (!forceOriginal) { const draft = snapshotForPlan(key); if (draft) { load(draft, key); renderSchedule(state.schedule); return; } }
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

  return {
    planIdFromName, snapshotForPlan, storePlanSnapshot, removePlanSnapshot, setSnapshots, setUniversalCatalog, loadFileContainer,
    clonePlaceForPlan, syncPlaceToUniversal, importUniversalPlace, findPlaceInPlanOrUniversal, repairEventNamedLocations,
    readSharedSchedule, applySharedSchedule, writeSharedSchedule,
    parseStoredJson, fileSavePayload, queueLocalFileSave, currentSnapshot, restorePlannerState,
    save, mergeUniversalLocations, load, loadPreset
  };
}
