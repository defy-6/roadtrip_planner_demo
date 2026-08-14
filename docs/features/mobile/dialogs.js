export function createMobileDialogs(dialog) {
  if (!dialog || dialog.querySelector('.mobile-editor-types')) return;
  dialog.querySelector('h3').textContent = '编辑安排';
  const typeSelect = dialog.querySelector('#editorType');
  const eventTypes = {
    spot: '景点', drive: '路程', flight: '航班', transport: '交通', food: '餐饮',
    hotel: '住宿', service: '服务区', fuel: '加油', supply: '停车 / 补给'
  };
  Object.entries(eventTypes).forEach(([value, label]) => {
    const option = typeSelect.querySelector(`option[value="${value}"]`);
    if (option) option.textContent = label;
    else typeSelect.add(new Option(label, value));
  });
  const types = document.createElement('div'); types.className = 'mobile-editor-types'; types.setAttribute('aria-label', '安排类型');
  types.innerHTML = Object.entries(eventTypes).map(([value, label]) => `<button type="button" data-editor-type="${value}">${label}</button>`).join('');
  const primaryGrid = typeSelect.closest('.editor-grid');
  primaryGrid?.insertAdjacentElement('afterend', types);
  const summary = document.createElement('section'); summary.className = 'mobile-editor-summary';
  summary.innerHTML = '<div><small>时间</small><b data-editor-summary="time">—</b></div><div><small>路线</small><b data-editor-summary="route">未设置</b></div><div><small>天气</small><b data-editor-summary="weather">未查询</b></div><div class="is-wide"><small>备注</small><b data-editor-summary="note">无备注</b></div>';
  types.insertAdjacentElement('afterend', summary);
  const preview = document.createElement('button');
  preview.type = 'button'; preview.className = 'mobile-editor-map-preview';
  preview.innerHTML = '<span class="mobile-route-sketch" aria-hidden="true"><i></i><i></i></span><span><small>路线预览</small><b>在地图中高亮这段路线</b><em>点击查看完整路线与详细信息 ›</em></span>';
  summary.insertAdjacentElement('afterend', preview);
  const syncType = () => { types.querySelectorAll('button').forEach(button => button.classList.toggle('is-selected', button.dataset.editorType === typeSelect.value)); preview.hidden = typeSelect.value !== 'drive'; };
  const syncSummary = () => { summary.querySelector('[data-editor-summary="time"]').textContent = `${document.querySelector('#editorStart').value || '—'} — ${document.querySelector('#editorEnd').value || '—'}`; const route = document.querySelector('#editorRouteStatus'); summary.querySelector('[data-editor-summary="route"]').textContent = route && !route.hidden ? route.textContent.trim() : (typeSelect.value === 'drive' ? '待获取路线' : '非路程安排'); const weather = document.querySelector('#editorWeatherStatus'); summary.querySelector('[data-editor-summary="weather"]').textContent = weather && !weather.hidden ? weather.textContent.trim() : '未查询'; summary.querySelector('[data-editor-summary="note"]').textContent = document.querySelector('#editorNote').value.trim() || '无备注'; };
  types.addEventListener('click', event => { const button = event.target.closest('[data-editor-type]'); if (!button) return; typeSelect.value = button.dataset.editorType; typeSelect.dispatchEvent(new Event('change', { bubbles: true })); syncType(); });
  preview.addEventListener('click', () => {
    const index = Number(dialog.dataset.scheduleIndex);
    if (!Number.isInteger(index)) return;
    const date = document.querySelector('#editorDate').value;
    dialog.close(); window.location.hash = 'map';
    setTimeout(() => {
      const filter = document.querySelector('#mapDayFilter');
      if (filter && date) { filter.value = date; filter.dispatchEvent(new Event('change', { bubbles: true })); }
      window.dispatchEvent(new CustomEvent('mobile:routefocus', { detail: { index } }));
    }, 160);
  });
  typeSelect.addEventListener('change', syncType);
  new MutationObserver(() => { if (!dialog.open) return; dialog.querySelectorAll('.editor-section').forEach(section => { section.open = false; }); setTimeout(() => { syncType(); syncSummary(); }); }).observe(dialog, { attributes: true, attributeFilter: ['open'] });
  ['editorStart', 'editorEnd', 'editorNote'].forEach(id => document.querySelector(`#${id}`).addEventListener('input', syncSummary));
  syncType();
}
