// 导出画布纯工具：不访问网络、不持有应用状态，只依赖 Leaflet 实例与 DOM。
export function nextPaint() {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

export function flattenMapLatLngs(latLngs) {
  return (latLngs || []).flatMap(item => Array.isArray(item) ? flattenMapLatLngs(item) : item ? [item] : []);
}

export function layerOpacity(element, stopAt) {
  let opacity = 1;
  for (let current = element; current && current !== stopAt; current = current.parentElement) {
    const value = Number.parseFloat(getComputedStyle(current).opacity);
    if (Number.isFinite(value)) opacity *= value;
  }
  return opacity;
}

// 把单个 Leaflet 图层绘制到 2D context。toPoint = latLng => map.latLngToContainerPoint(latLng)。
export function drawLeafletLayerToCanvas(context, layer, scale, { toPoint, markerColors = {} }) {
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
