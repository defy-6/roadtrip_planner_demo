// 时间表 PNG 导出：只负责导出按钮、预览对话框与画布生成，
// 不接触地图与路线；渲染回调（renderSchedule/applyDayFilter）由 runtime 注入。
import { nextPaint } from './canvas.js';

export function bindScheduleExport({ $, state, renderSchedule, applyDayFilter, pngFilePart, downloadCanvasPng, container }) {
  const preview = $('#scheduleExportPreview');
  let pendingCanvas = null;

  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'exportSchedulePng';
  button.className = 'ghost';
  button.textContent = '导出时间表 PNG';
  container.append(button);

  async function exportAllSchedulePng() {
    if (!window.html2canvas) { alert('PNG 导出组件尚未加载，请稍后重试或刷新页面。'); return; }
    const oldFilter = state.dayFilter;
    const oldText = button.textContent;
    try {
      button.disabled = true; button.textContent = '正在生成…';
      state.dayFilter = '';
      renderSchedule(state.schedule);
      await nextPaint();
      const grid = $('#schedule .calendar-grid');
      if (!grid) throw new Error('时间表为空，无法导出。');
      grid.classList.add('png-export');
      await nextPaint();
      const canvas = await window.html2canvas(grid, {
        backgroundColor: '#fffdf8', scale: 2, useCORS: true, logging: false,
        width: grid.scrollWidth, height: grid.scrollHeight, windowWidth: grid.scrollWidth, windowHeight: grid.scrollHeight
      });
      pendingCanvas = canvas;
      $('#scheduleExportPreviewImage').src = canvas.toDataURL('image/png');
      preview.showModal();
    } catch (error) {
      alert(error.message || '时间表 PNG 导出失败。');
    } finally {
      $('#schedule .calendar-grid')?.classList.remove('png-export');
      state.dayFilter = oldFilter;
      renderSchedule(state.schedule); applyDayFilter();
      button.disabled = false; button.textContent = oldText;
    }
  }

  button.addEventListener('click', exportAllSchedulePng);
  $('#closeScheduleExportPreview').onclick = () => preview.close();
  $('#downloadScheduleExportPreview').onclick = () => {
    if (!pendingCanvas) return;
    downloadCanvasPng(pendingCanvas, `${pngFilePart($('#tripName').value)}-全部日期时间表.png`);
  };

  return { button, exportAllSchedulePng };
}
