export function createPlacesLibrary({
  state,
  $,
  escapeHtml,
  selectedPlaceIds,
  customPlaceCategories,
  placeTypeName,
  placeTypeColor,
  placeTypeOptionsHtml,
  getUiState,
  setTypeFilter,
  onShowPlace,
  onEditPlace,
  onImportPlace,
  onDragStart,
  onDragEnd,
  onImported
}) {
  const renderPlaceMeta = (place, detail = {}) => `<div class="mobile-place-meta"><span class="place-rating">${detail.rating ? `评分 ${escapeHtml(detail.rating)} ★` : '&nbsp;'}</span><span class="place-hours">${detail.openTime ? `开放 ${escapeHtml(detail.openTime)}` : '&nbsp;'}</span><span class="place-cost">${detail.referenceCost ? escapeHtml(detail.referenceCost) : '&nbsp;'}</span><small class="place-address">⌖ ${escapeHtml(place.address || '地址待定')}</small><em class="place-cache">${place.resolved?.location ? '✓ 已缓存位置' : '位置待查询'}</em></div>`;
  function renderTypeFilter() {
    const select = $('#placeTypeFilter');
    if (!select) return;
    const selected = getUiState().typeFilter;
    select.innerHTML = `<option value="">全部类型</option>${placeTypeOptionsHtml()}`;
    select.value = [...select.options].some(option => option.value === selected) ? selected : '';
    setTypeFilter(select.value);
  }

  function renderLocations() {
    const places = $('#places');
    if (!places) return;
    const ui = getUiState();
    const query = ui.searchText.toLowerCase();
    renderTypeFilter();
    const typeFilter = getUiState().typeFilter;
    const typeOrder = ['spot', 'geography', 'food', 'hotel', 'shopping', 'flight', 'transport', 'service', 'fuel', 'supply', ...customPlaceCategories().map(category => category.id), 'drive'];
    const visibleLocations = state.locations.filter(place => (!typeFilter || place.type === typeFilter) && (!query || `${place.name || ''} ${place.address || ''} ${place.note || ''} ${placeTypeName(place.type)}`.toLowerCase().includes(query))).sort((a, b) => Number(Boolean(b.photo)) - Number(Boolean(a.photo)) || (typeOrder.indexOf(a.type) < 0 ? 99 : typeOrder.indexOf(a.type)) - (typeOrder.indexOf(b.type) < 0 ? 99 : typeOrder.indexOf(b.type)) || String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'));
    $('#placeCount').textContent = `(${visibleLocations.length}/${state.locations.length})`;
    const renderCard = place => { const detail = place.poiDetails || {}; return `<article class="place-card place-card-summary ${place.photo ? 'has-photo' : 'no-photo'}${ui.selectionMode ? ' selection-mode' : ''}" data-place-id="${place.id}" tabindex="0" role="button" draggable="${ui.selectionMode ? 'false' : 'true'}" aria-label="编辑地点：${escapeHtml(place.name || '未命名地点')}"><div class="place-card-summary-title">${ui.selectionMode ? `<input type="checkbox" class="place-select" aria-label="选择 ${escapeHtml(place.name || '未命名地点')}" ${selectedPlaceIds.has(place.id) ? 'checked' : ''}>` : ''}<span class="place-type type-${escapeHtml(place.type || 'spot')}" style="background:${placeTypeColor(place.type)}22;color:${placeTypeColor(place.type)}">${escapeHtml(placeTypeName(place.type))}</span><b>${escapeHtml(place.name || '未命名地点')}</b></div>${place.photo ? `<img class="place-photo-preview" src="${escapeHtml(place.photo)}" alt="${escapeHtml(place.name || '地点')}图片">` : ''}${renderPlaceMeta(place, detail)}<div class="mobile-place-actions"><button type="button" data-place-card-action="map">查看地图</button><button type="button" data-place-card-action="edit">编辑</button></div></article>`; };
    const photoPlaces = visibleLocations.filter(place => place.photo);
    const plainPlaces = visibleLocations.filter(place => !place.photo);
    places.innerHTML = visibleLocations.length ? `${photoPlaces.length ? `<div class="place-grid place-grid-photos">${photoPlaces.map(renderCard).join('')}</div>` : ''}${plainPlaces.length ? `<div class="place-grid place-grid-plain">${plainPlaces.map(renderCard).join('')}</div>` : ''}` : '<p class="hint">没有符合条件的地点。</p>';
    places.querySelectorAll('.place-card').forEach(card => {
      $('.place-select', card)?.addEventListener('change', event => { event.target.checked ? selectedPlaceIds.add(card.dataset.placeId) : selectedPlaceIds.delete(card.dataset.placeId); });
      card.querySelector('[data-place-card-action="map"]')?.addEventListener('click', event => {
        event.stopPropagation();
        const placeId = card.dataset.placeId;
        window.location.hash = 'map';
        setTimeout(() => onShowPlace(placeId), 140);
      });
      card.querySelector('[data-place-card-action="edit"]')?.addEventListener('click', event => { event.stopPropagation(); onEditPlace(card.dataset.placeId); });
      let clickTimer;
      card.onclick = event => {
        if (event.target.closest('.place-select')) return;
        clearTimeout(clickTimer);
        clickTimer = setTimeout(() => onShowPlace(card.dataset.placeId), 190);
      };
      card.ondblclick = event => {
        if (event.target.closest('.place-select')) return;
        clearTimeout(clickTimer);
        onEditPlace(card.dataset.placeId);
      };
      card.onkeydown = event => {
        if (event.target.closest('.place-select')) return;
        if (event.key === 'Enter') { event.preventDefault(); onEditPlace(card.dataset.placeId); }
        if (event.key === ' ') { event.preventDefault(); onShowPlace(card.dataset.placeId); }
      };
      card.ondragstart = event => {
        if (getUiState().selectionMode) { event.preventDefault(); return; }
        event.dataTransfer.setData('application/x-roadtrip-place', card.dataset.placeId);
        event.dataTransfer.effectAllowed = 'copy';
        card.classList.add('dragging-place');
        onDragStart(card.dataset.placeId);
      };
      card.ondragend = () => onDragEnd(card);
    });
  }

  function renderUniversalPlaces() {
    const container = $('#universalPlaceList');
    if (!container) return;
    const query = $('#universalPlaceSearch')?.value.trim().toLowerCase() || '';
    const matches = (state.universalLocations || []).filter(place => !query || `${place.name || ''} ${place.address || ''} ${place.note || ''}`.toLowerCase().includes(query));
    const renderCard = place => {
      const detail = place.poiDetails || {};
      return `<article class="place-card place-card-summary universal-place-card ${place.photo ? 'has-photo' : 'no-photo'}" data-universal-place-id="${place.id}"><div class="place-card-summary-title"><span class="place-type type-${escapeHtml(place.type || 'spot')}" style="background:${placeTypeColor(place.type)}22;color:${placeTypeColor(place.type)}">${escapeHtml(placeTypeName(place.type))}</span><b>${escapeHtml(place.name || '未命名地点')}</b></div>${place.photo ? `<img class="place-photo-preview" src="${escapeHtml(place.photo)}" alt="${escapeHtml(place.name || '地点')}图片">` : ''}${renderPlaceMeta(place, detail)}<div class="mobile-place-actions"><button type="button" data-universal-action="map">查看地图</button><button type="button" data-universal-action="edit">编辑</button><button type="button" data-universal-action="add">添加到当前计划</button></div></article>`;
    };
    container.innerHTML = matches.length ? matches.map(renderCard).join('') : '<p class="hint">没有匹配的通用地点。</p>';
    container.querySelectorAll('[data-universal-place-id]').forEach(card => {
      const importCard = () => {
        const source = state.universalLocations.find(place => place.id === card.dataset.universalPlaceId);
        return source ? onImportPlace(source) : null;
      };
      card.querySelector('[data-universal-action="add"]').onclick = () => { const imported = importCard(); if (imported) onImported(imported); };
      card.querySelector('[data-universal-action="map"]').onclick = () => { const imported = importCard(); if (!imported) return; onImported(imported); window.location.hash = 'map'; setTimeout(() => onShowPlace(imported.id), 140); };
      card.querySelector('[data-universal-action="edit"]').onclick = () => { const imported = importCard(); if (!imported) return; onImported(imported); onEditPlace(imported.id); };
    });
  }

  return { renderLocations, renderUniversalPlaces };
}
