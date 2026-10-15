export function bindPlaceBatchActions({ state, $, api, geocode, pause, escapeHtml, confirmAction, selectedPlaceIds, getSelectionMode, setSelectionMode, onSearch, renderLocations, removeLocations, save }) {
  const status = document.createElement('p');
  status.id = 'placeBatchStatus';
  status.className = 'place-batch-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;
  $('#placeSearch').closest('.location-toolbar').insertAdjacentElement('afterend', status);
  const announce = (message, tone = 'info') => {
    status.textContent = message;
    status.dataset.tone = tone;
    status.hidden = false;
  };
  const selectionActionIds = ['selectAllPlaces', 'resolveSelectedPlaces', 'fetchSelectedPhotos', 'deleteSelectedPlaces'];
  const syncSelectionUi = enabled => {
    selectionActionIds.forEach(id => { const control = $(`#${id}`); if (control) control.hidden = !enabled; });
    const cleanup = $('#cleanupUnusedPlaces');
    if (cleanup) cleanup.hidden = enabled;
    const toggle = $('#togglePlaceSelection');
    if (toggle) {
      toggle.textContent = enabled ? '完成选择' : '选择地点';
      toggle.setAttribute('aria-pressed', String(enabled));
      toggle.classList.toggle('is-selected', enabled);
    }
    window.dispatchEvent(new CustomEvent('places:selectionchange', { detail: { enabled, count: selectedPlaceIds.size } }));
  };
  $('#placeSearch').oninput = event => { onSearch(event.target.value.trim()); renderLocations(); };
  $('#togglePlaceSelection').onclick = () => {
    const enabled = !getSelectionMode();
    setSelectionMode(enabled);
    if (!enabled) selectedPlaceIds.clear();
    syncSelectionUi(enabled);
    renderLocations();
  };
  $('#selectAllPlaces').onclick = () => {
    const visibleCards = [...$('#places').querySelectorAll('.place-card')];
    const shouldSelect = visibleCards.some(card => !selectedPlaceIds.has(card.dataset.placeId));
    visibleCards.forEach(card => shouldSelect ? selectedPlaceIds.add(card.dataset.placeId) : selectedPlaceIds.delete(card.dataset.placeId));
    renderLocations();
  };
  $('#deleteSelectedPlaces').onclick = async () => {
    if (!selectedPlaceIds.size) { announce('请先勾选需要删除的地点。', 'warning'); return; }
    const count = selectedPlaceIds.size;
    const confirmed = await confirmAction({
      title: '批量删除地点',
      message: `确定删除选中的 ${count} 个地点吗？`,
      detail: '相关事件和路程中的地点关联也会解除，此操作无法撤销。',
      confirmLabel: `删除 ${count} 个地点`
    });
    if (confirmed) removeLocations(new Set(selectedPlaceIds));
  };
  $('#cleanupUnusedPlaces').onclick = () => {
    // 收集当前计划中所有被引用(事件/航班/路线)的地点 id（自定义起终点本身不算地点引用）；
    // 未被任何 event.locationId、flight placeId、route 起终点/途经点引用的地点视为"多余"。
    const used = new Set();
    (state.schedule || []).forEach(event => {
      if (event.locationId) used.add(event.locationId);
      if ((event.transportInfo?.kind === 'flight' || event.flightInfo) && event.flightInfo) {
        [event.flightInfo.departurePlaceId, event.flightInfo.stopoverPlaceId, event.flightInfo.arrivalPlaceId].filter(Boolean).forEach(id => used.add(id));
      }
      if (event.transportInfo?.kind === 'train') {
        [event.transportInfo.departurePlaceId, event.transportInfo.arrivalPlaceId].filter(Boolean).forEach(id => used.add(id));
      }
      if (event.routeLinks) {
        [event.routeLinks.originPlaceId, ...(event.routeLinks.viaPlaceIds || []), event.routeLinks.destinationPlaceId].filter(Boolean).forEach(id => used.add(id));
      }
    });
    (state.routes || []).forEach(route => {
      [route.originPlaceId, ...(route.viaPlaceIds || []), route.destinationPlaceId].filter(Boolean).forEach(id => used.add(id));
    });
    const redundant = (state.locations || []).filter(place => !used.has(place.id));
    if (!redundant.length) { announce('没有未被使用的多余地点。', 'success'); return; }

    // 构造"清单 + 勾选"模态：列出将被删除的多余地点，用户勾选后才执行删除。
    const uid = 'cleanup-unused-overlay';
    const typeNames = { spot: '景点', geography: '地名', food: '餐饮', hotel: '住宿', shopping: '购物', flight: '机场', service: '服务区', fuel: '加油站', supply: '补给', transport: '交通' };
    const overlay = document.createElement('div');
    overlay.id = uid;
    overlay.className = 'cleanup-unused-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'cleanup-unused-title');
    overlay.innerHTML = `
      <section class="cleanup-unused-panel">
        <header class="cleanup-unused-header">
          <h3 id="cleanup-unused-title">清理未使用地点 <span>${redundant.length} 个</span></h3>
          <p>以下地点未被任何行程事件或路线引用，可逐项决定是否清理。<strong>删除会从当前计划地点库移除所选地点。</strong></p>
        </header>
        <div data-role="list" class="cleanup-unused-list">
          ${redundant.map(place => `
            <label class="cleanup-unused-item">
              <input type="checkbox" data-role="item" value="${escapeHtml(String(place.id))}" checked>
              <span class="cleanup-unused-copy">
                <span><b>${escapeHtml(place.name || '未命名地点')}</b><em>${escapeHtml(typeNames[place.type] || '地点')}</em></span>
                ${place.address ? `<small>${escapeHtml(place.address)}</small>` : '<small>暂无地址</small>'}
              </span>
            </label>`).join('')}
        </div>
        <footer class="cleanup-unused-actions">
          <button data-role="toggle" class="ghost" type="button">全不选</button>
          <span data-role="count">已选 ${redundant.length}</span>
          <button data-role="cancel" class="ghost" type="button">取消</button>
          <button data-role="confirm" class="danger" type="button">删除勾选</button>
        </footer>
      </section>`;
    document.body.append(overlay);
    const listEl = overlay.querySelector('[data-role="list"]');
    const countEl = overlay.querySelector('[data-role="count"]');
    const updateCount = () => {
      const n = listEl.querySelectorAll('input[data-role="item"]:checked').length;
      countEl.textContent = `已选 ${n}`;
      overlay.querySelector('[data-role="confirm"]').disabled = n === 0;
    };
    overlay.querySelector('[data-role="toggle"]').onclick = () => {
      const shouldCheck = listEl.querySelectorAll('input[data-role="item"]').length === listEl.querySelectorAll('input[data-role="item"]:checked').length;
      listEl.querySelectorAll('input[data-role="item"]').forEach(cb => { cb.checked = !shouldCheck; });
      updateCount();
    };
    listEl.addEventListener('change', updateCount);
    const closeOverlay = () => overlay.remove();
    overlay.querySelector('[data-role="cancel"]').onclick = closeOverlay;
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
    overlay.addEventListener('keydown', event => { if (event.key === 'Escape') closeOverlay(); });
    overlay.querySelector('[data-role="confirm"]').onclick = async () => {
      const chosen = [...listEl.querySelectorAll('input[data-role="item"]:checked')].map(cb => cb.value);
      if (!chosen.length) return;
      const byName = new Map(redundant.map(place => [String(place.id), place.name || '未命名地点']));
      overlay.remove();
      const names = chosen.slice(0, 6).map(id => byName.get(id)).join('、');
      const confirmed = await confirmAction({
        title: '确认清理地点',
        message: `删除已勾选的 ${chosen.length} 个未使用地点？`,
        detail: `${names}${chosen.length > 6 ? `等 ${chosen.length} 个地点` : ''}。删除后无法撤销。`,
        confirmLabel: `删除 ${chosen.length} 个地点`
      });
      if (!confirmed) return;
      removeLocations(new Set(chosen));
      announce(`已清理 ${chosen.length} 个多余地点。`, 'success');
    };
    updateCount();
    overlay.querySelector('[data-role="toggle"]').focus();
  };
  $('#resolveSelectedPlaces').onclick = async event => {
    const selected = state.locations.filter(place => selectedPlaceIds.has(place.id));
    if (!selected.length) { announce('请先勾选需要查询的地点。', 'warning'); return; }
    const missing = selected.filter(place => !place.name || !place.address);
    if (missing.length) { announce(`有 ${missing.length} 个地点缺少名称或地址，请补全后再查询。`, 'warning'); return; }
    const button = event.currentTarget; button.disabled = true; button.textContent = `正在查询 0/${selected.length}`;
    let completed = 0, failed = 0;
    for (const place of selected) {
      try { const point = await geocode(place.address, place.name); place.resolved = { name: point.name || place.name, address: point.formatted_address || place.address, location: point.location }; }
      catch { failed += 1; }
      completed += 1; button.textContent = `正在查询 ${completed}/${selected.length}`;
    }
    save(); renderLocations(); button.disabled = false; button.textContent = '批量查询位置';
    $('#distance').textContent = `地点库已查询 ${completed - failed} 个位置${failed ? `，${failed} 个未找到` : ''}`;
  };
  $('#fetchSelectedPhotos').onclick = async event => {
    const selected = state.locations.filter(place => selectedPlaceIds.has(place.id) && place.name && place.address);
    if (!selected.length) { announce('请先勾选名称和完整地址均已填写的地点。', 'warning'); return; }
    const button = event.currentTarget; button.disabled = true; let completed = 0, found = 0;
    for (const place of selected) {
      button.textContent = `获取图片 ${completed}/${selected.length}`;
      try {
        const data = await api.getPlacePhotos({ name: place.name, address: place.address });
        place.photoCandidates = data.photos || [];
        if (place.photoCandidates.length) found += 1;
      } catch { /* 单个地点失败不影响其余查询。 */ }
      completed += 1;
      if (completed < selected.length) await pause(250);
    }
    save(); renderLocations(); button.disabled = false; button.textContent = '批量获取图片';
    $('#distance').textContent = `高德已为 ${found}/${selected.length} 个地点找到候选图片，请在地点卡片中确认采用。`;
  };
  $('#batchAddPlaces').onclick = () => {
    const typeMap = { '景点': 'spot', '地名': 'geography', '地点': 'geography', '城市': 'geography', '饮食': 'food', '餐饮': 'food', '住宿': 'hotel', '酒店': 'hotel', '购物': 'shopping', '商场': 'shopping', '机场': 'flight', '服务区': 'service', '加油站': 'fuel', '补给': 'supply', '交通': 'transport' };
    const lines = $('#batchPlaceInput').value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!lines.length) { announce('请先粘贴要新增的地点。', 'warning'); return; }
    const parsed = lines.map((line, index) => {
      const [typeLabel = '景点', name = '', ...addressParts] = line.split(/[｜|]/).map(part => part.trim());
      return { line: index + 1, type: typeMap[typeLabel] || 'spot', name, address: addressParts.join('｜') };
    });
    const invalid = parsed.filter(place => !place.name);
    if (invalid.length) { announce(`第 ${invalid.map(place => place.line).join('、')} 行缺少地点名称。`, 'error'); return; }
    parsed.forEach(place => state.locations.push({ id: crypto.randomUUID(), type: place.type, name: place.name, address: place.address, note: '' }));
    $('#batchPlaceInput').value = ''; save(); renderLocations();
  };
  syncSelectionUi(getSelectionMode());
}
