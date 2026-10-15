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

export function arrowDirectionVector(bearing) {
  const radians = Number(bearing || 0) * Math.PI / 180;
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

export function mapExportLayerPriority(kind) {
  return ({ place: 10, route: 20, arrow: 30, annotation: 40 })[kind] || 0;
}

export function mapExportPointRadius(radius) {
  const source = Number(radius) || 4;
  return Math.max(2.25, Math.min(3.5, source * .6));
}

export function roundedRectPath(context, x, y, width, height, radius) {
  if (typeof context.roundRect === 'function') {
    context.roundRect(x, y, width, height, radius);
    return;
  }
  const r = Math.max(0, Math.min(Number(radius) || 0, Math.abs(width) / 2, Math.abs(height) / 2));
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function drawRouteArrow(context, point, bearing, color, scale) {
  const direction = arrowDirectionVector(bearing);
  const normal = { x: -direction.y, y: direction.x };
  const tip = { x: point.x + direction.x * 6, y: point.y + direction.y * 6 };
  const tail = { x: point.x - direction.x * 5, y: point.y - direction.y * 5 };
  context.save(); context.fillStyle = color; context.strokeStyle = '#fff'; context.lineWidth = .8 * scale; context.lineJoin = 'round';
  context.beginPath();
  context.moveTo(tip.x * scale, tip.y * scale);
  context.lineTo((tail.x + normal.x * 4) * scale, (tail.y + normal.y * 4) * scale);
  context.lineTo((point.x - direction.x * 2) * scale, (point.y - direction.y * 2) * scale);
  context.lineTo((tail.x - normal.x * 4) * scale, (tail.y - normal.y * 4) * scale);
  context.closePath(); context.fill(); context.stroke(); context.restore();
}

// 把单个 Leaflet 图层绘制到 2D context。toPoint = latLng => map.latLngToContainerPoint(latLng)。
export function drawLeafletLayerToCanvas(context, layer, scale, { toPoint, markerColors = {}, safeImages = new Map() }) {
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
    const point = toPoint(layer.getLatLng()), radius = mapExportPointRadius(layer.options.radius) * scale;
    context.save();
    context.globalAlpha = Number.isFinite(layer.options.fillOpacity) ? layer.options.fillOpacity : 1;
    context.fillStyle = layer.options.fillColor || layer.options.color || '#1d6b4f';
    context.beginPath(); context.arc(point.x * scale, point.y * scale, radius, 0, Math.PI * 2); context.fill();
    if (layer.options.weight) { context.globalAlpha = Number.isFinite(layer.options.opacity) ? layer.options.opacity : 1; context.strokeStyle = layer.options.color || '#fff'; context.lineWidth = Math.min(1.25, layer.options.weight) * scale; context.stroke(); }
    context.restore();
    return;
  }
  const markerClass = layer instanceof L.Marker ? (layer.options.icon?.options?.className || '') : '';
  if (layer instanceof L.Marker && markerClass.includes('selected-place-photo-marker')) {
    const sourceImage = layer.getElement()?.querySelector('img');
    const image = safeImages.get(sourceImage?.currentSrc || sourceImage?.src);
    if (!image) {
      const point = toPoint(layer.getLatLng());
      context.save(); context.fillStyle = markerColors.spot || '#1d6b4f'; context.strokeStyle = '#fff'; context.lineWidth = scale;
      context.beginPath(); context.arc(point.x * scale, point.y * scale, 3 * scale, 0, Math.PI * 2); context.fill(); context.stroke(); context.restore();
      return;
    }
    const point = toPoint(layer.getLatLng());
    const [width = 88, height = 68] = layer.options.icon?.options?.iconSize || [];
    const [anchorX = width / 2, anchorY = height / 2] = layer.options.icon?.options?.iconAnchor || [];
    const x = (point.x - anchorX) * scale, y = (point.y - anchorY) * scale;
    const pointX = point.x * scale, pointY = point.y * scale;
    const edgeX = Math.max(x, Math.min(pointX, x + width * scale));
    const edgeY = Math.max(y, Math.min(pointY, y + height * scale));
    context.save();
    context.strokeStyle = '#17644e'; context.lineWidth = 1.5 * scale; context.lineCap = 'round';
    context.beginPath(); context.moveTo(pointX, pointY); context.lineTo(edgeX, edgeY); context.stroke(); context.restore();
    context.save();
    context.beginPath(); roundedRectPath(context, x, y, width * scale, height * scale, 6 * scale); context.clip();
    context.drawImage(image, x, y, width * scale, height * scale);
    context.restore();
    context.save(); context.strokeStyle = '#17644e'; context.lineWidth = 2 * scale;
    context.beginPath(); roundedRectPath(context, x, y, width * scale, height * scale, 6 * scale); context.stroke(); context.restore();
    return;
  }
  if (layer instanceof L.Marker && markerClass.includes('route-sequence-badge-wrap')) {
    const point = toPoint(layer.getLatLng());
    const html = layer.options.icon?.options?.html || '';
    const color = (html.match(/--route-sequence-color:([^";]+)/) || [])[1] || '#1d6b4f';
    const label = (html.match(/>([^<>]+)<\/span>/) || [])[1] || '';
    context.save(); context.fillStyle = color; context.strokeStyle = '#fff'; context.lineWidth = 2 * scale;
    context.beginPath(); context.arc(point.x * scale, point.y * scale, 10 * scale, 0, Math.PI * 2); context.fill(); context.stroke();
    context.fillStyle = '#fff'; context.font = `700 ${10 * scale}px system-ui`; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(label, point.x * scale, point.y * scale); context.restore();
    return;
  }
  if (layer instanceof L.Marker && (layer._routeArrowFraction !== undefined || markerClass.includes('flight-arrow-marker'))) {
    const point = toPoint(layer.getLatLng());
    const style = layer.options.icon?.options?.html || '';
    const bearing = Number((style.match(/--(?:bearing|flight-arrow-angle):([\-\d.]+)deg/) || [])[1] || 0);
    const color = (style.match(/color:([^";]+)/) || [])[1] || (markerClass.includes('flight-arrow-marker') ? markerColors.flight : '#1d6b4f');
    drawRouteArrow(context, point, bearing, color, scale);
  }
}
