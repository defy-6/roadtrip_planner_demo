export function createMobileDialogs(dialog) {
  if (!dialog || dialog.querySelector('.mobile-editor-types')) return;
  dialog.querySelector('h3').textContent = '编辑安排';
  const typeSelect = dialog.querySelector('#editorType');
  const eventTypeLabels = {
    spot: '游玩', food: '餐饮', hotel: '住宿', service: '补给', fuel: '补给', supply: '补给',
    drive: '路程', flight: '交通', transport: '交通'
  };
  const eventTypes = { spot: '游玩', food: '餐饮', hotel: '住宿', supply: '补给', drive: '路程', transport: '交通' };
  Object.entries(eventTypeLabels).forEach(([value, label]) => {
    const option = typeSelect.querySelector(`option[value="${value}"]`);
    if (option) { option.textContent = label; option.hidden = ['service', 'fuel', 'flight'].includes(value); }
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
  const canonicalType = value => ({ service: 'supply', fuel: 'supply', flight: 'transport' }[value] || value);
  const syncType = () => {
    types.querySelectorAll('button').forEach(button => {
      const selected = button.dataset.editorType === canonicalType(typeSelect.value);
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const isRoute = typeSelect.value === 'drive';
    const hasLinkedPlace = !isRoute && Boolean(dialog.querySelector('#eventLocation')?.value);
    preview.hidden = !isRoute && !hasLinkedPlace;
    preview.classList.toggle('is-place-preview', hasLinkedPlace);
    preview.querySelector('small').textContent = isRoute ? '路线预览' : '地点预览';
    preview.querySelector('b').textContent = isRoute ? '在地图中高亮这段路线' : '在地图中查看关联地点';
    preview.querySelector('em').textContent = isRoute ? '点击查看完整路线与详细信息 ›' : '点击定位并查看地点详情 ›';
  };
  types.addEventListener('click', event => { const button = event.target.closest('[data-editor-type]'); if (!button) return; typeSelect.value = button.dataset.editorType; typeSelect.dispatchEvent(new Event('change', { bubbles: true })); syncType(); });
  preview.addEventListener('click', () => {
    const index = Number(dialog.dataset.scheduleIndex);
    if (!Number.isInteger(index)) return;
    const date = document.querySelector('#editorDate').value;
    dialog.close(); window.location.hash = 'map';
    setTimeout(() => {
      const filter = document.querySelector('#mapDayFilter');
      if (typeSelect.value === 'drive') {
        if (filter && date) { filter.value = date; filter.dispatchEvent(new Event('change', { bubbles: true })); }
        window.dispatchEvent(new CustomEvent('mobile:routefocus', { detail: { index } }));
      }
      else {
        const placeId = dialog.querySelector('#eventLocation')?.value;
        if (placeId) window.dispatchEvent(new CustomEvent('mobile:placefocus', { detail: { placeId, date } }));
      }
    }, 160);
  });
  typeSelect.addEventListener('change', syncType);
  dialog.querySelector('#eventLocation')?.addEventListener('change', syncType);
  const form = dialog.querySelector('.editor-form');
  const keepFocusedControlVisible = () => {
    if (!dialog.open || !form) return;
    const control = document.activeElement;
    if (!control || !dialog.contains(control) || !control.matches('input,textarea,select')) return;
    const viewport = window.visualViewport;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportBottom = viewportTop + (viewport?.height || window.innerHeight);
    const headerBottom = dialog.querySelector('h3')?.getBoundingClientRect().bottom || viewportTop;
    const actionTop = dialog.querySelector('.editor-actions')?.getBoundingClientRect().top || viewportBottom;
    const visibleTop = Math.max(viewportTop, headerBottom) + 8;
    const visibleBottom = Math.min(viewportBottom, actionTop) - 12;
    const rect = control.getBoundingClientRect();
    let delta = 0;
    if (rect.bottom > visibleBottom) delta = rect.bottom - visibleBottom;
    else if (rect.top < visibleTop) delta = rect.top - visibleTop;
    if (delta) form.scrollTop += delta;
  };
  const queueFocusedControlCheck = () => requestAnimationFrame(() => requestAnimationFrame(keepFocusedControlVisible));
  dialog.addEventListener('focusin', queueFocusedControlCheck);
  window.visualViewport?.addEventListener('resize', queueFocusedControlCheck);
  new MutationObserver(() => { if (!dialog.open) return; dialog.querySelectorAll('.editor-section').forEach(section => { section.open = false; }); setTimeout(() => { syncType(); }); }).observe(dialog, { attributes: true, attributeFilter: ['open'] });
  syncType();
}
