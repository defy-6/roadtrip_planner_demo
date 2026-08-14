// 路线解析与高德查询：只负责把起终点/途经点解析为地点、调用高德接口计算路线。
// 不访问 DOM 模板；地图显示通过 showRouteOnMap 回调注入。
export function createRouteResolver({
  state, $, api, geocode, pause, escapeHtml, fmt,
  driveTravelMeta, normalizedTransportMode, normalizedTravelMode, transportModeMeta,
  showRouteOnMap, save, renderRouteTotals,
  findPlaceInPlanOrUniversal, confirmNewPlace
}) {
  async function resolveInlinePlace(name, address, type = 'spot') {
    let place = findPlaceInPlanOrUniversal(address, name);
    if (place) return place;
    const point = await geocode(address, name);
    place = findPlaceInPlanOrUniversal(address, name, point.location);
    if (!place) place = await confirmNewPlace({ type, name, address, fromEvent: true });
    if (!place) return null;
    Object.assign(place, { type, name, address, resolved: { name: point.name || name, address: point.formatted_address || address, location: point.location } });
    if (!state.locations.some(item => item.id === place.id)) state.locations.push(place);
    return place;
  }

  async function calculateDriveRoute(stops, sharedRoute, routeName, persist = true, travelMode = 'recommended', transportMode = 'driving', transit = {}) {
    $('#routeDetail').textContent = '正在调用高德计算此段路线…';
    try {
      const travel = driveTravelMeta(travelMode);
      const transport = normalizedTransportMode(transportMode);
      const geos = await Promise.all(stops.map(stop => geocode(stop.address, stop.title || stop.name)));
      const paths = [];
      for (let i = 1; i < geos.length; i += 1) { const data = await api.calculateRoute({ origin: geos[i - 1].location, destination: geos[i].location, mode: transport, strategy: travel.strategy, city: transit?.city, cityd: transit?.cityd }); paths.push(data.route.paths[0]); await pause(400); }
      const path = { duration: paths.reduce((sum, item) => sum + Number(item.duration), 0), distance: paths.reduce((sum, item) => sum + Number(item.distance), 0), tolls: paths.reduce((sum, item) => sum + Number(item.tolls || 0), 0), tollDistance: paths.reduce((sum, item) => sum + Number(item.toll_distance || 0), 0), steps: paths.flatMap(item => item.steps) };
      $('#duration').textContent = fmt(Number(path.duration)); $('#distance').textContent = `${(Number(path.distance) / 1000).toFixed(1)} 公里 · 此段路程`;
      const buffer = Number(state.preferences.buffer || 30);
      const queriedAt = new Date(); const isNightQuery = queriedAt.getHours() >= 21 || queriedAt.getHours() < 7;
      const amapRecord = { distance: path.distance, duration: path.duration, tolls: path.tolls, tollDistance: path.tollDistance, transportMode: transport, travelMode: normalizedTravelMode(travelMode), strategy: travel.strategy, queriedAt: queriedAt.toISOString(), queryPeriod: isNightQuery ? 'night' : 'day', engine: 'amap-v5', steps: path.steps.map(step => ({ polyline: step.polyline || '' })) };
      path.amap = amapRecord;
      showRouteOnMap(path, geos.map(item => item.location), stops.map(item => ({ ...item, name: item.title || item.name })), { name: sharedRoute?.name || routeName, routeId: sharedRoute?.id, amap: amapRecord });
      const tollText = transport === 'driving' ? `，过路费约 ${path.tolls.toFixed(0)} 元${path.tollDistance ? `（收费路段 ${(path.tollDistance / 1000).toFixed(1)} 公里）` : ''}` : '';
      const notice = transport === 'driving' ? `高德普通驾车接口不能指定未来出发时刻；夜间封闭、季节管制和临时交通规则可能使查询路线绕行。这里的时间仅作最低参考，按当前“${escapeHtml(state.preferences.pace)}”节奏建议额外预留 ${buffer} 分钟，并在实际出发前重新导航确认。` : '该结果为高德当前可用方案参考，实际步行、骑行或公共交通请以出发时导航与班次为准。';
      $('#routeDetail').innerHTML = `<b class="detail-title">${stops.map(stop => escapeHtml(stop.title || stop.name)).join(' → ')}</b><strong class="detail-key">${escapeHtml(transport === 'driving' ? travel.label : transportModeMeta(transport).label)} · ${(Number(path.distance) / 1000).toFixed(1)} 公里 · ${fmt(Number(path.duration))}${tollText}</strong><small class="detail-source">查询于 ${queriedAt.toLocaleString('zh-CN')}${transport === 'driving' && isNightQuery ? '（夜间查询）' : ''}。${notice}</small>`;
      if (sharedRoute && persist) { sharedRoute.amap = amapRecord; save(); renderRouteTotals(); }
      return path;
    } catch (error) { $('#routeDetail').textContent = error.message || '该路程暂时无法计算。'; }
  }

  return { resolveInlinePlace, calculateDriveRoute };
}
