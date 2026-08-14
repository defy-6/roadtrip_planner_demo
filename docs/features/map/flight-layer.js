// 航班图层：绘制航班 OD 曲线、关联机场地点。
// 地图实例与图层经 getter/setter 注入；机场解析复用 places/model 的 resolveFlightPlaces。
export function createFlightLayer({
  state, $, escapeHtml, mapCoords, markerColors, geocode, isShareMode, resolveFlightPlaces,
  getMap, getRouteLayer, setRouteLayer,
  focusScheduleEvent, renderLocations, renderSchedule, save,
  setOverviewFocusOpacity, fitSelectionWithDayContext
}) {
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
    return resolveFlightPlaces(entry, state.locations);
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
    const map = getMap();
    const entry = state.schedule[index]; if (!entry?.flightInfo || !map) return;
    try {
      if (!isShareMode) await linkFlightAirports(entry);
      const places = flightPlaces(entry);
      if (places.length < 2 || places.some(place => !place.resolved?.location)) throw new Error('机场位置尚未查询完成');
      let routeLayer = getRouteLayer();
      if (routeLayer) { map.removeLayer(routeLayer); setRouteLayer(null); }
      routeLayer = L.featureGroup().addTo(map);
      setRouteLayer(routeLayer);
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

  return { flightCurveLatLngs, drawFlightCurve, flightPlaces, drawFlightItinerary, ensureAirportPlace, linkFlightAirports, ensureFlightAirportLinks, showFlightOnMap };
}
