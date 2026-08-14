// 路线图层：管理地图上的路线 polyline、方向箭头、序列徽标与图例。
// 地图实例与图层由 runtime 通过 getter/setter 注入，本模块不管理地图生命周期。
export function createRouteLayer({
  state, $, escapeHtml, fmt, mapCoords, markerColors, mapDisplayType,
  selectedPointStyle, addSelectedPlacePhotoCallout, setOverviewFocusOpacity, fitSelectionWithDayContext,
  routeArrowPose, routeColorForDate, routeColorForSegment, dayDriveEvents,
  placeTypeName, placeTypeColor,
  getMap, getRouteLayer, setRouteLayer, getDayOverviewLayer,
  getMapRouteLegend, setMapRouteLegend,
  renderSchedule, refreshEventCards, save, showDayOverview, focusScheduleEvent,
  parseStoredJson, versionStorageKey, storePlanSnapshot, readSharedSchedule, persistence, sharedScheduleStorageKey
}) {
  const mapLegendPointStyle = type => type === 'geography' ? 'background:#fff;border-color:#111827;box-shadow:0 0 0 1px #111827' : `background:${placeTypeColor(type)}`;
  const mapDisplayTypeName = type => ({ transport: '交通', supply: '补给' }[mapDisplayType(type)] || placeTypeName(type));

  function showRouteOnMap(path, locations, nodes, routeInfo = {}) {
    const map = getMap();
    if (!map) return;
    const coordinates = path.steps.flatMap(step => step.polyline.split(';').map(pair => mapCoords(...pair.split(',').map(Number))));
    const latLngs = coordinates.map(([lng, lat]) => [lat, lng]);
    let routeLayer = getRouteLayer();
    if (routeLayer) map.removeLayer(routeLayer);
    routeLayer = L.featureGroup().addTo(map);
    setRouteLayer(routeLayer);
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
        if (getRouteLayer()) { getMap().removeLayer(getRouteLayer()); setRouteLayer(null); }
        getMap().closePopup();
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
    const photoCalloutOccupied = [];
    const renderedPhotoCallouts = new Set();
    nodes.forEach((node, index) => {
      const point = locations[index]; if (!point) return;
      const [lng, lat] = mapCoords(...point.split(',').map(Number));
      const place = state.locations.find(item => item.id === node.id) || node;
      L.circleMarker([lat, lng], selectedPointStyle(place.type || 'drive', { radius: 8, weight: 2.5, interactive: false })).addTo(routeLayer);
      const calloutKey = place.id || `${lat.toFixed(6)},${lng.toFixed(6)}`;
      if (!renderedPhotoCallouts.has(calloutKey)) {
        renderedPhotoCallouts.add(calloutKey);
        addSelectedPlacePhotoCallout(routeLayer, [lat, lng], place, '', photoCalloutOccupied, latLngs);
      }
    });
    setOverviewFocusOpacity(true);
    fitSelectionWithDayContext(routeLayer.getBounds(), 13);
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
      storePlanSnapshot(key, snapshot);
    });
    if (!state.plans.length) {
      const shared = readSharedSchedule();
      unlink(Object.values(shared));
      persistence.write(sharedScheduleStorageKey, shared);
    }
    renderSchedule(state.schedule); refreshEventCards(); save();
    showDayOverview(state.dayFilter);
  }

  function addRouteDirectionArrows(latLngs, color, event, routeIndex) {
    if (latLngs.length < 3) return [];
    const fractions = [1 / 3, 2 / 3];
    return fractions.flatMap((fraction, arrowIndex) => {
      const pose = routeArrowPose(latLngs, fraction); if (!pose) return [];
      const marker = L.marker(pose.latLng, { icon: L.divIcon({ className: 'route-direction-arrow-wrap', iconSize: [12, 12], iconAnchor: [6, 6], html: `<span class="route-direction-arrow" style="--bearing:${pose.bearing}deg;color:${color}">➤</span>` }), interactive: true, keyboard: false, zIndexOffset: 250 + routeIndex * 2 + arrowIndex });
      marker._routeArrowFraction = fraction;
      marker.on('click', () => focusScheduleEvent(event.scheduleIndex, { skipDriveQuery: true }));
      marker.addTo(getDayOverviewLayer());
      return [marker];
    });
  }

  function addRouteSequenceBadge(latLngs, color, sequence) {
    const pose = routeArrowPose(latLngs, .5); if (!pose) return null;
    return L.marker(pose.latLng, {
      icon: L.divIcon({ className: 'route-sequence-badge-wrap', iconSize: [22, 22], iconAnchor: [11, 11], html: `<span class="route-sequence-badge" style="--route-sequence-color:${color}">${sequence}</span>` }),
      interactive: false,
      keyboard: false,
      zIndexOffset: 700
    }).addTo(getDayOverviewLayer());
  }

  function renderMapRouteLegend(date) {
    let mapRouteLegend = getMapRouteLegend();
    if (!mapRouteLegend) { mapRouteLegend = document.createElement('div'); mapRouteLegend.className = 'map-route-legend'; $('#map')?.append(mapRouteLegend); setMapRouteLegend(mapRouteLegend); }
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
    const driveEvents = activeDate ? dayDriveEvents(activeDate).map(({ event }) => event) : activeEvents.filter(event => event.type === 'drive');
    const driveCount = driveEvents.length;
    const routeLegend = driveEvents.map((event, index) => `<div><i class="route-legend-swatch" style="background:${routeColorForSegment(activeDate, index, false, driveCount)}"></i>${escapeHtml(event.start ? `${event.start} · ` : '')}${escapeHtml(event.title || `路程 ${index + 1}`)}</div>`).join('');
    mapRouteLegend.innerHTML = `<b>${activeDate ? `${escapeHtml(activeDate)} 图例` : '地图图例'}</b>${routeLegend}${placeTypes.map(type => `<div><i style="${mapLegendPointStyle(type)}"></i>${escapeHtml(mapDisplayTypeName(type))}</div>`).join('')}<small class="map-legend-note">路程颜色与地图对应；地名为白底黑边，其余点位按地点库类别着色。</small>`;
    mapRouteLegend.hidden = !(driveCount || placeTypes.length);
  }

  return { showRouteOnMap, removeRoute, addRouteDirectionArrows, addRouteSequenceBadge, renderMapRouteLegend };
}
