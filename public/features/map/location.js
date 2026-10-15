// Browser geolocation and its Leaflet layer belong to the map feature.
// Runtime only invokes locate() and receives presentation status through callbacks.
export function createMapLocationController({
  getMap,
  getLeaflet = () => window.L,
  getGeolocation = () => navigator.geolocation,
  reportStatus = () => {},
  showMessage = () => {}
}) {
  let locationLayer = null;

  const reportError = message => {
    reportStatus('error', message);
    showMessage(message);
  };

  function locate() {
    const map = getMap();
    if (!map) { reportError('地图尚未就绪，请稍后再试'); return; }
    const geolocation = getGeolocation();
    if (!geolocation) { reportError('当前浏览器不支持定位'); return; }
    reportStatus('loading', '正在获取当前位置');
    geolocation.getCurrentPosition(position => {
      const leaflet = getLeaflet();
      if (!leaflet || !getMap()) { reportError('地图尚未就绪，请稍后再试'); return; }
      const latLng = [position.coords.latitude, position.coords.longitude];
      if (locationLayer) map.removeLayer(locationLayer);
      locationLayer = leaflet.layerGroup().addTo(map);
      if (Number.isFinite(position.coords.accuracy)) {
        leaflet.circle(latLng, {
          radius: position.coords.accuracy, color: '#1976d2', weight: 1,
          fillColor: '#64b5f6', fillOpacity: .12, interactive: false
        }).addTo(locationLayer);
      }
      leaflet.marker(latLng, {
        zIndexOffset: 1200,
        icon: leaflet.divIcon({
          className: 'current-location-marker', iconSize: [24, 24], iconAnchor: [12, 12],
          html: '<span aria-hidden="true"></span>'
        })
      }).bindPopup(`<b>我的当前位置</b><br><small>定位精度约 ${Math.round(position.coords.accuracy || 0)} 米</small>`).addTo(locationLayer);
      map.setView(latLng, Math.max(map.getZoom(), 14), { animate: true });
      reportStatus('success', '已定位到当前位置');
      showMessage('已定位到当前位置');
    }, error => {
      const message = error?.code === 1
        ? '定位权限被拒绝，请在浏览器设置中允许定位。'
        : error?.code === 2
          ? '暂时无法确定位置，请到开阔处后重试。'
          : error?.code === 3
            ? '定位请求超时，请检查网络后重试。'
            : '无法获取当前位置，请稍后重试。';
      reportError(message);
    }, { enableHighAccuracy: true, timeout: 8000 });
  }

  function destroy() {
    const map = getMap();
    if (map && locationLayer) map.removeLayer(locationLayer);
    locationLayer = null;
  }

  return { locate, destroy };
}
