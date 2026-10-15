import { downloadCanvasPng, pngFilePart } from '../export/index.js?v=map-photo-connectors-20260825-1';
import { bindMapExport } from '../export/map-export.js?v=map-photo-connectors-20260825-1';
import { bindScheduleExport } from '../export/schedule-export.js';

export function bindRuntimeExports({
  $,
  state,
  api,
  mapState,
  markerColors,
  renderSchedule,
  applyDayFilter,
  scheduleContainer,
  mapContainer,
  scheduleBinder = bindScheduleExport,
  mapBinder = bindMapExport,
  filePart = pngFilePart,
  downloadPng = downloadCanvasPng
}) {
  const schedule = scheduleBinder({
    $, state, renderSchedule, applyDayFilter,
    pngFilePart: filePart,
    downloadCanvasPng: downloadPng,
    container: scheduleContainer
  });
  const map = mapBinder({
    $, api,
    getMap: mapState.getMap,
    getLayers: mapState.getLayers,
    markerColors,
    pngFilePart: filePart,
    downloadCanvasPng: downloadPng,
    container: mapContainer
  });
  return { schedule, map };
}
