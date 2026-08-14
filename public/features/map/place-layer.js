// 地点图层样式与图片气泡：纯视觉辅助，地图实例经 getMap 注入。
import { calloutBox, boxesOverlap, segmentTouchesBox, layoutPhotoCallouts as calculatePhotoCalloutLayout } from './photo-layout.js';

export function createPlaceLayer({ getMap, placeTypeColor, escapeHtml }) {
  function mapPointStyle(type, options = {}) {
    const color = placeTypeColor(type);
    if (type === 'geography') return { radius: 3.5, color: '#111827', weight: 1.5, fillColor: '#ffffff', fillOpacity: 1, ...options };
    return { radius: 3.5, color, weight: 1.3, fillColor: color, fillOpacity: .95, ...options };
  }
  function selectedPointStyle(type, options = {}) {
    return mapPointStyle(type, { radius: 14, weight: 5, className: 'selected-map-point', ...options });
  }
  function photoCalloutScale(compact = false) {
    const zoom = getMap()?.getZoom?.() || 10;
    if (zoom <= 6) return compact ? .48 : .62;
    if (zoom <= 7) return compact ? .58 : .72;
    if (zoom <= 8) return compact ? .7 : .82;
    if (zoom <= 9) return compact ? .82 : .92;
    return 1;
  }
  function calloutPlacement(latLng, occupied = [], routeLatLngs = [], compact = false, scale = photoCalloutScale(compact)) {
    const map = getMap();
    const point = map?.latLngToContainerPoint(latLng);
    if (!point) return 'top';
    const routePoints = routeLatLngs.map(routePoint => map.latLngToContainerPoint(routePoint));
    const candidates = ['top', 'right', 'left', 'bottom'];
    const placement = candidates.map((candidate, index) => {
      const box = calloutBox(point, candidate, compact, scale);
      const routeHits = routePoints.slice(1).reduce((count, routePoint, routeIndex) => count + Number(segmentTouchesBox(routePoints[routeIndex], routePoint, box)), 0);
      const imageHits = occupied.reduce((count, item) => count + Number(boxesOverlap(box, item.box)), 0);
      // 先保证图片卡片彼此不重叠；在此基础上才尽量避开路线。
      return { candidate, box, score: imageHits * 10000 + routeHits * 100 + index };
    }).sort((first, second) => first.score - second.score)[0];
    occupied.push({ point, box: placement.box, placement: placement.candidate });
    return placement.candidate;
  }
  function layoutPhotoCallouts(entries, routeLatLngs = [], compact = false, scale = photoCalloutScale(compact)) {
    return calculatePhotoCalloutLayout(entries, routeLatLngs, { toPoint: point => getMap()?.latLngToContainerPoint(point), compact, scale });
  }
  function addSelectedPlacePhotoCallout(layer, latLng, place, fallbackPhoto = '', occupied = [], routeLatLngs = [], compact = false, placementOverride = '', scale = photoCalloutScale(compact)) {
    const photo = place?.photo || fallbackPhoto;
    if (!photo) return;
    const placement = placementOverride || calloutPlacement(latLng, occupied, routeLatLngs, compact, scale);
    const iconFor = portrait => {
      const width = (portrait ? (compact ? 64 : 84) : (compact ? 84 : 112)) * scale;
      const height = (portrait ? (compact ? 84 : 112) : (compact ? 63 : 84)) * scale;
      const anchors = {
        top: [width / 2, height + 10], right: [-10, height / 2],
        left: [width + 10, height / 2], bottom: [width / 2, -10]
      };
      return L.divIcon({
        className: 'selected-place-photo-marker',
        iconSize: [width + 4 * scale, height + 4 * scale],
        iconAnchor: anchors[placement],
        html: `<div class="map-place-photo-callout is-${placement} ${portrait ? 'is-portrait' : ''} ${compact ? 'is-compact' : ''}" style="--place-color:${placeTypeColor(place?.type)};width:${width}px;height:${height}px"><img src="${escapeHtml(photo)}" alt="${escapeHtml(place?.name || '地点')}图片"></div>`
      });
    };
    const marker = L.marker(latLng, {
      pane: 'photoCalloutPane',
      icon: iconFor(false),
      interactive: false,
      keyboard: false,
      zIndexOffset: -200
    }).addTo(layer);
    const probe = new Image();
    probe.onload = () => { if (probe.naturalHeight > probe.naturalWidth) marker.setIcon(iconFor(true)); };
    probe.src = photo;
  }
  return { mapPointStyle, selectedPointStyle, photoCalloutScale, calloutPlacement, layoutPhotoCallouts, addSelectedPlacePhotoCallout };
}
