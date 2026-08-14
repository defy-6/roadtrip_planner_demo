// 日程焦点联动：点击日程卡片时在地图上定位事件对应的地点/路线/航班。
// 地图实例与图层由 runtime 通过 getMap/getRouteLayer/setRouteLayer 注入，本模块不管理地图生命周期。
export function createScheduleFocus({
  state, $, itemsEl, values, escapeHtml, fmt, geocode, mapCoords,
  getMap, getRouteLayer, setRouteLayer,
  selectedPointStyle, addSelectedPlacePhotoCallout, setOverviewFocusOpacity, fitSelectionWithDayContext,
  renderMapRouteLegend, showDayOverview, showFlightOnMap, showRouteOnMap,
  calculateDriveRoute, routeForScheduleEvent, markerColors,
  eventTypeNames, typeNames, normalizedTransportMode, driveTravelMeta, transportModeMeta, weatherSummary,
  getMapFocusDate, setMapFocusDate, getRenderedOverviewDate, setRenderedOverviewDate,
  isShareMode
}) {
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
    const map = getMap();
    const index = Number(node.dataset.scheduleIndex); if (Number.isInteger(index)) state.selectedIndex = index;
    document.querySelectorAll('.item.selected').forEach(item => item.classList.remove('selected'));
    node.classList.add('selected');
    document.querySelectorAll('.calendar-block').forEach(block => block.classList.toggle('selected', Number(block.dataset.scheduleIndex) === state.selectedIndex));
    const item = values(node);
    if (!item.address || !map) return;
    try {
      const point = await geocode(item.address, item.name);
      const [lng, lat] = mapCoords(...point.location.split(',').map(Number));
      let routeLayer = getRouteLayer();
      if (routeLayer) map.removeLayer(routeLayer);
      routeLayer = L.layerGroup().addTo(map);
      setRouteLayer(routeLayer);
      L.circleMarker([lat, lng], selectedPointStyle(item.type, { interactive: false })).addTo(routeLayer);
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
    const routeDetail = $('#routeDetail');
    const compactWeather = weather => weatherSummary(weather).split(' · ')[0] || '';
    const originWeather = compactWeather(entry.weather?.origin);
    const destinationWeather = compactWeather(entry.weather?.destination);
    routeDetail.dataset.routeDuration = fmt(Number(record.duration || 0));
    routeDetail.dataset.routeWeather = originWeather && destinationWeather && originWeather !== destinationWeather ? `起 ${originWeather}\n终 ${destinationWeather}` : (originWeather || destinationWeather || '未查询');
    routeDetail.innerHTML = `<b class="detail-title">${escapeHtml(entry.title || title)}</b><span class="detail-meta">${escapeHtml(entry.date || '')}${entry.start ? ` · ${escapeHtml(entry.start)}–${escapeHtml(entry.end || '')}` : ''}</span><strong class="detail-key">${escapeHtml(modeLabel)} · ${(Number(record.distance || 0) / 1000).toFixed(1)} 公里 · ${fmt(Number(record.duration || 0))}${tollText}</strong>${entry.detail ? `<small class="detail-note">${escapeHtml(entry.detail)}</small>` : ''}<small class="detail-source">查询于 ${new Date(record.queriedAt).toLocaleString('zh-CN')}${transportMode === 'driving' && record.queryPeriod === 'night' ? '（夜间结果，建议白天重查）' : ''}；地图点击不会重新计算。</small>`;
  }

  function showEventDetail(entry, extra = '') {
    const place = state.locations.find(item => item.id === entry.locationId);
    const time = [entry.start, entry.end].filter(Boolean).join('–');
    const lines = [
      `<b class="detail-title">${escapeHtml(entry.title || '未命名事件')}</b>`,
      `<span class="detail-meta">${escapeHtml(entry.date || '')}${time ? ` · ${escapeHtml(time)}` : ''} · ${escapeHtml(eventTypeNames[entry.type] || typeNames[entry.type] || '事件')}</span>`,
      place?.name ? `<strong class="detail-key">地点 · ${escapeHtml(place.name)}</strong>` : '',
      entry.detail ? `<small class="detail-note">${escapeHtml(entry.detail)}</small>` : '',
      extra
    ].filter(Boolean);
    $('#routeDetail').innerHTML = lines.join('<br>');
  }

  async function focusScheduleEvent(index, { skipDriveQuery = false } = {}) {
    const entry = state.schedule[index]; if (!entry) return;
    state.selectedIndex = index;
    setMapFocusDate(entry.date || '');
    renderMapRouteLegend(entry.date);
    const node = [...itemsEl.children].find(item => Number(item.dataset.scheduleIndex) === index);
    document.querySelectorAll('.calendar-block').forEach(block => block.classList.toggle('selected', Number(block.dataset.scheduleIndex) === index));
    // 当天总览已存在时不重建所有点线，卡片切换仅更新高亮图层。
    if (getRenderedOverviewDate() !== (entry.date || '')) await showDayOverview(entry.date);
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
        let routeLayer = getRouteLayer();
        if (routeLayer) getMap().removeLayer(routeLayer);
        routeLayer = L.layerGroup().addTo(getMap());
        setRouteLayer(routeLayer);
        const color = markerColors[entry.type] || markerColors.spot;
        L.circleMarker([lat, lng], selectedPointStyle(place.type, { interactive: false })).addTo(routeLayer);
        addSelectedPlacePhotoCallout(routeLayer, [lat, lng], place, entry.photo);
        setOverviewFocusOpacity(true);
        fitSelectionWithDayContext(L.latLngBounds([[lat, lng]]), 12);
        // 图片气泡承担高亮注记；详情在地图下方信息栏显示，避免 Leaflet 弹窗遮挡缩略图。
        getMap().closePopup();
      } catch { /* 地点无法解析时仍保留当天地图总览。 */ }
      showEventDetail(entry, `<small>已定位关联地点：${escapeHtml(place.name)}。</small>`);
    } else if (node) { focusNode(node); showEventDetail(entry, '<small>这是时间事件；关联具体地点后即可在地图中定位。</small>'); }
  }

  return { revealCorrespondingNode, focusNode, showDriveSegment, showSavedDriveInfo, showEventDetail, focusScheduleEvent };
}
