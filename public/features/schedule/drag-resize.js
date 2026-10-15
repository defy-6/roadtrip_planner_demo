export function bindScheduleDragDrop({
  state, schedule, isReadOnly, selectedIndexes, clockToMinute, minuteToClock,
  getHourHeight, snapDrop, getDraggingPlaceId, clearDraggingPlace,
  placeDropController, updateNode, save, renderSchedule, applyDayFilter,
  renderLocations, showDayOverview, setSelectionAnchor, suppressClick
}) {
  let activeIndexes = [];
  const visibleRange = () => ({
    start: Number(schedule.dataset.startMinute) || 7 * 60,
    end: Number(schedule.dataset.endMinute) || 23 * 60
  });
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
      else { const range = visibleRange(), raw = range.start + (event.clientY - day.getBoundingClientRect().top) / getHourHeight() * 60, start = Math.max(range.start, Math.min(range.end - 30, Math.round(raw / 5) * 5)); preview.textContent = `新建：${place?.name || '地点'} · ${minuteToClock(start)}–${minuteToClock(Math.min(range.end, start + 60))}`; Object.assign(preview.style, { top: `${(start - range.start) / 60 * getHourHeight()}px`, height: `${Math.max(22, getHourHeight() - 2)}px` }); }
      return;
    }
    event.dataTransfer.dropEffect = 'move'; const first = state.schedule[activeIndexes[0]]; if (!first) return;
    const hourHeight = getHourHeight(), range = visibleRange(), raw = range.start + (event.clientY - day.getBoundingClientRect().top) / hourHeight * 60, snapped = snapDrop(day.dataset.date, raw, activeIndexes);
    const duration = Math.max(5, clockToMinute(first.end || first.start) - clockToMinute(first.start)), end = Math.min(range.end, snapped + duration);
    preview.textContent = `预计 ${minuteToClock(snapped)}–${minuteToClock(end)}${activeIndexes.length > 1 ? `（${activeIndexes.length} 项）` : ''}`; Object.assign(preview.style, { top: `${(snapped - range.start) / 60 * hourHeight}px`, height: `${Math.max(22, duration / 60 * hourHeight - 2)}px` });
  };
  schedule.ondrop = event => {
    const day = event.target.closest('.calendar-day'); if (!day) return; event.preventDefault();
    const placeId = getDraggingPlaceId() || event.dataTransfer.getData('application/x-roadtrip-place');
    if (placeId) {
      clearDraggingPlace(); clearVisuals(); const place = state.locations.find(item => item.id === placeId); if (!place) return;
      const block = event.target.closest('.calendar-block');
      if (block) { const entry = state.schedule[Number(block.dataset.scheduleIndex)]; placeDropController.chooseAction(entry, place).then(choice => { if (!placeDropController.apply(entry, place, choice)) return; save(); renderSchedule(); applyDayFilter(); renderLocations(); showDayOverview(); }); return; }
      const range = visibleRange(), raw = range.start + (event.clientY - day.getBoundingClientRect().top) / getHourHeight() * 60, start = Math.max(range.start, Math.min(range.end - 30, Math.round(raw / 5) * 5)), end = minuteToClock(Math.min(range.end, start + 60));
      placeDropController.confirmCreation(place, day.dataset.date, minuteToClock(start), end).then(confirmed => { if (!confirmed) return; state.schedule.push({ id: crypto.randomUUID(), date: day.dataset.date, start: minuteToClock(start), end, type: place.type === 'flight' ? 'transport' : (place.type === 'drive' ? 'spot' : place.type || 'spot'), title: place.name || '新建安排', detail: '', locationId: place.id }); save(); renderSchedule(); applyDayFilter(); renderLocations(); showDayOverview(); }); return;
    }
    let indexes = activeIndexes.length ? [...activeIndexes] : null; if (!indexes) { try { indexes = JSON.parse(event.dataTransfer.getData('text/plain')); } catch { indexes = [Number(event.dataTransfer.getData('text/plain'))]; } }
    indexes = indexes.map(Number).filter(index => state.schedule[index]); if (!indexes.length) return;
    const range = visibleRange(), raw = range.start + (event.clientY - day.getBoundingClientRect().top) / getHourHeight() * 60, nextStart = snapDrop(day.dataset.date, raw, indexes), requestedDelta = nextStart - clockToMinute(state.schedule[indexes[0]].start);
    const groupStart = Math.min(...indexes.map(index => clockToMinute(state.schedule[index].start))), groupEnd = Math.max(...indexes.map(index => clockToMinute(state.schedule[index].end || state.schedule[index].start))), delta = Math.max(range.start - groupStart, Math.min(range.end - groupEnd, requestedDelta));
    indexes.forEach(index => { const entry = state.schedule[index], duration = Math.max(5, clockToMinute(entry.end || entry.start) - clockToMinute(entry.start)), shiftedStart = clockToMinute(entry.start) + delta; entry.date = day.dataset.date; entry.start = minuteToClock(shiftedStart); entry.end = minuteToClock(shiftedStart + duration); updateNode(index); });
    state.selectedIndex = indexes[0]; save(); renderSchedule(); applyDayFilter(); showDayOverview();
  };
  return { clearVisuals };
}

