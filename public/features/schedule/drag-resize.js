export function bindScheduleDragDrop({
  state, schedule, isReadOnly, selectedIndexes, clockToMinute, minuteToClock,
  getHourHeight, snapDrop, getDraggingPlaceId, clearDraggingPlace,
  placeDropController, updateNode, save, renderSchedule, applyDayFilter,
  renderLocations, showDayOverview, setSelectionAnchor, suppressClick
}) {
  let activeIndexes = [];
  const clearVisuals = () => {
    document.querySelectorAll('.calendar-block.dragging').forEach(item => item.classList.remove('dragging'));
    document.querySelectorAll('.calendar-day.drop-target,.calendar-drop-preview').forEach(item => item.classList.remove('drop-target') || item.remove());
  };
  schedule.ondragstart = event => {
    if (isReadOnly()) { event.preventDefault(); return; }
    const block = event.target.closest('.calendar-block'); if (!block) return;
    const index = Number(block.dataset.scheduleIndex);
    activeIndexes = (selectedIndexes.has(index) ? [...selectedIndexes] : [index]).sort((a, b) => clockToMinute(state.schedule[a]?.start) - clockToMinute(state.schedule[b]?.start) || a - b);
    if (!selectedIndexes.has(index)) { selectedIndexes.clear(); selectedIndexes.add(index); setSelectionAnchor(index); }
    suppressClick(); event.dataTransfer.setData('text/plain', JSON.stringify(activeIndexes)); event.dataTransfer.effectAllowed = 'move';
    activeIndexes.forEach(item => document.querySelector(`.calendar-block[data-schedule-index="${item}"]`)?.classList.add('dragging'));
  };
  schedule.ondragend = () => { activeIndexes = []; clearVisuals(); };
  schedule.ondragover = event => {
    const day = event.target.closest('.calendar-day'); if (!day) return; event.preventDefault();
    const placeId = getDraggingPlaceId() || (event.dataTransfer.types.includes('application/x-roadtrip-place') ? event.dataTransfer.getData('application/x-roadtrip-place') : '');
    document.querySelectorAll('.calendar-day.drop-target').forEach(item => item.classList.toggle('drop-target', item === day));
    let preview = day.querySelector('.calendar-drop-preview'); if (!preview) { preview = document.createElement('div'); preview.className = 'calendar-drop-preview'; day.append(preview); }
    if (placeId) {
      event.dataTransfer.dropEffect = 'copy'; const place = state.locations.find(item => item.id === placeId), block = event.target.closest('.calendar-block');
      if (block) { preview.textContent = `关联：${place?.name || '地点'} → ${state.schedule[Number(block.dataset.scheduleIndex)]?.title || '事件'}`; Object.assign(preview.style, { top: block.style.top, height: block.style.height }); }
      else { const raw = 420 + (event.clientY - day.getBoundingClientRect().top) / getHourHeight() * 60, start = Math.max(420, Math.min(1350, Math.round(raw / 5) * 5)); preview.textContent = `新建：${place?.name || '地点'} · ${minuteToClock(start)}–${minuteToClock(Math.min(1380, start + 60))}`; Object.assign(preview.style, { top: `${(start - 420) / 60 * getHourHeight()}px`, height: `${Math.max(22, getHourHeight() - 2)}px` }); }
      return;
    }
    event.dataTransfer.dropEffect = 'move'; const first = state.schedule[activeIndexes[0]]; if (!first) return;
    const hourHeight = getHourHeight(), raw = 420 + (event.clientY - day.getBoundingClientRect().top) / hourHeight * 60, snapped = snapDrop(day.dataset.date, raw, activeIndexes);
    const duration = Math.max(5, clockToMinute(first.end || first.start) - clockToMinute(first.start)), end = Math.min(1380, snapped + duration);
    preview.textContent = `预计 ${minuteToClock(snapped)}–${minuteToClock(end)}${activeIndexes.length > 1 ? `（${activeIndexes.length} 项）` : ''}`; Object.assign(preview.style, { top: `${(snapped - 420) / 60 * hourHeight}px`, height: `${Math.max(22, duration / 60 * hourHeight - 2)}px` });
  };
  schedule.ondrop = event => {
    const day = event.target.closest('.calendar-day'); if (!day) return; event.preventDefault();
    const placeId = getDraggingPlaceId() || event.dataTransfer.getData('application/x-roadtrip-place');
    if (placeId) {
      clearDraggingPlace(); clearVisuals(); const place = state.locations.find(item => item.id === placeId); if (!place) return;
      const block = event.target.closest('.calendar-block');
      if (block) { const entry = state.schedule[Number(block.dataset.scheduleIndex)]; placeDropController.chooseAction(entry, place).then(choice => { if (!placeDropController.apply(entry, place, choice)) return; save(); renderSchedule(); applyDayFilter(); renderLocations(); showDayOverview(); }); return; }
      const raw = 420 + (event.clientY - day.getBoundingClientRect().top) / getHourHeight() * 60, start = Math.max(420, Math.min(1350, Math.round(raw / 5) * 5)), end = minuteToClock(Math.min(1380, start + 60));
      placeDropController.confirmCreation(place, day.dataset.date, minuteToClock(start), end).then(confirmed => { if (!confirmed) return; state.schedule.push({ id: crypto.randomUUID(), date: day.dataset.date, start: minuteToClock(start), end, type: place.type === 'flight' ? 'transport' : (place.type === 'drive' ? 'spot' : place.type || 'spot'), title: place.name || '新建安排', detail: '', locationId: place.id }); save(); renderSchedule(); applyDayFilter(); renderLocations(); showDayOverview(); }); return;
    }
    let indexes = activeIndexes.length ? [...activeIndexes] : null; if (!indexes) { try { indexes = JSON.parse(event.dataTransfer.getData('text/plain')); } catch { indexes = [Number(event.dataTransfer.getData('text/plain'))]; } }
    indexes = indexes.map(Number).filter(index => state.schedule[index]); if (!indexes.length) return;
    const raw = 420 + (event.clientY - day.getBoundingClientRect().top) / getHourHeight() * 60, nextStart = snapDrop(day.dataset.date, raw, indexes), requestedDelta = nextStart - clockToMinute(state.schedule[indexes[0]].start);
    const groupStart = Math.min(...indexes.map(index => clockToMinute(state.schedule[index].start))), groupEnd = Math.max(...indexes.map(index => clockToMinute(state.schedule[index].end || state.schedule[index].start))), delta = Math.max(420 - groupStart, Math.min(1380 - groupEnd, requestedDelta));
    indexes.forEach(index => { const entry = state.schedule[index], duration = Math.max(5, clockToMinute(entry.end || entry.start) - clockToMinute(entry.start)), shiftedStart = clockToMinute(entry.start) + delta; entry.date = day.dataset.date; entry.start = minuteToClock(shiftedStart); entry.end = minuteToClock(shiftedStart + duration); updateNode(index); });
    state.selectedIndex = indexes[0]; save(); renderSchedule(); applyDayFilter(); showDayOverview();
  };
  return { clearVisuals };
}
