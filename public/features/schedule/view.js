// 时间表视图：渲染日程网格、批量选择、剪贴板、键盘快捷键与点击/双击交互。
// 不接触地图与路线编辑；跨 feature 回调（focusScheduleEvent/openScheduleEditor）由 runtime 注入。
import { shiftScheduleEntries, snapScheduleDrop as calculateScheduleDrop } from './interactions.js';
import { bindScheduleMarquee } from './selection.js';
import { createScheduleClipboardController } from './clipboard.js';
import { expandScheduleSegments, zonedClock } from '../../core/time.js';

export function createScheduleView({
  state, $, schedulePanel, itemsEl, values, escapeHtml, minuteToClock, clockToMinute,
  eventTypeNames, fmt, routeForScheduleEvent, weatherBackgroundKey, weatherSummary, weatherVisualKey, normalizedPriceItems,
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
  let nowLineResizeObserver = null;
  const weatherBadgeText = weather => {
    if (!weather) return '';
    const icon = weather.isNight === true
      ? ({ sunny: '🌙', 'mostly-sunny': '☁️', cloudy: '☁️', overcast: '☁️', drizzle: '🌦️', rain: '🌧️', storm: '⛈️', snow: '🌨️', fog: '🌫️', sand: '🌪️', unknown: '🌡️' })[weatherVisualKey(weather)]
      : ({ sunny: '☀️', 'mostly-sunny': '🌤️', cloudy: '⛅', overcast: '☁️', drizzle: '🌦️', rain: '🌧️', storm: '⛈️', snow: '🌨️', fog: '🌫️', sand: '🌪️', unknown: '🌡️' })[weatherVisualKey(weather)];
    const temperature = Number(weather.temperature);
    return `${icon || '🌡️'} ${Number.isFinite(temperature) ? `${Math.round(temperature)}℃` : '—'}`;
  };

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
    // 移动端禁用鼠标拖拽框选：手机上用单点编辑事件、滚动浏览时间表，
    // 不应让手指拖动触发桌面式多选框（会造成误选/干扰滚动）。
    const isMobile = document.documentElement.dataset.previewMode === 'mobile';
    if (isMobile) return;
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
    const minMinute = Number($('#schedule').dataset.startMinute) || 7 * 60;
    const maxMinute = (Number($('#schedule').dataset.endMinute) || 23 * 60) - 5;
    return calculateScheduleDrop(state.schedule, date, rawMinute, indexes, clockToMinute, { minMinute, maxMinute });
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

  // 当前时间指示线：更新/创建/移除横跨所有日期列的"现在时刻"红色横线。
  // 用函数声明而非 const，确保 renderSchedule 在自身定义之后也能访问（声明提升）。
  // 当前时间的"北京时间"(UTC+8)分量：无论设备在哪个时区，时间线都显示北京时间，
  // 与行程排期一致（例如新疆设备仍显示北京时间而非新疆时间）。
  // 注意：用「绝对时刻 + 8 小时」的 UTC+8 计算，而不依赖 Intl(timeZone) 也不依赖
  // getTimezoneOffset() —— 这两者在部分设备（旧 WebView / 新疆等非 UTC+8 时区）会算错
  // 或抛异常，导致红线整体偏移数小时。固定 +8h 恒等于北京，任何环境一致。
  function updateNowLine(grid, { startMinute, endMinute, dates }) {
    if (!grid) return;
    const now = zonedClock(new Date(), state.preferences?.timeZone || 'Asia/Shanghai');
    const todayIso = now.iso;
    const nowMinute = now.hour * 60 + now.minute;
    let line = grid.querySelector('.current-time-line');
    // 列表卡片没有连续的时间坐标；“全部日期”也不突出某一列。
    // 当前时间线只在选中某个具体日期的时间轴视图显示。
    if (schedulePanel.classList.contains('mobile-list-view') || !state.dayFilter) {
      line?.remove();
      return;
    }
    // 今天不在展示日期内，或超出网格时间范围 → 移除
    if (!dates.includes(todayIso) || nowMinute < startMinute || nowMinute > endMinute) {
      line?.remove();
      return;
    }
    // 红线定位在整个 grid 上，而小时刻度的原点位于第二行的日期内容区。
    // 使用真实 offsetTop 可同时适配桌面/手机不同高度的日期表头。
    const rail = grid.querySelector('.time-rail');
    const gridRect = grid.getBoundingClientRect();
    const railRect = rail?.getBoundingClientRect();
    // 切到隐藏标签页时 WebView 会把布局尺寸短暂报告为 0；保留现有位置，等页面恢复后再计算。
    if (!rail || !grid.getClientRects().length || !railRect?.height || !gridRect.height) return;
    // 红线必须和用户看见的小时刻度使用同一坐标系。不能用 rail 总高度反推：
    // 宽屏手机预览、旧缓存样式或切页恢复期间，rail 高度可能和 .time-label
    // 的实际间距暂时不一致，曾造成标签显示 13:09、红线却落在 09:00 附近。
    const labels = [...rail.querySelectorAll('.time-label')];
    const firstLabelTop = labels[0]?.offsetTop || 0;
    const labelStep = labels.length > 1
      ? labels[1].offsetTop - labels[0].offsetTop
      : rail.offsetHeight / Math.max(1, (endMinute - startMinute) / 60);
    if (!(labelStep > 0)) return;
    const timelineTop = rail.offsetTop + firstLabelTop;
    const top = timelineTop + Math.max(0, nowMinute - startMinute) / 60 * labelStep;
    const label = `${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')}`;
    if (!line) {
      line = document.createElement('div');
      line.className = 'current-time-line';
      line.innerHTML = '<span></span>';
      grid.append(line);
    }
    if (line.parentElement !== grid) grid.append(line);
    line.style.top = `${top}px`;
    line.querySelector('span').textContent = label;
  }

  function renderSchedule(entries, { exportMode = false } = {}) {
    const schedule = $('#schedule');
    const previousScroll = schedule.querySelector('.schedule-scroll') ? { left: schedule.querySelector('.schedule-scroll').scrollLeft, top: schedule.querySelector('.schedule-scroll').scrollTop } : null;
    const displaySegments = expandScheduleSegments(entries);
    const allDates = [...new Set(displaySegments.map(item => item.displayDate))].sort();
    const filter = $('#dayFilter');
    const selected = state.dayFilter;
    filter.innerHTML = `<option value="">全部日期</option>${allDates.map(date => `<option value="${date}">${date}</option>`).join('')}`;
    filter.value = selected;
    const mapFilter = $('#mapDayFilter');
    mapFilter.innerHTML = `<option value="">全部日期</option>${allDates.map(date => `<option value="${date}">${date}</option>`).join('')}`;
    mapFilter.value = selected;
    // Empty plans must rebuild both date filters before rendering their hint.
    if (!entries.length) { schedule.innerHTML = '<p class="hint schedule-empty">当前方案暂无安排，可通过“新增安排”开始规划。</p>'; return; }
    const dates = selected ? allDates.filter(date => date === selected) : allDates;
    const displayedEntries = displaySegments.filter(item => dates.includes(item.displayDate));
    // 全日期 PNG 中，跨天分段不参与公共边界；少数日期独有的凌晨/深夜事件
    // 也收进日期表头摘要。只有至少 1/3 日期长期使用该时段时，才扩展所有列。
    const boundaryEntries = exportMode ? displayedEntries.filter(item => item.segmentKind === 'single') : displayedEntries;
    const exportBoundaryThreshold = Math.max(2, Math.ceil(dates.length / 3));
    const defaultEndMinute = exportMode ? 24 * 60 : 23 * 60;
    const earlyDates = new Set(boundaryEntries.filter(item => clockToMinute(item.segmentStart) < 7 * 60).map(item => item.displayDate));
    const lateDates = new Set(boundaryEntries.filter(item => clockToMinute(item.segmentEnd || item.segmentStart) > defaultEndMinute).map(item => item.displayDate));
    const collapseEarly = exportMode && earlyDates.size < exportBoundaryThreshold;
    const collapseLate = exportMode && lateDates.size < exportBoundaryThreshold;
    const entryStartMinutes = boundaryEntries.map(item => collapseEarly ? Math.max(7 * 60, clockToMinute(item.segmentStart)) : clockToMinute(item.segmentStart)).filter(Number.isFinite);
    const entryEndMinutes = boundaryEntries.map(item => collapseLate ? Math.min(defaultEndMinute, clockToMinute(item.segmentEnd || item.segmentStart)) : clockToMinute(item.segmentEnd || item.segmentStart)).filter(Number.isFinite);
    // 默认展示 07:00–23:00；只有事件超出范围时才按整点向两端扩展，最多覆盖完整一天。
    const startHour = Math.max(0, Math.min(7, Math.floor(Math.min(...entryStartMinutes, 7 * 60) / 60)));
    const endHour = Math.min(24, Math.max(defaultEndMinute / 60, Math.ceil(Math.max(...entryEndMinutes, defaultEndMinute) / 60)));
    const startMinute = startHour * 60, endMinute = endHour * 60, visibleHours = endHour - startHour, hourHeight = scheduleHourHeight();
    const calendarFontScale = Math.max(.85, Math.min(1.55, hourHeight / 30));
    schedule.dataset.hourHeight = String(hourHeight);
    schedule.dataset.startMinute = String(startMinute);
    schedule.dataset.endMinute = String(endMinute);
    const toMinute = time => { const [hour, minute] = (time || '06:00').split(':').map(Number); return hour * 60 + minute; };
    const eventEndMinute = item => toMinute(item.segmentEnd || item.end || '24:00');
    const classify = item => /驾驶|前往|返回|至/.test(item.title) ? 'drive' : /午餐|晚餐|早餐|简餐/.test(item.title) ? 'meal' : /休息|入住|候机/.test(item.title) ? 'rest' : /可选|取消/.test(item.detail) ? 'warn' : '';
    const exportOvernightSummary = date => {
      if (!exportMode) return '';
      const segments = displayedEntries.filter(item => item.displayDate === date && (clockToMinute(item.segmentStart) < startMinute || clockToMinute(item.segmentEnd || item.segmentStart) > endMinute));
      if (!segments.length) return '';
      const item = segments[0];
      const label = item.segmentKind === 'departure'
        ? `跨天出发 ${item.segmentStart}`
        : item.segmentKind === 'arrival'
          ? `跨天抵达 ${item.segmentEnd}`
          : item.segmentKind === 'continuation'
            ? '跨天途中'
            : clockToMinute(item.segmentStart) < startMinute
              ? `凌晨 ${item.segmentStart}–${item.segmentEnd}`
              : `深夜 ${item.segmentStart}–${item.segmentEnd}`;
      const more = segments.length > 1 ? ` +${segments.length - 1}` : '';
      return `<span class="calendar-export-overnight" title="${escapeHtml(`${label} · ${item.title}${more}`)}">${escapeHtml(`${label} · ${item.title}${more}`)}</span>`;
    };
    const header = dates.map(date => { const d = new Date(`${date}T12:00:00`); return `<div class="calendar-head${exportMode ? ' calendar-export-head' : ''}" data-date="${date}"><b>${d.toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'})}</b><small>周${'日一二三四五六'[d.getDay()]}</small>${exportOvernightSummary(date)}</div>`; }).join('');
    const rail = Array.from({ length: visibleHours }, (_, i) => `<div class="time-label">${String(i + startHour).padStart(2, '0')}:00</div>`).join('');
    const columns = dates.map(date => {
      const dayEvents = displaySegments.filter(item => item.displayDate === date).sort((a, b) => toMinute(a.segmentStart) - toMinute(b.segmentStart) || eventEndMinute(b) - eventEndMinute(a));
      // 重叠事件采用嵌套缩进：长时段作为外层，包含或交叉的短时段叠放在其内部，不再横向分栏。
      const placed = [];
      dayEvents.forEach(item => {
        const start = toMinute(item.segmentStart), end = eventEndMinute(item);
        const active = placed.filter(entry => entry.start < end && entry.end > start);
        const containers = active.filter(entry => entry.start <= start && entry.end >= end);
        let depth = containers.length ? Math.max(...containers.map(entry => entry.depth)) + 1 : 0;
        while (active.some(entry => entry.depth === depth)) depth += 1;
        placed.push({ item, start, end, depth: Math.min(depth, 5) });
      });
      const blocks = placed.map(({ item, depth, start, end }) => {
        const rawStart = toMinute(item.segmentStart), rawEnd = eventEndMinute(item);
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
          : item.transportInfo?.kind === 'flight'
            ? flightMeta
            : [placeMeta, detailMeta].filter(Boolean).join(' · ');
        const meta = [baseMeta, priceMeta].filter(Boolean).join(' · ');
        const weatherIsCurrent = item.weather?.placeId === item.locationId && item.weather?.eventDate === item.date && item.weather?.eventStart === (item.start || '') && (!Object.hasOwn(item.weather || {}, 'eventEnd') || item.weather?.eventEnd === (item.end || item.start || ''));
        const ordinaryPairedWeatherIsCurrent = item.type !== 'drive' && item.transportInfo?.kind !== 'flight' && weatherIsCurrent && Boolean(item.weather?.origin || item.weather?.destination);
        const driveWeatherIsCurrent = item.weather?.eventDate === item.date && item.weather?.eventStart === (item.start || '') && item.weather?.eventEnd === (item.end || item.start || '');
        const flightWeatherIsCurrent = item.weather?.eventDate === item.date && item.weather?.eventStart === (item.start || '') && item.weather?.eventEnd === (item.end || item.start || '') && item.weather?.arrivalDate === (item.flightInfo?.arrivalDate || item.date) && item.weather?.departureAirport === (item.flightInfo?.departureAirport || '') && item.weather?.arrivalAirport === (item.flightInfo?.arrivalAirport || '');
        const trainWeatherIsCurrent = item.transportInfo?.kind === 'train' && item.weather?.eventDate === item.date && item.weather?.eventStart === (item.start || '') && item.weather?.eventEnd === (item.end || item.start || '') && item.weather?.arrivalDate === (item.transportInfo?.arrivalDate || item.date) && item.weather?.departureStation === (item.transportInfo?.departureStation || '') && item.weather?.arrivalStation === (item.transportInfo?.arrivalStation || '');
        const midpointWeather = item.type === 'drive' && driveWeatherIsCurrent ? item.weather?.midpoint : null;
        const weatherText = item.type === 'drive'
          ? (driveWeatherIsCurrent ? (midpointWeather ? `路程中点 ${weatherSummary(midpointWeather)}` : [item.weather?.origin && `起点 ${weatherSummary(item.weather.origin)}`, item.weather?.destination && `终点 ${weatherSummary(item.weather.destination)}`].filter(Boolean).join(' · ')) : '')
          : item.transportInfo?.kind === 'flight'
            ? (flightWeatherIsCurrent ? [item.weather?.origin && `起飞 ${weatherSummary(item.weather.origin)}`, item.weather?.destination && `降落 ${weatherSummary(item.weather.destination)}`].filter(Boolean).join(' · ') : '')
            : item.transportInfo?.kind === 'train'
              ? (trainWeatherIsCurrent ? [item.weather?.origin && `出发 ${weatherSummary(item.weather.origin)}`, item.weather?.destination && `到达 ${weatherSummary(item.weather.destination)}`].filter(Boolean).join(' · ') : '')
            : (ordinaryPairedWeatherIsCurrent
              ? [item.weather?.origin && `开始 ${weatherSummary(item.weather.origin)}`, item.weather?.destination && `结束 ${weatherSummary(item.weather.destination)}`].filter(Boolean).join(' · ')
              : (weatherIsCurrent ? weatherSummary(item.weather) : ''));
        const pairedWeatherIsCurrent = item.type === 'drive' ? driveWeatherIsCurrent : item.transportInfo?.kind === 'flight' ? flightWeatherIsCurrent : item.transportInfo?.kind === 'train' ? trainWeatherIsCurrent : ordinaryPairedWeatherIsCurrent;
        const nestedRouteParent = depth > 0
          ? placed.filter(entry => entry.depth < depth && entry.item.type === 'drive' && entry.start <= start && entry.end === end).sort((a, b) => b.depth - a.depth)[0]?.item
          : null;
        const nestedRouteEndWeather = nestedRouteParent && nestedRouteParent.weather?.eventDate === nestedRouteParent.date
          && nestedRouteParent.weather?.eventStart === (nestedRouteParent.start || '')
          && nestedRouteParent.weather?.eventEnd === (nestedRouteParent.end || nestedRouteParent.start || '')
          ? nestedRouteParent.weather?.destination
          : null;
        let originWeather = pairedWeatherIsCurrent && !midpointWeather ? item.weather?.origin : null;
        let destinationWeather = pairedWeatherIsCurrent && !midpointWeather ? item.weather?.destination : null;
        let singleWeather = midpointWeather || (item.type !== 'drive' && !['flight', 'train'].includes(item.transportInfo?.kind) && weatherIsCurrent && !ordinaryPairedWeatherIsCurrent ? item.weather : null);
        if (nestedRouteEndWeather) {
          originWeather ||= singleWeather;
          destinationWeather = nestedRouteEndWeather;
          singleWeather = null;
        }
        const originWeatherKey = originWeather ? weatherBackgroundKey(originWeather) : '';
        const destinationWeatherKey = destinationWeather ? weatherBackgroundKey(destinationWeather) : '';
        const primaryWeatherKey = singleWeather ? weatherBackgroundKey(singleWeather) : originWeatherKey || destinationWeatherKey;
        const splitWeather = Boolean(originWeatherKey && destinationWeatherKey && originWeatherKey !== destinationWeatherKey);
        const weatherClass = primaryWeatherKey ? ` has-weather${splitWeather ? ' weather-split' : ''}${(singleWeather || originWeather)?.isNight === true ? ' weather-night' : ''}` : '';
        const weatherStyle = primaryWeatherKey ? `;--weather-primary:url('/assets/weather/v2/${primaryWeatherKey}.jpg?v=natural-20260825-2')${splitWeather ? `;--weather-secondary:url('/assets/weather/v2/${destinationWeatherKey}.jpg?v=natural-20260825-2')` : ''}` : '';
        const weatherBadgeMarkup = originWeather || destinationWeather
          ? `<span class="weather-badge weather-badge-paired">${originWeather ? `<span>${weatherBadgeText(originWeather)}</span>` : ''}${destinationWeather ? `<span>${weatherBadgeText(destinationWeather)}</span>` : ''}</span>`
          : singleWeather ? `<span class="weather-badge"><span>${weatherBadgeText(singleWeather)}</span></span>` : '';
        const segmentLabel = item.segmentKind === 'departure' ? '跨天出发' : item.segmentKind === 'continuation' ? '跨天续段' : item.segmentKind === 'arrival' ? '跨天抵达' : '';
        const segmentTime = `${item.segmentStart}${item.segmentEnd ? `–${item.segmentEnd}` : ''}`;
        const tooltip = `${segmentTime} · ${label}${segmentLabel ? ` · ${segmentLabel}` : ''} · ${item.title}${meta ? ` · ${meta}` : ''}`;
        const headerMarkup = `<time class="calendar-event-time">${segmentTime}</time>${segmentLabel ? `<span class="calendar-overnight-label">${segmentLabel}</span>` : ''}`;
        const cardTypeLabel = [...($('#editorType')?.options || [])].find(option => option.value === item.type)?.textContent?.trim()
          || eventTypeNames[item.type]
          || '事件';
        const typeMarkup = `<em class="calendar-event-type">${escapeHtml(cardTypeLabel)}</em>`;
        const bodyMarkup = `<b>${escapeHtml(item.title)}</b>${meta ? `<small>${escapeHtml(meta)}</small>` : ''}${weatherText ? `<small class="weather-meta">${escapeHtml(weatherText)}</small>` : ''}`;
        let renderedContent = `${headerMarkup}${typeMarkup}${bodyMarkup}`;
        if (hasNestedChildren) {
          renderedContent = `<span class="calendar-parent-header">${headerMarkup}${typeMarkup}<b class="calendar-parent-title">${escapeHtml(item.title)}</b></span>`;
        }
        renderedContent += weatherBadgeMarkup;
        if (document.documentElement.dataset.previewMode === 'mobile') {
          renderedContent = `<div class="ui-event-body${height < 46 ? ' is-compact' : ''}${hasNestedChildren ? ' is-parent' : ''}"><div class="ui-event-meta"><time>${segmentTime}</time><em>${escapeHtml(cardTypeLabel)}</em>${segmentLabel ? `<span>${segmentLabel}</span>` : ''}</div><strong class="ui-event-title">${escapeHtml(item.title)}</strong>${!hasNestedChildren && meta ? `<span class="ui-event-detail">${escapeHtml(meta)}</span>` : ''}</div>${weatherBadgeMarkup}`;
        }
        const visualType = ({ flight: 'transport', service: 'supply', fuel: 'supply' }[item.type] || item.type || 'spot');
        return `<div class="calendar-block type-${visualType} ${classify(item)}${weatherClass}${compactClass}${shortClass}${tallClass}${roomyClass}${nestingClass}${item.segmentKind !== 'single' ? ` overnight-segment overnight-${item.segmentKind}` : ''}${state.selectedIndex === item.index ? ' selected' : ''}${selectedScheduleIndexes.has(item.index) ? ' batch-selected' : ''}" data-nesting-depth="${depth}" data-segment-kind="${item.segmentKind}" data-compact-label="${escapeHtml(`${label} · ${item.title}`)}" title="${escapeHtml(tooltip)}" draggable="true" data-schedule-index="${item.index}" style="top:${top}px;height:${height}px;left:${left};right:auto;width:${width};z-index:${depth + 1}${weatherStyle}">${renderedContent}</div>`;
      }).join('');
      return `<div class="calendar-day" data-date="${date}">${blocks}</div>`;
    }).join('');
    // 移动端的 is-expanded 表示当前页占满手机画布，并不表示要把所有日期压进一屏。
    // 全部日期仍保持可读列宽并横向滚动；只有单日或真正的桌面展开模式使用 100%。
    const isMobilePreview = document.documentElement.dataset.previewMode === 'mobile';
    const fillAvailableWidth = Boolean(selected) || (!isMobilePreview && schedulePanel.classList.contains('is-expanded'));
    const gridWidth = fillAvailableWidth ? '100%' : `${Math.max(520, 64 + dates.length * (isMobilePreview ? 302 : 220))}px`;
    const gridHtml = `<div class="schedule-scroll"><div class="calendar-grid" style="--days:${dates.length};--grid-width:${gridWidth};--hour-height:${hourHeight}px;--half-hour-height:${hourHeight / 2}px;--calendar-height:${hourHeight * visibleHours}px;--calendar-font-scale:${calendarFontScale}"><div class="calendar-corner"></div>${header}<div class="time-rail">${rail}</div>${columns}</div></div>`;
    schedule.innerHTML = gridHtml;
    const grid = schedule.querySelector('.calendar-grid');
    if (grid) {
      const refreshLine = () => updateNowLine(grid, { startMinute, endMinute, dates });
      refreshLine();
      // 样式表、字体和切页恢复可能在首轮 DOM 渲染后改变刻度间距；监听实际时间尺，
      // 每次尺寸稳定后重新按刻度定位，避免红线保留首轮旧坐标直到下一分钟。
      nowLineResizeObserver?.disconnect();
      nowLineResizeObserver = new ResizeObserver(refreshLine);
      const rail = grid.querySelector('.time-rail');
      if (rail) nowLineResizeObserver.observe(rail);
      requestAnimationFrame(() => requestAnimationFrame(refreshLine));
      document.fonts?.ready?.then(refreshLine).catch(() => {});
    }
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
      if (document.documentElement.dataset.previewMode === 'mobile' && document.body.dataset.mobileView !== 'schedule') return;
      if (!schedulePanel.getClientRects().length) return;
      const nextHeight = scheduleHourHeight();
      if (Number($('#schedule').dataset.hourHeight) !== nextHeight) { renderSchedule(state.schedule); applyDayFilter(); }
    }, 80);
  });
  resizeObserver.observe(schedulePanel);
  window.addEventListener('mobile:viewchange', event => {
    if (event.detail?.view !== 'schedule' || document.documentElement.dataset.previewMode !== 'mobile') return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!schedulePanel.getClientRects().length || !state.schedule.length) return;
      const nextHeight = scheduleHourHeight();
      if (Number($('#schedule').dataset.hourHeight) !== nextHeight) { renderSchedule(state.schedule); applyDayFilter(); }
      window.dispatchEvent(new CustomEvent('schedule:autoposition'));
    }));
  });

  // 首页初始化后每 60 秒刷新一次当前时间线（仅更新时间线 DOM，不重渲染网格）。
  const updateNowLineMinute = () => {
    const grid = $('#schedule')?.querySelector('.calendar-grid');
    if (!grid) return;
    const hourHeight = Number($('#schedule').dataset.hourHeight) || scheduleHourHeight();
    const dates = [...grid.querySelectorAll('.calendar-day')].map(day => day.dataset.date).filter(Boolean);
    const startMinute = Number($('#schedule').dataset.startMinute) || 7 * 60;
    const endMinute = Number($('#schedule').dataset.endMinute) || 23 * 60;
    updateNowLine(grid, { hourHeight, startMinute, endMinute, dates });
  };
  setInterval(updateNowLineMinute, 60_000);
  window.addEventListener('schedule:viewmodechange', updateNowLineMinute);

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
    const isMobile = document.documentElement.dataset.previewMode === 'mobile';
    const multiselect = isMobile && document.body.classList.contains('mobile-multiselect');
    if (multiselect) {
      if (suppressScheduleClick) { suppressScheduleClick = false; return; }
      if (block) {
        const index = Number(block.dataset.scheduleIndex);
        if (selectedScheduleIndexes.has(index)) selectedScheduleIndexes.delete(index);
        else selectedScheduleIndexes.add(index);
        block.classList.toggle('batch-selected', selectedScheduleIndexes.has(index));
        focusScheduleEvent(index);
      } else {
        // 多选模式下点空白清空选择
        selectedScheduleIndexes.clear();
        document.querySelectorAll('.calendar-block.batch-selected').forEach(node => node.classList.remove('batch-selected'));
      }
      refreshScheduleBatchControls();
      window.dispatchEvent(new CustomEvent('mobile:selectionchange'));
      return;
    }
    // 移动端非多选模式：单击卡片只聚焦预览，不进入选中态/不保持高亮；
    // 避免"误触点一次后一直选中，导致翻页被误判为拖动"。双击编辑、长按拖动由别处处理。
    if (isMobile) {
      if (suppressScheduleClick) { suppressScheduleClick = false; return; }
      if (block) {
        const index = Number(block.dataset.scheduleIndex);
        selectedScheduleIndexes.clear();
        scheduleSelectionAnchor = null;
        focusScheduleEvent(index);
      }
      return;
    }
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
          const hourHeight = scheduleHourHeight(); const dayStartMinute = Number($('#schedule').dataset.startMinute) || 7 * 60; const rawMinute = dayStartMinute + (event.clientY - day.getBoundingClientRect().top) / hourHeight * 60;
          const candidates = state.schedule.map((entry, index) => ({ entry, index, end: clockToMinute(entry.end || entry.start) })).filter(item => item.entry.date === day.dataset.date && item.end <= rawMinute).sort((a, b) => b.end - a.end);
          const previous = candidates[0];
          schedulePasteAnchor = previous ? previous.index + 1 : state.schedule.findIndex(entry => entry.date === day.dataset.date);
          if (schedulePasteAnchor < 0) schedulePasteAnchor = state.schedule.length;
          schedulePasteTarget = { date: day.dataset.date, start: minuteToClock(previous?.end ?? dayStartMinute) };
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
  // 进入/退出移动端多选模式时重置选中状态，避免残留
  window.addEventListener('mobile:multiselect', () => {
    selectedScheduleIndexes.clear();
    document.querySelectorAll('.calendar-block.batch-selected').forEach(node => node.classList.remove('batch-selected'));
    refreshScheduleBatchControls();
    window.dispatchEvent(new CustomEvent('mobile:selectionchange'));
  });
  $('#dayFilter').onchange = event => changeDayFilter(event.target.value);

  function changeDayFilter(value) {
    state.dayFilter = value;
    state.selectedIndex = null;
    mapFocusDateReset();
    state.schedule.length ? renderSchedule(state.schedule) : renderManualSchedule();
    applyDayFilter();
    renderRouteTotals();
    return showDayOverview(state.dayFilter);
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
      window.removeEventListener('schedule:viewmodechange', updateNowLineMinute);
      document.removeEventListener('keydown', keydownHandler);
    }
  };
}
