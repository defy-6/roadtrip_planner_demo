// 地图 PNG 导出：把当前 Leaflet 图层与分日总览绘制到画布。
// 地图实例与图层由 runtime 通过 getMap/getLayers 注入，本模块不管理地图生命周期。
import { drawLeafletLayerToCanvas, layerOpacity, mapExportLayerPriority } from './canvas.js?v=map-photo-connectors-20260825-1';

export function bindMapExport({ $, api, getMap, getLayers, markerColors, pngFilePart, downloadCanvasPng, container }) {
  const preview = $('#mapExportPreview');
  let pendingCanvas = null;
  const safeImages = new Map();

  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'exportMapPng';
  button.className = 'ghost map-export-control';
  button.setAttribute('aria-busy', 'false');
  button.textContent = '导出当前地图 PNG';
  container.append(button);

  function renderCurrentMapCanvas() {
    const map = getMap();
    const target = $('#map');
    const bounds = target.getBoundingClientRect();
    const mapSize = map.getSize();
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bounds.width * scale); canvas.height = Math.round(bounds.height * scale);
    const context = canvas.getContext('2d');
    context.fillStyle = '#f7f4ed'; context.fillRect(0, 0, canvas.width, canvas.height);
    target.querySelectorAll('.leaflet-tile').forEach(tile => {
      if (!tile.complete || !tile.naturalWidth) return;
      const rect = tile.getBoundingClientRect();
      context.save();
      context.globalAlpha = layerOpacity(tile, target);
      const image = safeImages.get(tile.currentSrc || tile.src);
      if (image) context.drawImage(image, (rect.left - bounds.left) * scale, (rect.top - bounds.top) * scale, rect.width * scale, rect.height * scale);
      context.restore();
    });
    const layers = [];
    const collect = group => group?.eachLayer?.(layer => { if (layer.eachLayer && !(layer instanceof L.Polyline)) collect(layer); else layers.push(layer); });
    getLayers().forEach(group => collect(group));
    // Leaflet 使用地图内部 CSS 像素定位图层。导出时只根据最终画布尺寸
    // 做一次缩放，避免 iOS Safari 重复应用各 Pane 的 translate3d。
    const ratioX = bounds.width / Math.max(1, mapSize.x);
    const ratioY = bounds.height / Math.max(1, mapSize.y);
    const toPoint = latLng => {
      const point = map.latLngToContainerPoint(latLng);
      return { x: point.x * ratioX, y: point.y * ratioY };
    };
    const layerKind = layer => {
      const markerClass = layer instanceof L.Marker ? (layer.options.icon?.options?.className || '') : '';
      if (layer instanceof L.CircleMarker || markerClass.includes('selected-place-photo-marker')) return 'place';
      if (layer instanceof L.Polyline) return 'route';
      if (markerClass.includes('route-direction-arrow') || markerClass.includes('flight-arrow-marker') || layer._routeArrowFraction !== undefined) return 'arrow';
      if (markerClass.includes('route-sequence-badge-wrap')) return 'annotation';
      return '';
    };
    layers.sort((left, right) => {
      const z = layer => Number(map.getPane(layer.options?.pane || 'overlayPane')?.style.zIndex || 400);
      return mapExportLayerPriority(layerKind(left)) - mapExportLayerPriority(layerKind(right)) || z(left) - z(right);
    }).forEach(layer => {
      try { drawLeafletLayerToCanvas(context, layer, scale, { toPoint, markerColors, safeImages }); }
      catch (error) { console.warn('跳过无法绘制的地图图层', error); }
    });
    return canvas;
  }

  async function prepareSafeImages(target) {
    const sources = [...target.querySelectorAll('.leaflet-tile, .selected-place-photo-marker img')]
      .map(image => image.currentSrc || image.src).filter(Boolean);
    const unique = [...new Set(sources)];
    await Promise.all(unique.map(async source => {
      if (safeImages.has(source)) return;
      try {
        const dataUrl = source.startsWith('data:') ? source : (await api.proxyMapImage(source)).dataUrl;
        const image = new Image(); image.src = dataUrl;
        await (image.decode ? image.decode() : new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; }));
        safeImages.set(source, image);
      } catch (error) { console.warn('地图导出资源同源化失败', source, error); }
    }));
  }

  async function exportDrivingMapPng() {
    const map = getMap();
    if (!map) {
      window.showSaveToast?.('请先打开地图再导出。', 'warning');
      button.focus();
      return;
    }
    const oldText = button.textContent;
    try {
      button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = '正在生成…';
      map.stop?.();
      map.invalidateSize();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await new Promise(resolve => setTimeout(resolve, 180));
      const target = $('#map');
      const bounds = target.getBoundingClientRect();
      if (!bounds.width || !bounds.height) throw new Error('地图当前不可见，无法导出。');
      const images = [...target.querySelectorAll('.leaflet-tile')];
      const tileReady = Promise.allSettled(images.map(image => image.complete
        ? image.decode?.().catch(() => {})
        : new Promise(resolve => { image.addEventListener('load', resolve, { once: true }); image.addEventListener('error', resolve, { once: true }); })));
      // 移动网络中个别瓦片可能永久停在 pending；最多等待 3.5 秒后使用已完成瓦片继续。
      await Promise.race([tileReady, new Promise(resolve => setTimeout(resolve, 3500))]);
      await document.fonts?.ready;
      await prepareSafeImages(target);
      const canvas = renderCurrentMapCanvas();
      const previewUrl = canvas.toDataURL('image/png');
      pendingCanvas = canvas;
      $('#mapExportPreviewImage').src = previewUrl;
      preview.showModal();
    } catch (error) {
      console.error('地图 PNG 导出失败', error);
      window.showSaveToast?.(`地图 PNG 导出失败：${error?.message || '浏览器无法创建图片'}`, 'error');
      queueMicrotask(() => button.focus());
    } finally { button.disabled = false; button.setAttribute('aria-busy', 'false'); button.textContent = oldText; }
  }

  button.addEventListener('click', exportDrivingMapPng);
  $('#closeMapExportPreview').onclick = () => preview.close();
  $('#downloadMapExportPreview').onclick = async () => {
    if (!pendingCanvas) return;
    await downloadCanvasPng(pendingCanvas, `${pngFilePart($('#tripName').value)}-当前地图.png`);
  };

  return { button, exportDrivingMapPng };
}
