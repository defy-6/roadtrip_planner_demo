// 时间表 PNG 导出：只负责导出按钮、预览对话框与画布生成，
// 不接触地图与路线；渲染回调（renderSchedule/applyDayFilter）由 runtime 注入。
import { nextPaint } from './canvas.js';

export function bindScheduleExport({ $, state, renderSchedule, applyDayFilter, pngFilePart, downloadCanvasPng, container }) {
  const preview = $('#scheduleExportPreview');
  let pendingCanvas = null;
  let previewUrl = '';
  let exporterPromise = null;

  function releasePreviewUrl() {
    if (!previewUrl) return;
    URL.revokeObjectURL(previewUrl); previewUrl = '';
  }

  function safeCanvasScale(width, height, preferred = 2) {
    const maxDimension = 4096;
    const maxPixels = 8_000_000;
    return Math.max(.25, Math.min(preferred, maxDimension / Math.max(1, width), maxDimension / Math.max(1, height), Math.sqrt(maxPixels / Math.max(1, width * height))));
  }

  async function showCanvasPreview(canvas) {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob?.size) throw new Error('当前时间表图片过大，PNG 编码失败。');
    releasePreviewUrl(); previewUrl = URL.createObjectURL(blob);
    const image = $('#scheduleExportPreviewImage'); image.src = previewUrl;
    await new Promise((resolve, reject) => {
      if (image.complete && image.naturalWidth) { resolve(); return; }
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', () => reject(new Error('时间表 PNG 预览加载失败。')), { once: true });
    });
    preview.showModal();
  }

  function ensureExporter() {
    if (window.html2canvas) return Promise.resolve(true);
    exporterPromise ||= new Promise(resolve => {
      const script = document.createElement('script');
      script.src = './vendor/leaflet/html2canvas.min.js';
      script.onload = () => resolve(Boolean(window.html2canvas));
      script.onerror = () => resolve(false);
      document.head.append(script);
    });
    return exporterPromise;
  }

  function normalizeExportCardLabels(grid) {
    grid.querySelectorAll('.calendar-block').forEach(card => {
      const directChildren = [...card.children];
      const parentHeader = directChildren.find(node => node.classList.contains('calendar-parent-header'));
      const timeNode = parentHeader?.querySelector('.calendar-event-time') || directChildren.find(node => node.classList.contains('calendar-event-time'));
      const typeNode = parentHeader?.querySelector('.calendar-event-type') || directChildren.find(node => node.classList.contains('calendar-event-type'));
      const titleNode = parentHeader?.querySelector('.calendar-parent-title') || directChildren.find(node => node.tagName === 'B');
      const fallback = String(card.dataset.compactLabel || '').split('·').map(part => part.trim()).filter(Boolean);
      const label = document.createElement('span'); label.className = 'schedule-export-card-label';
      const time = document.createElement('time'); time.textContent = timeNode?.textContent?.trim() || fallback[0] || '';
      const type = document.createElement('em'); type.textContent = typeNode?.textContent?.trim() || fallback[1] || '';
      const title = document.createElement('b'); title.textContent = titleNode?.textContent?.trim() || fallback.at(-1) || '';
      label.append(time, type, title);
      [parentHeader, timeNode, typeNode, titleNode].filter(Boolean).forEach(node => node.remove());
      card.querySelectorAll('.calendar-overnight-label').forEach(node => node.remove());
      const cardHeight = Number.parseFloat(card.style.height) || card.getBoundingClientRect().height;
      if (cardHeight >= 56) card.classList.add('export-title-lines-3');
      else if (cardHeight >= 28) card.classList.add('export-title-lines-2');
      card.classList.remove('compact');
      card.prepend(label);
    });
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'exportSchedulePng';
  button.className = 'ghost';
  button.setAttribute('aria-busy', 'false');
  button.textContent = '导出时间表 PNG';
  container.append(button);

  async function exportAllSchedulePng() {
    if (!(await ensureExporter())) {
      window.showSaveToast?.('PNG 导出组件加载失败，请检查网络后重试。', 'error');
      button.focus();
      return;
    }
    const oldFilter = state.dayFilter;
    const oldText = button.textContent;
    let exportHost = null;
    try {
      button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = '正在生成…';
      state.dayFilter = '';
      renderSchedule(state.schedule, { exportMode: true });
      await nextPaint();
      const sourceGrid = $('#schedule .calendar-grid');
      if (!sourceGrid) throw new Error('时间表为空，无法导出。');
      // “行程方案”页会隐藏真正的时间表。复制到屏幕外的可渲染容器，
      // 避免 iOS Safari 对 display:none 后代生成不可解码的空 PNG。
      exportHost = document.createElement('div'); exportHost.id = 'schedulePngRenderHost'; exportHost.className = 'schedule schedule-export-host'; exportHost.setAttribute('aria-hidden', 'true');
      exportHost.style.cssText = 'position:fixed;left:0;top:0;z-index:-1;width:max-content;max-width:none;overflow:visible;pointer-events:none;background:#fffdf8;';
      const grid = sourceGrid.cloneNode(true); exportHost.append(grid); document.body.append(exportHost);
      grid.classList.add('png-export', 'schedule-export-grid');
      const exportDays = grid.querySelectorAll('.calendar-head').length;
      grid.style.setProperty('grid-template-columns', `64px repeat(${exportDays},270px)`, 'important');
      grid.style.setProperty('width', 'max-content', 'important');
      // 隐藏规则仍会让 html2canvas 遍历详情节点；导出副本直接移除它们，
      // 既避免旧详情样式干扰，也减少手机端长时间表的生成耗时。
      grid.querySelectorAll('.calendar-block > small, .calendar-parent-content').forEach(node => node.remove());
      normalizeExportCardLabels(grid);
      await nextPaint();
      const images = [...grid.querySelectorAll('img')];
      await Promise.allSettled(images.map(image => image.complete ? image.decode?.().catch(() => {}) : new Promise(resolve => { image.addEventListener('load', resolve, { once: true }); image.addEventListener('error', resolve, { once: true }); })));
      await document.fonts?.ready;
      const width = grid.scrollWidth, height = grid.scrollHeight;
      if (!width || !height) throw new Error('时间表当前不可见，无法计算导出尺寸。');
      const scale = safeCanvasScale(width, height);
      const canvas = await window.html2canvas(grid, {
        backgroundColor: '#fffdf8', scale, useCORS: true, logging: false,
        width, height, windowWidth: width, windowHeight: height
      });
      if (!canvas.width || !canvas.height || canvas.width > 4096 || canvas.height > 4096 || canvas.width * canvas.height > 8_000_000) throw new Error('时间表尺寸超过当前浏览器的 PNG 限制。');
      pendingCanvas = canvas;
      await showCanvasPreview(canvas);
    } catch (error) {
      $('#scheduleExportPreviewImage').removeAttribute('src'); releasePreviewUrl(); pendingCanvas = null;
      window.showSaveToast?.(error.message || '时间表 PNG 导出失败。', 'error');
      queueMicrotask(() => button.focus());
    } finally {
      exportHost?.remove();
      state.dayFilter = oldFilter;
      renderSchedule(state.schedule); applyDayFilter();
      button.disabled = false; button.setAttribute('aria-busy', 'false'); button.textContent = oldText;
    }
  }

  button.addEventListener('click', exportAllSchedulePng);
  $('#closeScheduleExportPreview').onclick = () => { preview.close(); $('#scheduleExportPreviewImage').removeAttribute('src'); releasePreviewUrl(); };
  $('#downloadScheduleExportPreview').onclick = async () => {
    if (!pendingCanvas) return;
    await downloadCanvasPng(pendingCanvas, `${pngFilePart($('#tripName').value)}-全部日期时间表.png`);
  };

  return { button, exportAllSchedulePng };
}
