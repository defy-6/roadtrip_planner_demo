// 时间表视图：渲染日程网格、批量选择、剪贴板、键盘快捷键与点击/双击交互。
// 不接触地图与路线编辑；跨 feature 回调（focusScheduleEvent/openScheduleEditor）由 runtime 注入。
import { shiftScheduleEntries, snapScheduleDrop as calculateScheduleDrop } from './interactions.js';
import { bindScheduleMarquee } from './selection.js';
import { createScheduleClipboardController } from './clipboard.js';

export function createScheduleView({
  state, $, schedulePanel, itemsEl, values, escapeHtml, minuteToClock, clockToMinute,
  eventTypeNames, fmt, routeForScheduleEvent, weatherSummary, normalizedPriceItems,
  refreshEventCards, save, showDayOverview, renderRouteTotals,
  isShareMode, undoPlannerChange, redoPlannerChange,
  focusScheduleEvent, openScheduleEditor, mapFocusDateReset
}) {
  const selectedScheduleIndexes = new Set();
  let scheduleSelectionMode = true;
  let suppressScheduleClick = false;
  let scheduleSelectionAnchor = null;
  let schedulePasteAnchor = null;
  let schedulePasteTarget = null;
  let schedulePasteTargetId = null;

  function scheduleHourHeight() {
    if (document.documentElement.dataset.previewMode === 'mobile') return 40;
    const panelHeight = schedulePanel.clientHeight || Math.max(300, window.innerHeight - 92);
    const headHeight = schedulePanel.querySelector('.aside-head')?.offsetHeight || 34;
    const scheduleHeight = $('#schedule')?.clientHeight || Math.max(320, panelHeight - headHeight - 18);
    // 7:00–23:00 共 16 小时：网格始终填满时间表模块的可视高度，而不是固定 30px/小时。
    const usableHeight = Math.max(256, scheduleHeight - 52);
    return Math.max(16, Math.floor(usableHeight / 16));
  }

  function refreshScheduleBatchControls() {
    const count = selectedScheduleIndexes.size;
    const back = $('#scheduleShiftBack'), forward = $('#scheduleShiftForward');
    if (back) back.disabled = count === 0;
    if (forward) forward.disabled = count === 0;
    const hint = $('#scheduleHint');
    if (hint && count) hint.textContent = `已选 ${count} 项，可批量移动`;
  }

  function bindScheduleSelection() {
    bindScheduleMarquee({
      schedule: $('#schedule'), enabled: scheduleSelectionMode, selectedIndexes: selectedScheduleIndexes,
      onSuppressClick: () => { suppressScheduleClick = true; },
      onSelectionChange: refreshScheduleBatchControls
    });
  }

  function shiftSelectedSchedule(minutes) {
    if (!selectedScheduleIndexes.size) return;
    shiftScheduleEntries(state.schedule, selectedScheduleIndexes, minutes);
    renderSchedule(state.schedule); applyDayFilter(); refreshEventCards(); save();
  }

  function snapScheduleDrop(date, rawMinute, indexes = []) {
    return calculateScheduleDrop(state.schedule, date, rawMinute, indexes, clockToMinute);
  }

  const scheduleClipboardController = createScheduleClipboardController({
    state, selectedIndexes: selectedScheduleIndexes, clockToMinute, minuteToClock,
    getTarget: () => schedulePasteTarget,
    getTargetId: () => schedulePasteTargetId,
    getPasteAnchor: () => schedulePasteAnchor,
    setSelectionAnchor: value => { scheduleSelectionAnchor = value; },
    save,
    render: () => { renderSchedule(state.schedule); applyDayFilter(); refreshEventCards(); showDayOverview(state.dayFilter); }
  });

  function keydownHandler(event) {
    if (isShareMode) return;
    if (!(event.ctrlKey || event.metaKey)) return;
    const target = event.target;
    if (target.matches?.('input,textarea,[contenteditable="true"]')) return;
    const key = event.key.toLowerCase();
    if (key === 'c') {
      if (scheduleClipboardController.copy()) event.preventDefault();
      return;
    }
    if (key === 'v') {
      event.preventDefault();
      scheduleClipboardController.paste(); return;
    }
    if (key === 'z') {
      event.preventDefault();
      if (event.shiftKey) redoPlannerChange(); else undoPlannerChange();
      return;
    }
    if (key === 'y') { event.preventDefault(); redoPlannerChange(); return; }
  }
  document.addEventListener('keydown', keydownHandler);

  function renderSchedule(entries) {
    const schedule = $('#schedule');
    const previousScroll = schedule.querySelector('.schedule-scroll') ? { left: schedule.querySelector('.schedule-scroll').scrollLeft, top: schedule.querySelector('.schedule-scroll').scrollTop } : null;
    if (!entries.length) { schedule.innerHTML = '<p class="hint">为节点填写日期和起止时间后，将在这里按天展示。</p>'; return; }
    const allDates = [...new Set(entries.map(item => item.date))].sort();
    const filter = $('#dayFilter');
    const selected = state.dayFilter;
    filter.innerHTML = `<option value="">全部日期</option>${allDates.map(date => `<option value="${date}">${date}</option>`).join('')}`;
    filter.value = selected;
    const mapFilter = $('#mapDayFilter');
    mapFilter.innerHTML = `<option value="">全部日期</option>${allDates.map(date => `<option value="${date}">${date}</option>`).join('')}`;
    mapFilter.value = selected;
    const dates = selected ? allDates.filter(date => date === selected) : allDates;
    const startHour = 7, endHour = 23;
    const startMinute = startHour * 60, endMinute = endHour * 60, visibleHours = endHour - startHour, hourHeight = scheduleHourHeight();
    const calendarFontScale = Math.max(.85, Math.min(1.55, hourHeight / 30));
    schedule.dataset.hourHeight = String(hourHeight);
    const toMinute = time => { const [hour, minute] = (time || '06:00').split(':').map(Number); return hour * 60 + minute; };
    const eventEndMinute = item => item.type === 'flight' && item.flightInfo?.arrivalDate > item.date ? endMinute : toMinute(item.end || '24:00');
    const classify = item => /驾驶|前往|返回|至/.test(item.title) ? 'drive' : /午餐|晚餐|早餐|简餐/.test(item.title) ? 'meal' : /休息|入住|候机/.test(item.title) ? 'rest' : /可选|取消/.test(item.detail) ? 'warn' : '';
    const header = dates.map(date => { const d = new Date(`${date}T12:00:00`); return `<div class="calendar-head"><b>${d.toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'})}</b><small>周${'日一二三四五六'[d.getDay()]}</small></div>`; }).join('');
    const rail = Array.from({ length: visibleHours }, (_, i) => `<div class="time-label">${String(i + startHour).padStart(2, '0')}:00</div>`).join('');
    const columns = dates.map(date => {
      const dayEvents = entries.map((item, index) => ({ ...item, index })).filter(item => item.date === date).sort((a, b) => toMinute(a.start) - toMinute(b.start) || eventEndMinute(b) - eventEndMinute(a));
      // 重叠事件采用嵌套缩进：长时段作为外层，包含或交叉的短时段叠放在其内部，不再横向分栏。
      const placed = [];
      dayEvents.forEach(item => {
        const start = toMinute(item.start), end = eventEndMinute(item);
        const active = placed.filter(entry => entry.start < end && entry.end > start);
        const containers = active.filter(entry => entry.start <= start && entry.end >= end);
        let depth = containers.length ? Math.max(...containers.map(entry => entry.depth)) + 1 : 0;
        while (active.some(entry => entry.depth === depth)) depth += 1;
        placed.push({ item, start, end, depth: Math.min(depth, 5) });
      });
      const blocks = placed.map(({ item, depth, start, end }) => {
        const rawStart = toMinute(item.start), rawEnd = eventEndMinute(item);
        if (rawEnd <= startMinute || rawStart >= endMinute) return '';
        const visibleStart = Math.max(startMinute, rawStart), visibleEnd = Math.min(endMinute, rawEnd);
        const top = (visibleStart - startMinute) / 60 * hourHeight;
        const height = Math.max(4, (visibleEnd - visibleStart) / 60 * hourHeight - 1);
        const compactClass = height < 10 ? ' compact' : '';
        const shortClass = height < 28 ? ' short' : '';
        const tallClass = height >= 56 ? ' tall' : '';
        const roomyClass = height >= 38 ? ' roomy' : '';
        const label = /驾驶|前往|返回|继续|返程|至/.test(item.title) ? '路程' : (eventTypeNames[item.type] || '安排');
        const indent = depth * 18;
        const width = `calc(100% - ${12 + indent}px)`;
        const left = `${6 + indent}px`;
        const nestedChildren = placed.filter(entry => entry.depth > depth && entry.start < end && entry.end > start);
        const hasNestedChildren = nestedChildren.length > 0;
        const nestingClass = `${depth ? ' nested-child' : ''}${hasNestedChildren ? ' nested-parent' : ''}`;
        const place = state.locations.find(location => location.id === item.locationId);
        const eventLinks = item.routeLinks || {};
        const sharedRoute = routeForScheduleEvent(item);
        const links = sharedRoute ? { ...eventLinks, ...sharedRoute } : eventLinks;
        const origin = state.locations.find(location => location.id === links.originPlaceId) || links.customOrigin;
        const destination = state.locations.find(location => location.id === links.destinationPlaceId) || links.customDestination;
        const viaCount = (links.viaPlaceIds || []).length;
        const queryRecord = sharedRoute?.amap;
        const driveAmapMeta = queryRecord ? [
          Number(queryRecord.distance) ? `${(Number(queryRecord.distance) / 1000).toFixed(1)} 公里` : '',
          Number(queryRecord.duration) ? `预计 ${fmt(Number(queryRecord.duration))}` : '',
          Number.isFinite(Number(queryRecord.tolls)) ? `过路费约 ${Number(queryRecord.tolls).toFixed(0)} 元` : '',
          queryRecord.queriedAt ? `高德查询 ${new Date(queryRecord.queriedAt).toLocaleString('zh-CN')}${queryRecord.queryPeriod === 'night' ? '（夜间结果，待白天重查）' : ''}` : ''
        ].filter(Boolean).join(' · ') : '';
        const normalizeSummaryText = value => String(value || '').replace(/[\s·，,。；;：:（）()→\-—_/]/g, '').toLowerCase();
        const titleText = normalizeSummaryText(item.title);
        const placeNameText = normalizeSummaryText(place?.name);
        const placeNameAddsInfo = placeNameText && !titleText.includes(placeNameText) && !placeNameText.includes(titleText);
        const placeMeta = place
          ? (placeNameAddsInfo ? place.name : '')
          : (normalizeSummaryText(item.detail) === titleText ? '' : (item.detail || '地点待关联'));
        const flightMeta = [
          item.flightInfo?.stopoverAirport ? `经停 ${item.flightInfo.stopoverAirport}${item.flightInfo.stopoverArrivalTime || item.flightInfo.stopoverDepartureTime ? ` ${item.flightInfo.stopoverArrivalTime || '--:--'}–${item.flightInfo.stopoverDepartureTime || '--:--'}` : ''}` : '',
          item.detail && normalizeSummaryText(item.detail) !== titleText ? item.detail : '',
          item.flightInfo?.arrivalDate > item.date ? `次日 ${item.end} 抵达` : ''
        ].filter((part, index, parts) => part && parts.findIndex(other => normalizeSummaryText(other) === normalizeSummaryText(part)) === index).join(' · ');
        const detailMeta = item.detail && normalizeSummaryText(item.detail) !== titleText && normalizeSummaryText(item.detail) !== normalizeSummaryText(placeMeta) ? item.detail : '';
        const priceItems = normalizedPriceItems(item.priceInfo);
        const calculatedPrice = priceItems.perPersonItems.reduce((sum, entry) => sum + Number(entry.amount || 0) * Number(entry.people || 1), 0) + priceItems.sharedItems.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
        const priceNotes = [...priceItems.perPersonItems.map(entry => `${entry.note || '单人费用'} ${entry.amount || 0}×${entry.people || 1}`), ...priceItems.sharedItems.map(entry => entry.note || '共同费用')].filter(Boolean).join('；');
        const priceMeta = calculatedPrice ? `费用 ${calculatedPrice.toFixed(2)} 元${priceNotes ? `（${priceNotes}）` : ''}` : '';
        const baseMeta = item.type === 'drive'
          ? (origin && destination ? [`${origin.name || '起点'} → ${destination.name || '终点'}${viaCount ? ` · ${viaCount} 个途经点` : ''}`, driveAmapMeta].filter(Boolean).join(' · ') : '起点、终点待关联')
          : item.type === 'flight'
            ? flightMeta
            : [placeMeta, detailMeta].filter(Boolean).join(' · ');
        const meta = [baseMeta, priceMeta].filter(Boolean).join(' · ');
        const weatherIsCurrent = item.weather?.placeId === item.locationId && item.weather?.eventDate === item.date && item.weather?.eventStart === (item.start || '');
        const driveWeatherIsCurrent = item.weather?.eventDate === item.date && item.weather?.eventStart === (item.start || '') && item.weather?.eventEnd === (item.end || item.start || '');
        const flightWeatherIsCurrent = item.weather?.eventDate === item.date && item.weather?.eventStart === (item.start || '') && item.weather?.eventEnd === (item.end || item.start || '') && item.weather?.arrivalDate === (item.flightInfo?.arrivalDate || item.date) && item.weather?.departureAirport === (item.flightInfo?.departureAirport || '') && item.weather?.arrivalAirport === (item.flightInfo?.arrivalAirport || '');
        const weatherText = item.type === 'drive'
          ? (driveWeatherIsCurrent ? [item.weather?.origin && `起点 ${weatherSummary(item.weather.origin)}`, item.weather?.destination && `终点 ${weatherSummary(item.weather.destination)}`].filter(Boolean).join(' · ') : '')
          : item.type === 'flight'
            ? (flightWeatherIsCurrent ? [item.weather?.origin && `起飞 ${weatherSummary(item.weather.origin)}`, item.weather?.destination && `降落 ${weatherSummary(item.weather.destination)}`].filter(Boolean).join(' · ') : '')
            : (weatherIsCurrent ? weatherSummary(item.weather) : '');
        const tooltip = `${item.start}${item.end ? `–${item.end}` : ''} · ${label} · ${item.title}${meta ? ` · ${meta}` : ''}`;
        const headerMarkup = `<span class="calendar-event-header"><time>${item.start}${item.end ? `–${item.end}` : ''}</time><em>${label}</em></span>`;
        const bodyMarkup = `<b>${escapeHtml(item.title)}</b>${meta ? `<small>${escapeHtml(meta)}</small>` : ''}${weatherText ? `<small class="weather-meta">${escapeHtml(weatherText)}</small>` : ''}`;
        let renderedContent = `${headerMarkup}${bodyMarkup}`;
        if (hasNestedChildren) {
          const occupied = nestedChildren
            .map(entry => ({ start: Math.max(visibleStart, entry.start), end: Math.min(visibleEnd, entry.end) }))
            .filter(interval => interval.end > interval.start)
            .sort((a, b) => a.start - b.start || a.end - b.end)
            .reduce((merged, interval) => {
              const previous = merged[merged.length - 1];
              if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
              else merged.push({ ...interval });
              return merged;
            }, []);
          const freeIntervals = [];
          let cursor = visibleStart;
          occupied.forEach(interval => {
            if (interval.start > cursor) freeIntervals.push({ start: cursor, end: interval.start });
            cursor = Math.max(cursor, interval.end);
          });
          if (cursor < visibleEnd) freeIntervals.push({ start: cursor, end: visibleEnd });
          const contentInterval = freeIntervals.sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
          const startsAtParentTop = contentInterval?.start === visibleStart;
          const headerReserve = startsAtParentTop ? 13 : 0;
          const contentTop = contentInterval ? (contentInterval.start - visibleStart) / 60 * hourHeight + headerReserve : 0;
          const contentHeight = contentInterval ? Math.max(0, (contentInterval.end - contentInterval.start) / 60 * hourHeight - headerReserve - 2) : 0;
          const contentClass = contentHeight < 8 ? ' content-hidden' : contentHeight < 20 ? ' content-compact' : contentHeight < 38 ? ' content-brief' : '';
          renderedContent = `<span class="calendar-parent-header">${headerMarkup}</span><span class="calendar-parent-content${contentClass}" style="top:${contentTop}px;height:${contentHeight}px">${bodyMarkup}</span>`;
        }
        return `<div class="calendar-block type-${item.type || 'spot'} ${classify(item)}${compactClass}${shortClass}${tallClass}${roomyClass}${nestingClass}${state.selectedIndex === item.index ? ' selected' : ''}${selectedScheduleIndexes.has(item.index) ? ' batch-selected' : ''}" data-nesting-depth="${depth}" data-compact-label="${escapeHtml(`${label} · ${item.title}`)}" title="${escapeHtml(tooltip)}" draggable="true" data-schedule-index="${item.index}" style="top:${top}px;height:${height}px;left:${left};right:auto;width:${width};z-index:${depth + 1}">${renderedContent}</div>`;
      }).join('');
      return `<div class="calendar-day" data-date="${date}">${blocks}</div>`;
    }).join('');
    const gridWidth = schedulePanel.classList.contains('is-expanded') || selected ? '100%' : `${Math.max(520, 64 + dates.length * 220)}px`;
    schedule.innerHTML = `<div class="schedule-scroll"><div class="calendar-grid" style="--days:${dates.length};--grid-width:${gridWidth};--hour-height:${hourHeight}px;--half-hour-height:${hourHeight / 2}px;--calendar-height:${hourHeight * visibleHours}px;--calendar-font-scale:${calendarFontScale}"><div class="calendar-corner"></div>${header}<div class="time-rail">${rail}</div>${columns}</div></div>`;
    if (previousScroll) {
      const nextScroll = schedule.querySelector('.schedule-scroll');
      if (nextScroll) { nextScroll.scrollLeft = previousScroll.left; nextScroll.scrollTop = previousScroll.top; }
    }
    $('#scheduleHint').textContent = `${entries.length} 项安排`;
    bindScheduleSelection();
  }

  let scheduleResizeTimer;
  const resizeObserver = new ResizeObserver(() => {
    clearTimeout(scheduleResizeTimer);
    scheduleResizeTimer = setTimeout(() => {
      if (!state.schedule.length) return;
      const nextHeight = scheduleHourHeight();
      if (Number($('#schedule').dataset.hourHeight) !== nextHeight) { renderSchedule(state.schedule); applyDayFilter(); }
    }, 80);
  });
  resizeObserver.observe(schedulePanel);

  function renderManualSchedule() {
    const entries = [...itemsEl.children].map(values).filter(item => item.date && item.startTime).map(item => ({ date: item.date, start: item.startTime, end: item.endTime, title: item.name || item.address, detail: item.note || '' }));
    renderSchedule(entries);
  }

  function applyDayFilter() {
    const selected = state.dayFilter;
    [...itemsEl.children].forEach(node => { node.hidden = Boolean(selected && $('.date', node).value !== selected); });
  }

  $('#schedule').onclick = event => {
    const block = event.target.closest('[data-schedule-index]');
    if (scheduleSelectionMode) {
      if (suppressScheduleClick) { suppressScheduleClick = false; return; }
      if (block) {
        const index = Number(block.dataset.scheduleIndex);
        schedulePasteAnchor = index;
        schedulePasteTargetId = state.schedule[index]?.sharedId || null;
        schedulePasteTarget = { date: state.schedule[index]?.date, start: state.schedule[index]?.start };
        if (event.shiftKey && Number.isInteger(scheduleSelectionAnchor)) {
          const indexes = [...document.querySelectorAll('.calendar-block')].map(node => Number(node.dataset.scheduleIndex));
          const a = indexes.indexOf(scheduleSelectionAnchor), b = indexes.indexOf(index);
          if (a >= 0 && b >= 0) indexes.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(item => selectedScheduleIndexes.add(item));
        } else if (event.altKey) selectedScheduleIndexes.delete(index);
        else if (event.ctrlKey || event.metaKey) { if (selectedScheduleIndexes.has(index)) selectedScheduleIndexes.delete(index); else selectedScheduleIndexes.add(index); scheduleSelectionAnchor = index; }
        else { selectedScheduleIndexes.clear(); selectedScheduleIndexes.add(index); scheduleSelectionAnchor = index; }
        document.querySelectorAll('.calendar-block').forEach(node => node.classList.toggle('batch-selected', selectedScheduleIndexes.has(Number(node.dataset.scheduleIndex)))); refreshScheduleBatchControls();
      } else {
        selectedScheduleIndexes.clear(); scheduleSelectionAnchor = null; schedulePasteTargetId = null;
        const day = event.target.closest('.calendar-day') || document.elementFromPoint(event.clientX, event.clientY)?.closest('.calendar-day');
        if (day) {
          const hourHeight = scheduleHourHeight(); const rawMinute = 7 * 60 + (event.clientY - day.getBoundingClientRect().top) / hourHeight * 60;
          const candidates = state.schedule.map((entry, index) => ({ entry, index, end: clockToMinute(entry.end || entry.start) })).filter(item => item.entry.date === day.dataset.date && item.end <= rawMinute).sort((a, b) => b.end - a.end);
          const previous = candidates[0];
          schedulePasteAnchor = previous ? previous.index + 1 : state.schedule.findIndex(entry => entry.date === day.dataset.date);
          if (schedulePasteAnchor < 0) schedulePasteAnchor = state.schedule.length;
          schedulePasteTarget = { date: day.dataset.date, start: minuteToClock(previous?.end ?? 7 * 60) };
        } else { schedulePasteAnchor = null; schedulePasteTarget = null; }
        document.querySelectorAll('.calendar-block.batch-selected').forEach(node => node.classList.remove('batch-selected')); refreshScheduleBatchControls();
      }
      if (block) {
        const index = Number(block.dataset.scheduleIndex);
        focusScheduleEvent(index);
        if (document.documentElement.dataset.previewMode === 'mobile') openScheduleEditor(index);
      }
      return;
    }
    if (block) {
      const index = Number(block.dataset.scheduleIndex);
      focusScheduleEvent(index);
      if (document.documentElement.dataset.previewMode === 'mobile') openScheduleEditor(index);
    }
  };
  $('#schedule').ondblclick = event => { const block = event.target.closest('[data-schedule-index]'); if (block) openScheduleEditor(Number(block.dataset.scheduleIndex)); };
  $('#dayFilter').onchange = event => changeDayFilter(event.target.value);

  function changeDayFilter(value) {
    state.dayFilter = value;
    state.selectedIndex = null;
    mapFocusDateReset();
    state.schedule.length ? renderSchedule(state.schedule) : renderManualSchedule();
    applyDayFilter();
    renderRouteTotals();
    showDayOverview(state.dayFilter);
  }

  return {
    render: renderSchedule,
    renderManual: renderManualSchedule,
    applyDayFilter,
    changeDayFilter,
    hourHeight: scheduleHourHeight,
    refreshBatchControls: refreshScheduleBatchControls,
    shiftSelected: shiftSelectedSchedule,
    snapDrop: snapScheduleDrop,
    selectedIndexes: selectedScheduleIndexes,
    setSelectionAnchor: value => { scheduleSelectionAnchor = value; },
    suppressClick: () => { suppressScheduleClick = true; },
    destroy() {
      resizeObserver.disconnect();
      document.removeEventListener('keydown', keydownHandler);
    }
  };
}
