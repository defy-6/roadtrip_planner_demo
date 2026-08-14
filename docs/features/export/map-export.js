// 地图 PNG 导出：把当前 Leaflet 图层与分日总览绘制到画布。
// 地图实例与图层由 runtime 通过 getMap/getLayers 注入，本模块不管理地图生命周期。
import { drawLeafletLayerToCanvas, layerOpacity } from './canvas.js';

export function bindMapExport({ $, state, getMap, getLayers, showDayOverview, routeColorForDate, markerColors, pngFilePart, downloadCanvasPng, container }) {
  const preview = $('#mapExportPreview');
  let pendingCanvas = null;

  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'exportMapPng';
  button.className = 'ghost map-export-control';
  button.textContent = '导出地图 PNG';
  container.append(button);

  function drawMapExportLegend(context, scale) {
    const dates = [...new Set(state.schedule.filter(event => event.type === 'drive' && event.date).map(event => event.date))].sort();
    const rows = dates.map(date => ({ label: date, color: routeColorForDate(date) }));
    rows.push(
      { label: '地点（按地点类型着色）', color: markerColors.spot, marker: true },
      { label: '机场', color: markerColors.flight, marker: true },
      { label: '航线', color: markerColors.flight, flight: true }
    );
    if (!rows.length) return;
    const padding = 10 * scale, lineHeight = 16 * scale, width = 176 * scale, height = padding * 2 + rows.length * lineHeight;
    context.save();
    context.fillStyle = '#fffffff2'; context.strokeStyle = '#d8e1da'; context.lineWidth = scale;
    context.beginPath(); context.roundRect(12 * scale, 12 * scale, width, height, 7 * scale); context.fill(); context.stroke();
    context.font = `${10 * scale}px system-ui`; context.textBaseline = 'middle'; context.fillStyle = '#315540';
    rows.forEach((row, index) => {
      const y = 12 * scale + padding + index * lineHeight + lineHeight / 2;
      if (row.marker) {
        context.fillStyle = row.color;
        context.beginPath(); context.arc(34 * scale, y, 4 * scale, 0, Math.PI * 2); context.fill();
        context.strokeStyle = '#fff'; context.lineWidth = scale; context.stroke();
      } else {
        context.globalAlpha = row.flight ? .5 : 1;
        context.strokeStyle = row.color; context.lineWidth = row.flight ? 2.4 * scale : 3.2 * scale; context.lineCap = 'round';
        context.beginPath(); context.moveTo(22 * scale, y); context.lineTo(46 * scale, y); context.stroke();
      }
      context.fillText(row.label, 54 * scale, y);
    });
    context.restore();
  }

  function renderCurrentMapCanvas() {
    const map = getMap();
    const target = $('#map');
    const bounds = target.getBoundingClientRect();
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
      try { context.drawImage(tile, (rect.left - bounds.left) * scale, (rect.top - bounds.top) * scale, rect.width * scale, rect.height * scale); } catch { /* 单张瓦片失败不影响路线与其他底图。 */ }
      context.restore();
    });
    const layers = [];
    const collect = group => group?.eachLayer?.(layer => { if (layer.eachLayer && !(layer instanceof L.Polyline)) collect(layer); else layers.push(layer); });
    getLayers().forEach(group => collect(group));
    const toPoint = latLng => map.latLngToContainerPoint(latLng);
    layers.sort((left, right) => {
      const z = layer => Number(map.getPane(layer.options?.pane || 'overlayPane')?.style.zIndex || 400);
      return z(left) - z(right);
    }).forEach(layer => drawLeafletLayerToCanvas(context, layer, scale, { toPoint, markerColors }));
    drawMapExportLegend(context, scale);
    return canvas;
  }

  async function exportDrivingMapPng() {
    const map = getMap();
    if (!window.html2canvas || !map) { alert('地图 PNG 导出组件尚未就绪，请刷新页面后重试。'); return; }
    const oldText = button.textContent;
    const oldFilter = state.dayFilter;
    try {
      button.disabled = true; button.textContent = '正在生成…';
      await showDayOverview('');
      map.invalidateSize();
      await new Promise(resolve => setTimeout(resolve, 500));
      const canvas = renderCurrentMapCanvas();
      pendingCanvas = canvas;
      $('#mapExportPreviewImage').src = canvas.toDataURL('image/png');
      preview.showModal();
    } catch (error) {
      alert('地图 PNG 导出失败。请等待底图加载完成后重试。');
    } finally {
      await showDayOverview(oldFilter);
      button.disabled = false; button.textContent = oldText;
    }
  }

  button.addEventListener('click', exportDrivingMapPng);
  $('#closeMapExportPreview').onclick = () => preview.close();
  $('#downloadMapExportPreview').onclick = () => {
    if (!pendingCanvas) return;
    downloadCanvasPng(pendingCanvas, `${pngFilePart($('#tripName').value)}-自驾地图.png`);
  };

  return { button, exportDrivingMapPng };
}
