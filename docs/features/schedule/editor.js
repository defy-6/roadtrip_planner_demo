// 事件编辑器：打开/保存/删除时刻表事件，维护路线、航班、天气与费用字段。
// 地点新增(confirmNewPlace)、费用表单(costEditor)、天气查询(queryEventWeather)均由 runtime 注入。
export function createScheduleEditor({
  state, $, escapeHtml, itemsEl, values,
  elements: { editorDeleteButton, routeEditorSection, flightFields, eventLocationField, weatherFields },
  costs: { renderEditorPriceItems, collectEditorPriceInfo },
  services: { geocode, weather: queryEventWeather, route: { resolveInlinePlace, calculateDriveRoute } },
  routes: { upsertUniversalRoute, routeSignature, linkFlightAirports, normalizedTransportMode, normalizedTravelMode, transportModeMeta, driveTravelMeta, routeForScheduleEvent },
  places: { confirmNewPlace, suggestedPlaceName, normalizePlaceLookup, findPlaceInPlanOrUniversal, placeTypeName, typeNames },
  persistence: { readSharedSchedule, parseStoredJson, versionStorageKey, sharedScheduleStorageKey, persistence, storePlanSnapshot, save },
  nodes: { updateNodeFromSchedule, addItem },
  events: { onFocus: focusScheduleEvent, onRender: { renderLocations, renderSchedule, applyDayFilter, renderRouteTotals, showDayOverview } },
  meta: { eventTypeNames, isShareMode, fmt, weatherSummary, clockToMinute }
}) {
  let editingScheduleIndex = null;
  let editingNewEvent = false;
  let pendingEditorRoute = null;
  let editorWaypointOrder = [];

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
    $('#eventEditor').dataset.scheduleIndex = String(index);
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
    storePlanSnapshot(versionKey, snapshot);
  }

  function deleteScheduleEvent(index) {
    if (isShareMode) return;
    const event = state.schedule[index]; if (!event || !confirm(`确定删除“${event.title}”吗？\n\n关联的通用地点和通用路线会保留。`)) return;
    if (event.sharedId && !state.plans.length) {
      const shared = readSharedSchedule(); delete shared[event.sharedId];
      persistence.write(sharedScheduleStorageKey, shared);
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
      if (!place) place = findPlaceInPlanOrUniversal(address, name);
      if (!place) {
        const point = await geocode(address, name);
        place = findPlaceInPlanOrUniversal(address, name, point.location);
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
        place = findPlaceInPlanOrUniversal(address, title);
        if (!place) {
          let point;
          try { point = await geocode(address, title); }
          catch (error) { alert(error.message || '高德暂时无法确认该地点，请检查地址后重试。'); return; }
          place = findPlaceInPlanOrUniversal(address, title, point.location);
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

  return { openScheduleEditor, cancelScheduleEditor, deleteScheduleEvent, getEditingIndex: () => editingScheduleIndex };
}
