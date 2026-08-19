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
  // 移除冗余的“时间/路线/天气”只读摘要卡片：这些信息与顶部(开始/结束)和底部折叠区重复，
  // 保留类型选择与路线预览即可。
  const preview = document.createElement('button');
  preview.type = 'button'; preview.className = 'mobile-editor-map-preview';
  preview.innerHTML = '<span class="mobile-route-sketch" aria-hidden="true"><i></i><i></i></span><span><small>路线预览</small><b>在地图中高亮这段路线</b><em>点击查看完整路线与详细信息 ›</em></span>';
  types.insertAdjacentElement('afterend', preview);
  const syncType = () => { types.querySelectorAll('button').forEach(button => button.classList.toggle('is-selected', button.dataset.editorType === typeSelect.value)); preview.hidden = typeSelect.value !== 'drive'; };
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
  new MutationObserver(() => { if (!dialog.open) return; dialog.querySelectorAll('.editor-section').forEach(section => { section.open = false; }); setTimeout(() => { syncType(); }); }).observe(dialog, { attributes: true, attributeFilter: ['open'] });
  syncType();
}
