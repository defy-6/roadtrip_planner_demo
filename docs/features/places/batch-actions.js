export function bindPlaceBatchActions({ state, $, api, geocode, pause, selectedPlaceIds, getSelectionMode, setSelectionMode, onSearch, renderLocations, removeLocations, save }) {
  $('#placeSearch').oninput = event => { onSearch(event.target.value.trim()); renderLocations(); };
  $('#togglePlaceSelection').onclick = event => {
    const enabled = !getSelectionMode();
    setSelectionMode(enabled);
    if (!enabled) selectedPlaceIds.clear();
    event.currentTarget.textContent = enabled ? '完成选择' : '选择地点';
    renderLocations();
  };
  $('#selectAllPlaces').onclick = () => {
    const visibleCards = [...$('#places').querySelectorAll('.place-card')];
    const shouldSelect = visibleCards.some(card => !selectedPlaceIds.has(card.dataset.placeId));
    visibleCards.forEach(card => shouldSelect ? selectedPlaceIds.add(card.dataset.placeId) : selectedPlaceIds.delete(card.dataset.placeId));
    renderLocations();
  };
  $('#deleteSelectedPlaces').onclick = () => {
    if (!selectedPlaceIds.size) { alert('请先勾选需要删除的地点。'); return; }
    if (confirm(`确定删除选中的 ${selectedPlaceIds.size} 个地点吗？相关事件和路程关联也会解除。`)) removeLocations(new Set(selectedPlaceIds));
  };
  $('#resolveSelectedPlaces').onclick = async event => {
    const selected = state.locations.filter(place => selectedPlaceIds.has(place.id));
    if (!selected.length) { alert('请先勾选需要查询的地点。'); return; }
    const missing = selected.filter(place => !place.name || !place.address);
    if (missing.length) { alert(`有 ${missing.length} 个地点缺少名称或地址，请补全后再查询。`); return; }
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
    if (!selected.length) { alert('请先勾选名称和完整地址均已填写的地点。'); return; }
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
    if (!lines.length) { alert('请先粘贴要新增的地点。'); return; }
    const parsed = lines.map((line, index) => {
      const [typeLabel = '景点', name = '', ...addressParts] = line.split(/[｜|]/).map(part => part.trim());
      return { line: index + 1, type: typeMap[typeLabel] || 'spot', name, address: addressParts.join('｜') };
    });
    const invalid = parsed.filter(place => !place.name);
    if (invalid.length) { alert(`第 ${invalid.map(place => place.line).join('、')} 行缺少地点名称。`); return; }
    parsed.forEach(place => state.locations.push({ id: crypto.randomUUID(), type: place.type, name: place.name, address: place.address, note: '' }));
    $('#batchPlaceInput').value = ''; save(); renderLocations();
  };
}
