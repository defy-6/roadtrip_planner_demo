// 分日地图总览：渲染每日地点、路线、航班与图片气泡。
// 地图实例与全部地图图层经 getter/setter 注入；路线绘制复用 routes/layer 的回调。
import { routeLengthMeters, routeArrowPose as calculateRouteArrowPose, translateRouteForDisplay as translateProjectedRoute } from './geometry.js';

export function createMapOverview({
  state, $, escapeHtml, mapCoords, geocode, api, isShareMode,
  map: {
    getMap, getRouteLayer, setRouteLayer, getMarkerLayer, getDayOverviewLayer, getDayPhotoCalloutLayer,
    getDayOverviewRequestId, setDayOverviewRequestId, getDayOverviewBounds, setDayOverviewBounds,
    getRenderedOverviewDate, setRenderedOverviewDate, getDayPhotoCalloutRenderer, setDayPhotoCalloutRenderer
  },
  layers: { renderMapRouteLegend, drawFlightItinerary, addRouteDirectionArrows, addRouteSequenceBadge, mapPointStyle, photoCalloutScale, layoutPhotoCallouts, addSelectedPlacePhotoCallout },
  routes: { routeForScheduleEvent, normalizedTransportMode, normalizedTravelMode, driveTravelMeta, shareCorridor },
  env: { ensureFlightAirportLinks },
  callbacks: { focusScheduleEvent, renderRouteTotals, save, setOverviewFocusOpacity }
}) {
  function routeColorForDate(date) {
    const palette = ['#2563eb', '#d97706', '#059669', '#7c3aed', '#dc2626', '#0891b2', '#be123c', '#65a30d', '#374151'];
    const dates = [...new Set(state.schedule.map(item => item.date).filter(Boolean))].sort();
    return palette[Math.max(0, dates.indexOf(date)) % palette.length];
  }
  function tintRouteColor(color, amount) {
    const value = color.replace('#', '');
    const channels = [0, 2, 4].map(offset => Number.parseInt(value.slice(offset, offset + 2), 16));
    const tinted = channels.map(channel => Math.round(channel + (255 - channel) * amount));
    return `#${tinted.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
  }
  function dayDriveEvents(date) {
    return state.schedule
      .map((event, scheduleIndex) => ({ event, scheduleIndex }))
      .filter(({ event }) => event.type === 'drive' && event.date === date)
      .sort((first, second) => `${first.event.start || '99:99'}:${first.scheduleIndex}`.localeCompare(`${second.event.start || '99:99'}:${second.scheduleIndex}`));
  }
  function routeColorForSegment(date, routeIndex = 0, allDates = false, count = 1) {
    if (allDates) return routeColorForDate(date);
    const progress = count <= 1 ? 0 : routeIndex / (count - 1);
    // 同一日期保持同一色相，时间越晚越浅；避免多段线路看起来彼此无关。
    return tintRouteColor(routeColorForDate(date), .08 + progress * .48);
  }
  function overviewRouteWeight(allDates = false) {
    const zoom = getMap()?.getZoom?.() || 7;
    if (zoom <= 6) return allDates ? 3.2 : 3.6;
    if (zoom <= 8) return allDates ? 3.5 : 4;
    if (zoom <= 10) return allDates ? 3.9 : 4.5;
    return allDates ? 4.4 : 5;
  }
  function refreshOverviewRouteWeights() {
    getDayOverviewLayer()?.eachLayer(layer => {
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
  function routeOverviewStyle(date, allDates = false, routeIndex = 0, routeCount = 1) {
    if (!allDates) return { color: routeColorForSegment(date, routeIndex, false, routeCount), weight: overviewRouteWeight(false), opacity: .9, smoothFactor: 0, lineCap: 'round', lineJoin: 'round' };
    const dates = [...new Set(state.schedule.map(item => item.date).filter(Boolean))].sort();
    const index = Math.max(0, dates.indexOf(date));
    return { color: routeColorForDate(date), weight: overviewRouteWeight(true), opacity: .72, smoothFactor: 0, lineCap: 'round', lineJoin: 'round' };
  }
  // 视觉分道只处理真正共用较长走廊的路线：既要连续相近超过 20km，
  // 也要占较短路线至少 18%。端点是否相同并不作为判断条件。
  const routesShareVisualCorridor = shareCorridor;
  function translateRouteForDisplay(latLngs, offset) {
    const map = getMap();
    return translateProjectedRoute(latLngs, offset, map ? { toPoint: point => map.latLngToLayerPoint(point), toLatLng: (x, y) => map.layerPointToLatLng(L.point(x, y)) } : null);
  }
  function routeArrowPose(latLngs, fraction = .52) {
    const map = getMap();
    return calculateRouteArrowPose(latLngs, fraction, map ? { toPoint: point => map.latLngToLayerPoint(point), toLatLng: (x, y) => map.layerPointToLatLng(L.point(x, y)) } : null);
  }

  async function showDayOverview(date) {
    const map = getMap();
    setDayOverviewRequestId(getDayOverviewRequestId() + 1);
    const requestId = getDayOverviewRequestId();
    if (!map) return;
    renderMapRouteLegend(date);
    if (!isShareMode) await ensureFlightAirportLinks();
    let routeLayer = getRouteLayer();
    if (routeLayer) { map.removeLayer(routeLayer); setRouteLayer(null); }
    map.closePopup();
    getDayOverviewLayer().clearLayers(); getMarkerLayer().clearLayers(); getDayPhotoCalloutLayer()?.clearLayers();
    setDayPhotoCalloutRenderer(null);
    setOverviewFocusOpacity(false);
    setDayOverviewBounds(null);
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
    if (requestId !== getDayOverviewRequestId()) return;
    const bounds = [];
    places.forEach(place => {
      const point = resolved.get(place.id); if (!point) return;
      const [lng, lat] = mapCoords(...point.split(',').map(Number));
      const event = eventForPlace.get(place.id);
      if (event?.type !== 'flight') bounds.push([lat, lng]);
      const isFlightPlace = event?.type === 'flight';
      const marker = L.circleMarker([lat, lng], mapPointStyle(place.type || event?.type, { radius: isFlightPlace ? 2.5 : 3.5, ...(isFlightPlace ? { pane: 'flightPane', className: 'flight-airport-marker' } : {}) })).bindPopup(`<b>${escapeHtml(place.name)}</b><br>${escapeHtml(place.address)}`).addTo(getMarkerLayer());
      if (event) marker.on('click', () => focusScheduleEvent(event.scheduleIndex));
    });
    customPointEntries.forEach(pointEntry => {
      const point = resolved.get(pointEntry.key); if (!point) return;
      const [lng, lat] = mapCoords(...point.split(',').map(Number)); bounds.push([lat, lng]);
      L.circleMarker([lat, lng], mapPointStyle('drive')).bindPopup(`<b>${escapeHtml(pointEntry.name || pointEntry.title || '自定义地点')}</b><br>${escapeHtml(pointEntry.address)}`).on('click', () => focusScheduleEvent(pointEntry.event.scheduleIndex)).addTo(getMarkerLayer());
    });
    events.filter(event => event.type === 'flight').forEach(event => {
      drawFlightItinerary(getDayOverviewLayer(), event, event.scheduleIndex);
    });
    const routeEvents = events.filter(event => event.type === 'drive').sort((first, second) => `${first.start || '99:99'}:${first.scheduleIndex}`.localeCompare(`${second.start || '99:99'}:${second.scheduleIndex}`));
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
            const data = await api.calculateRoute({ origin: resolved.get(pointKeys[i - 1]), destination: resolved.get(pointKeys[i]), mode: normalizedTransportMode(links.transportMode), strategy: driveTravelMeta(links.travelMode).strategy, city: links.transit?.city, cityd: links.transit?.cityd });
            paths.push(data.route.paths[0]);
          }
          path = { duration: paths.reduce((sum, item) => sum + Number(item.duration), 0), distance: paths.reduce((sum, item) => sum + Number(item.distance), 0), tolls: paths.reduce((sum, item) => sum + Number(item.tolls || 0), 0), tollDistance: paths.reduce((sum, item) => sum + Number(item.toll_distance || 0), 0), steps: paths.flatMap(item => item.steps) };
          if (route) {
            route.amap = { ...(route.amap || {}), distance: path.distance, duration: path.duration, tolls: path.tolls, tollDistance: path.tollDistance, transportMode: normalizedTransportMode(links.transportMode), travelMode: normalizedTravelMode(links.travelMode), strategy: driveTravelMeta(links.travelMode).strategy, steps: path.steps.map(step => ({ polyline: step.polyline || '' })) };
            routeCacheChanged = true;
          }
        }
        if (requestId !== getDayOverviewRequestId()) return;
        const latLngs = path.steps.flatMap(step => (step.polyline || '').split(';').filter(Boolean).map(pair => { const [lng, lat] = mapCoords(...pair.split(',').map(Number)); return [lat, lng]; }));
        if (!latLngs.length) continue;
        bounds.push(...latLngs);
        routeRenderRecords.push({ latLngs, event, route, routeIndex });
      } catch { /* 单条路线失败时仍显示当天其他路线与地点。 */ }
    }
    const offsets = routeRenderRecords.map(() => 0);
    // 不论是全部日期还是单日，近距离共享走廊的路线都采用同一分道逻辑。
    // 单日优先按当天路线的时间顺序决定平移方向，确保渐变色线路仍然清晰可辨。
    if (routeRenderRecords.length > 1) {
      const nearbyGraph = routeRenderRecords.map(() => new Set());
      for (let first = 0; first < routeRenderRecords.length; first += 1) for (let second = first + 1; second < routeRenderRecords.length; second += 1) {
        const firstRoute = routeRenderRecords[first].latLngs, secondRoute = routeRenderRecords[second].latLngs;
        if (!shareCorridor(firstRoute, secondRoute)) continue;
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
          const currentKey = `${routeRenderRecords[current].event.date}:${routeRenderRecords[current].event.start || '99:99'}:${routeRenderRecords[current].routeIndex}`;
          const mainKey = `${routeRenderRecords[main].event.date}:${routeRenderRecords[main].event.start || '99:99'}:${routeRenderRecords[main].routeIndex}`;
          const direction = currentKey.localeCompare(mainKey) <= 0 ? -1 : 1;
          offsets[current] = direction * 5;
        });
      });
    }
    routeRenderRecords.forEach((record, recordIndex) => {
      const { latLngs, event, route, routeIndex } = record;
      const visualOffset = Math.max(-12, Math.min(12, offsets[recordIndex]));
      const overviewStyle = routeOverviewStyle(event.date, !date, routeIndex, routeRenderRecords.length);
      // 所有高德原始点都保留；仅对较短的近距离路线整体平移以形成视觉分道。
      const displayLatLngs = translateRouteForDisplay(latLngs, visualOffset);
      const line = L.polyline(displayLatLngs, overviewStyle);
      line._routeOverviewStyle = overviewStyle;
      line._routeAllDates = !date;
      line._routeOriginalLatLngs = latLngs;
      line._routeVisualOffset = visualOffset;
      line.on('mouseover', () => line.setStyle({ weight: Math.max(4, overviewRouteWeight(line._routeAllDates) + 2), opacity: 1 }));
      line.on('mouseout', () => line.setStyle({ ...overviewStyle, weight: overviewRouteWeight(line._routeAllDates) }));
      const selectRoute = clickEvent => {
        if (clickEvent?.originalEvent) L.DomEvent.stop(clickEvent);
        else clickEvent?.stopPropagation?.();
        getDayOverviewLayer().eachLayer(layer => {
          if (!layer._routeOverviewStyle || !layer.setStyle) return;
          layer.getElement()?.classList.toggle('selected-map-route', layer === line);
          layer.setStyle(layer === line
            ? { ...layer._routeOverviewStyle, weight: overviewRouteWeight(layer._routeAllDates) + 3, opacity: 1 }
            : { ...layer._routeOverviewStyle, opacity: .24 });
        });
        focusScheduleEvent(event.scheduleIndex, { skipDriveQuery: true });
      };
      line.on('click', selectRoute);
      line.addTo(getDayOverviewLayer());
      const lineElement = line.getElement();
      lineElement?.classList.add('map-overview-route');
      if (lineElement) lineElement.dataset.scheduleIndex = String(event.scheduleIndex);
      lineElement?.addEventListener('pointerup', selectRoute);
      // 触屏上不要强迫用户精准点中 4px 的可见线：用透明宽线扩大命中区，视觉仍由上面的真实路线承担。
      const hitLine = L.polyline(displayLatLngs, { color: '#000', weight: 24, opacity: .001, interactive: true, smoothFactor: 0 });
      hitLine.on('click', selectRoute);
      hitLine.addTo(getDayOverviewLayer());
      const hitElement = hitLine.getElement();
      hitElement?.classList.add('map-route-hit');
      if (hitElement) hitElement.dataset.scheduleIndex = String(event.scheduleIndex);
      hitElement?.addEventListener('pointerup', selectRoute);
      hitElement?.addEventListener('click', selectRoute);
      line._routeArrowMarkers = addRouteDirectionArrows(displayLatLngs, overviewStyle.color, event, routeIndex);
      if (date) line._routeSequenceBadge = addRouteSequenceBadge(displayLatLngs, overviewStyle.color, routeIndex + 1);
      displayedRouteCount += 1;
    });
    // 图片气泡必须在 fitBounds 完成后再按屏幕坐标避让；否则缩放会让原本不相交的气泡重新重叠。
    const renderDayPhotoCallouts = () => {
      if (requestId !== getDayOverviewRequestId() || !date || !getDayPhotoCalloutLayer()) return;
      getDayPhotoCalloutLayer().clearLayers();
      const photoCalloutOccupied = [];
      const renderedPhotoCallouts = new Set();
      const dayRouteLatLngs = routeRenderRecords.flatMap(record => record.latLngs);
      const photoScale = photoCalloutScale(true);
      const photoEntries = places.flatMap(place => {
        const location = resolved.get(place.id); if (!location || !place.photo) return [];
        const [lng, lat] = mapCoords(...location.split(',').map(Number));
        const calloutKey = place.id || `${lat.toFixed(6)},${lng.toFixed(6)}`;
        if (renderedPhotoCallouts.has(calloutKey)) return [];
        renderedPhotoCallouts.add(calloutKey);
        return [{ key: calloutKey, place, latLng: [lat, lng] }];
      });
      const placements = layoutPhotoCallouts(photoEntries, dayRouteLatLngs, true, photoScale);
      photoEntries.forEach(entry => addSelectedPlacePhotoCallout(getDayPhotoCalloutLayer(), entry.latLng, entry.place, '', photoCalloutOccupied, dayRouteLatLngs, true, placements.get(entry.key), photoScale));
    };
    setDayPhotoCalloutRenderer(date ? renderDayPhotoCallouts : null);
    if (routeCacheChanged) save();
    renderRouteTotals();
    if (bounds.length && requestId === getDayOverviewRequestId()) {
      setDayOverviewBounds(L.latLngBounds(bounds));
      if (date) {
        // 不依赖动画是否实际发生：moveend 优先，短延迟作为无位移时的兜底。
        map.once('moveend', renderDayPhotoCallouts);
        setTimeout(renderDayPhotoCallouts, 450);
      }
      map.fitBounds(getDayOverviewBounds(), { padding: [38, 38], maxZoom: 12 });
    } else renderDayPhotoCallouts();
    if (!Number.isInteger(state.selectedIndex)) {
      $('#routeDetail').innerHTML = `<b>${date ? `${escapeHtml(date)} 地图总览` : '全程地图总览'}</b><small>已显示 ${places.filter(place => resolved.has(place.id)).length + customPointEntries.filter(point => resolved.has(point.key)).length} 个关联地点与 ${displayedRouteCount} 条行程线路。点击时间表卡片可在此查看该事件的详细信息。</small>`;
    }
    if (requestId === getDayOverviewRequestId()) setRenderedOverviewDate(date || '');
  }

  return {
    showDayOverview, routeColorForDate, tintRouteColor, dayDriveEvents, routeColorForSegment,
    overviewRouteWeight, refreshOverviewRouteWeights, routeOverviewStyle,
    translateRouteForDisplay, routeArrowPose
  };
}
