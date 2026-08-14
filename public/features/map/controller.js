// 地图控制器：管理 Leaflet 实例生命周期、点击/缩放行为与地图选择。
// 所有图层与状态经 getter/setter 注入；总览渲染复用 map/overview 的回调。
export function createMapController({
  state, $, geocode, save, mapCoords, isShareMode,
  getMap, setMap, getRouteLayer, setRouteLayer,
  getMarkerLayer, setMarkerLayer, getDayOverviewLayer, setDayOverviewLayer, getDayPhotoCalloutLayer, setDayPhotoCalloutLayer,
  getDayOverviewBounds, setDayOverviewBounds,
  getMapFocusDate, getDayPhotoCalloutRenderer, setDayPhotoCalloutRenderer,
  getDayPhotoCalloutLayoutTimer, setDayPhotoCalloutLayoutTimer,
  showDayOverview, refreshOverviewRouteWeights,
  selectedPointStyle, addSelectedPlacePhotoCallout, mapPointStyle,
  renderLocations, focusScheduleEvent
}) {
  let baseLayers = [];
  let activeBaseLayer = 0;
  let mapResizeObserver = null;
  let mapResizeFrame = 0;
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
    const map = L.map('map', { zoomControl: false }).setView([30.25, 120.16], 7);
    setMap(map);
    map.createPane('flightPane');
    map.getPane('flightPane').style.zIndex = 350;
    map.createPane('photoCalloutPane');
    map.getPane('photoCalloutPane').style.zIndex = 390;
    L.control.zoom({ position: 'topright' }).addTo(map);
    map.attributionControl.setPrefix('');
    const amapRoad = L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', { subdomains: ['1', '2', '3', '4'], maxZoom: 19, crossOrigin: 'anonymous', attribution: '&copy; 高德地图' });
    const amapSatellite = L.tileLayer('https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}', { subdomains: ['1', '2', '3', '4'], maxZoom: 19, opacity: .5, crossOrigin: 'anonymous', attribution: '&copy; 高德地图' });
    const amapSatelliteLabels = L.tileLayer('https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}', { subdomains: ['1', '2', '3', '4'], maxZoom: 19, crossOrigin: 'anonymous' });
    const amapTerrainRoads = L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', { subdomains: ['1', '2', '3', '4'], maxZoom: 19, opacity: .68, crossOrigin: 'anonymous' });
    const amapTerrain = L.layerGroup([amapSatellite, amapSatelliteLabels, amapTerrainRoads]);
    baseLayers = [
      { label: '道路', layer: amapRoad },
      { label: '卫星', layer: amapTerrain }
    ];
    activeBaseLayer = 0;
    amapRoad.addTo(map);
    L.control.layers(
      { '高德道路': amapRoad, '高德卫星影像（地形 + 道路）': amapTerrain },
      null,
      { position: 'topright', collapsed: document.documentElement.dataset.previewMode === 'desktop' }
    ).addTo(map);
    setMarkerLayer(L.layerGroup().addTo(map));
    setDayOverviewLayer(L.layerGroup().addTo(map));
    setDayPhotoCalloutLayer(L.layerGroup().addTo(map));
    map.on('click', event => {
      const target = event.originalEvent?.target;
      if (target?.closest?.('.leaflet-interactive,.leaflet-marker-icon,.leaflet-popup,.leaflet-control')) return;
      clearMapSelection();
    });
    // 低缩放时用更细的线保留相近道路的真实差异，不改变路线几何。
    map.on('zoomend', refreshOverviewRouteWeights);
    // 图片气泡以屏幕坐标避让，缩放/平移后必须重新选上下左右方向。
    map.on('moveend zoomend', () => {
      if (!getDayPhotoCalloutRenderer()) return;
      clearTimeout(getDayPhotoCalloutLayoutTimer());
      setDayPhotoCalloutLayoutTimer(setTimeout(() => getDayPhotoCalloutRenderer()?.(), 0));
    });
    document.querySelector('#map').classList.add('map-ready');
    $('.map-empty')?.remove();
    const mapContainer = map.getContainer();
    mapResizeObserver?.disconnect();
    mapResizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(mapResizeFrame);
      mapResizeFrame = requestAnimationFrame(() => {
        if (!getMap()) return;
        map.invalidateSize({ animate: false, pan: false });
        const overviewBounds = getDayOverviewBounds();
        if (!getRouteLayer() && overviewBounds?.isValid?.()) {
          map.fitBounds(overviewBounds, { padding: [38, 38], maxZoom: 12, animate: false });
        }
      });
    });
    mapResizeObserver.observe(mapContainer);
    return true;
  }

  function cycleBaseLayer() {
    const map = getMap();
    if (!map || baseLayers.length < 2) return '';
    baseLayers.forEach(item => map.removeLayer(item.layer));
    activeBaseLayer = (activeBaseLayer + 1) % baseLayers.length;
    baseLayers[activeBaseLayer].layer.addTo(map);
    return baseLayers[activeBaseLayer].label;
  }

  function fitOverview() {
    const map = getMap(), bounds = getDayOverviewBounds();
    if (!map || !bounds?.isValid?.()) return false;
    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 12 });
    return true;
  }

  function fitSelectionWithDayContext(selectionBounds, maxZoom = 12) {
    const map = getMap();
    if (!map || !selectionBounds?.isValid?.()) return;
    const combined = L.latLngBounds([]);
    const dayOverviewBounds = getDayOverviewBounds();
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
    getDayOverviewLayer()?.eachLayer(updateLayer);
    getMarkerLayer()?.eachLayer(updateLayer);
    $('#map')?.classList.toggle('has-map-selection', active);
  }

  async function clearMapSelection() {
    const map = getMap();
    state.selectedIndex = null;
    document.querySelectorAll('.calendar-block.selected,.item.selected').forEach(node => node.classList.remove('selected'));
    let routeLayer = getRouteLayer();
    if (routeLayer) { map.removeLayer(routeLayer); setRouteLayer(null); }
    setOverviewFocusOpacity(false);
    const date = state.dayFilter || getMapFocusDate();
    await showDayOverview(date);
    $('#mapDayFilter').value = date || '';
  }

  async function showPlaceOnMap(placeId) {
    const map = getMap();
    const place = state.locations.find(item => item.id === placeId);
    if (!place) return;
    if (!map && !(await initMap())) return;
    let point = place.resolved;
    if (!point?.location) {
      if (isShareMode) { alert('共享版本中该地点尚未保存坐标。'); return; }
      if (!place.address) { alert('请先在编辑窗口中填写详细地址并查询高德位置。'); return; }
      try {
        const result = await geocode(place.address, place.name);
        point = { name: result.name || place.name, address: result.formatted_address || place.address, location: result.location };
        place.resolved = point;
        save();
      } catch (error) { alert(error.message || '暂时无法定位这个地点。'); return; }
    }
    const [lng, lat] = mapCoords(...point.location.split(',').map(Number));
    let routeLayer = getRouteLayer();
    if (routeLayer) { getMap().removeLayer(routeLayer); setRouteLayer(null); }
    setOverviewFocusOpacity(true);
    routeLayer = L.featureGroup().addTo(getMap());
    setRouteLayer(routeLayer);
    L.circleMarker([lat, lng], selectedPointStyle(place.type)).addTo(routeLayer);
    addSelectedPlacePhotoCallout(routeLayer, [lat, lng], place);
    getMap().flyTo([lat, lng], Math.max(getMap().getZoom(), 11), { animate: true, duration: .45 });
    // 图片气泡承担高亮注记；详情在地图下方信息栏显示，避免 Leaflet 弹窗遮挡缩略图。
    getMap().closePopup();
    const detail = $('#routeDetail');
    if (detail) {
      const title = document.createElement('b'); title.className = 'detail-title'; title.textContent = place.name || '未命名地点';
      const typeLabels = { spot: '景点', geography: '地标', food: '餐饮', hotel: '住宿', shopping: '购物', transport: '交通', service: '服务区', fuel: '加油站', supply: '停车 / 补给' };
      const meta = document.createElement('span'); meta.className = 'detail-meta'; meta.textContent = typeLabels[place.type] || '地点';
      const address = document.createElement('small'); address.className = 'detail-note'; address.textContent = point.address || place.address || '地址待完善';
      detail.replaceChildren(title, meta, address);
    }
  }

  async function showStopsOnMap(nodes) {
    const map = getMap();
    if (!map) return;
    getDayOverviewLayer()?.clearLayers();
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
    getMarkerLayer().clearLayers();
    const latLngs = stops.map(({ node, point }) => { const [lng, lat] = mapCoords(...point.split(',').map(Number)); const marker = L.circleMarker([lat, lng], mapPointStyle(node.type)).bindPopup(`${node.date} · ${node.name}`).addTo(getMarkerLayer()); if (Number.isInteger(node.scheduleIndex)) marker.on('click', () => focusScheduleEvent(node.scheduleIndex)); return [lat, lng]; });
    map.fitBounds(L.latLngBounds(latLngs), { padding: [38, 38], maxZoom: 10 });
  }

  return { ensureLeafletLibrary, initMap, cycleBaseLayer, fitOverview, fitSelectionWithDayContext, setOverviewFocusOpacity, clearMapSelection, showPlaceOnMap, showStopsOnMap, destroy };
  function destroy() {
    clearTimeout(getDayPhotoCalloutLayoutTimer());
    setDayPhotoCalloutLayoutTimer(null);
    mapResizeObserver?.disconnect();
    mapResizeObserver = null;
    cancelAnimationFrame(mapResizeFrame);
    mapResizeFrame = 0;
    const map = getMap();
    if (map) { map.remove(); setMap(null); }
    setMarkerLayer(null); setDayOverviewLayer(null); setDayPhotoCalloutLayer(null);
    setDayOverviewBounds(null); setDayPhotoCalloutRenderer(null);
  }
}