// 移动端触屏批量拖动：多选模式下，长按任意一个已选事件后拖动，整组跟随移动。
// 复用桌面 HTML5 DnD 的批量位移语义，但改为 pointer 事件实现（触屏没有原生 DnD）。
// 长按阈值内未长按则不拦截，放行点击/滚动；长按触发后接管指针、禁止页面滚动，保证拖动顺畅。
// 长按拖动完成后**不会**再触发外层 click（不意外弹编辑器）。普通点击仍由 view 的 click 逻辑处理。
export function bindScheduleTouchDrag({
  state, schedule, isReadOnly, selectedIndexes, clockToMinute, minuteToClock,
  getHourHeight, snapDrop, updateNode, save, renderSchedule, applyDayFilter,
  showDayOverview, suppressClick
}) {
  if (!schedule || isReadOnly()) return () => {};
  // 触屏拖动仅对移动端版式生效；桌面端继续走 HTML5 DnD（drag-resize 的 ondrop）
  if (document.documentElement.dataset.previewMode !== 'mobile') return () => {};
  const LONG_PRESS_MS = 380;
  const MOVE_TOLERANCE = 14;
  const DRAG_ACTIVATE_DIST = 28; // 长按后进入“真拖动”需达更大位移，充当“待拖确认”门槛
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let activeIndexes = [];
  let dragging = false;
  let armed = false;
  let pressTimer = null;
  let lastMove = null;
  let startBlockIndex = -1;
  const visibleRange = () => ({
    start: Number(schedule.dataset.startMinute) || 7 * 60,
    end: Number(schedule.dataset.endMinute) || 23 * 60
  });

  const clear = () => {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    armed = false; dragging = false; pointerId = null; lastMove = null; activeIndexes = [];
    document.querySelectorAll('.calendar-block.dragging,.calendar-block.pending-drag').forEach(item => item.classList.remove('dragging', 'pending-drag'));
    document.querySelectorAll('.calendar-drop-preview').forEach(item => item.remove());
    schedule.classList.remove('schedule-touch-dragging');
  };

  const makePreview = () => {
    let p = schedule.querySelector('.calendar-drop-preview');
    if (!p) { p = document.createElement('div'); p.className = 'calendar-drop-preview'; schedule.append(p); }
    return p;
  };

  const renderDrag = e => {
    const day = e.target.closest?.('.calendar-day') || document.elementFromPoint(e.clientX, e.clientY)?.closest('.calendar-day');
    if (!day) { lastMove = null; return; }
    const hourHeight = getHourHeight();
    const range = visibleRange();
    const raw = range.start + (e.clientY - day.getBoundingClientRect().top) / hourHeight * 60;
    const snapped = snapDrop(day.dataset.date, raw, activeIndexes);
    const first = state.schedule[activeIndexes[0]];
    const duration = Math.max(5, clockToMinute(first?.end || first?.start) - clockToMinute(first?.start));
    const end = Math.min(range.end, snapped + duration);
    const p = makePreview();
    p.textContent = `预计 ${minuteToClock(snapped)}–${minuteToClock(end)}${activeIndexes.length > 1 ? `（${activeIndexes.length} 项）` : ''}`;
    Object.assign(p.style, { display: 'block', top: `${(snapped - range.start) / 60 * hourHeight}px`, height: `${Math.max(22, duration / 60 * hourHeight - 2)}px` });
    lastMove = { dayEl: day, targetDate: day.dataset.date, targetY: e.clientY };
  };

  const onPointerMove = e => {
    if (pointerId !== null && e.pointerId !== pointerId) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    const dist = Math.hypot(dx, dy);
    if (!armed) {
      // 长按前移动超阈值：说明是滚动，放弃长按拖动资格
      if (dist > MOVE_TOLERANCE) clear();
      return;
    }
    // 长按已成立（进入"待拖"态）。需位移超过更大门槛(DRAG_ACTIVATE_DIST)才算真拖动并接管滚动；
    // 门槛内放行滚动/点击，避免多选/普通模式下手指略动但实为翻页时误判拖动。
    if (dist < DRAG_ACTIVATE_DIST) return;
    dragging = true;
    schedule.classList.add('schedule-touch-dragging');
    e.preventDefault();
    suppressClick();
    renderDrag(e);
  };
  const onPointerUp = e => {
    if (pointerId !== null && e.pointerId !== pointerId) return;
    if (dragging && lastMove) {
      const { dayEl: day, targetDate, targetY } = lastMove;
      const indexes = [...activeIndexes].map(Number).filter(index => state.schedule[index]);
      if (indexes.length) {
        const range = visibleRange();
        const raw = range.start + (targetY - day.getBoundingClientRect().top) / getHourHeight() * 60;
        const nextStart = snapDrop(targetDate, raw, indexes);
        const requestedDelta = nextStart - clockToMinute(state.schedule[indexes[0]].start);
        const groupStart = Math.min(...indexes.map(index => clockToMinute(state.schedule[index].start)));
        const groupEnd = Math.max(...indexes.map(index => clockToMinute(state.schedule[index].end || state.schedule[index].start)));
        const delta = Math.max(range.start - groupStart, Math.min(range.end - groupEnd, requestedDelta));
        indexes.forEach(index => {
          const entry = state.schedule[index]; const duration = Math.max(5, clockToMinute(entry.end || entry.start) - clockToMinute(entry.start));
          const shiftedStart = clockToMinute(entry.start) + delta;
          entry.date = targetDate; entry.start = minuteToClock(shiftedStart); entry.end = minuteToClock(shiftedStart + duration);
          updateNode(index);
        });
        state.selectedIndex = indexes[0];
        save(); renderSchedule(); applyDayFilter(); showDayOverview(state.dayFilter);
      }
    }
    clear();
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  };

  schedule.addEventListener('pointerdown', e => {
    if (isReadOnly()) return;
    const block = e.target.closest?.('.calendar-block'); if (!block) return;
    pointerId = e.pointerId;
    startX = e.clientX; startY = e.clientY;
    startBlockIndex = Number(block.dataset.scheduleIndex);
    // pointermove/up 需在 pointerdown 起就监听：这样才能在"位移超过阈值"的第一时间
    // 撤销长按拖动资格——否则快速滑动的位移发生在长按计时窗内没有被追踪，
    // 等长按触发后再监听第一次 move 就会误判为拖动。
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    pressTimer = setTimeout(() => {
      // 长按(期间未位移超阈值)后拖动：
      // 多选模式 → 若长按的卡片已被选中则整组移动；普通模式 → 始终拖动单张卡片。
      // 普通模式不看 selectedIndexes，避免"误点残留的选中态"导致翻页误判整组拖动。
      const multiselect = document.body.classList.contains('mobile-multiselect');
      activeIndexes = (multiselect && selectedIndexes.has(startBlockIndex) ? [...selectedIndexes] : [startBlockIndex])
        .sort((a, b) => clockToMinute(state.schedule[a]?.start) - clockToMinute(state.schedule[b]?.start) || a - b);
      armed = true;
      block.classList.add('pending-drag');
      block.classList.add('dragging');
    }, LONG_PRESS_MS);
  });

  return { clear };
}
