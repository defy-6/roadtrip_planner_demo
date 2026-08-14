// 路线节点编辑：左侧节点表单的创建、字段同步与内联路线/地点操作。
// 事件编辑器通过 openScheduleEditor 回调打开；地点库通过 confirmNewPlace 回调新增。
export function createRouteEditor({
  state, $, template, itemsEl, values, escapeHtml,
  renderSchedule, renderManualSchedule, applyDayFilter,
  focusScheduleEvent, focusNode, openScheduleEditor,
  resolveInlinePlace, upsertUniversalRoute, renderLocations, save,
  showDayOverview, showDriveSegment, geocode, confirmNewPlace, typeForTitle,
  selectedPlaceIds, calculateRouteTotals, fmtDuration, routeForScheduleEvent
}) {
  function addItem(data = {}) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.dataset.id = crypto.randomUUID();
    if (Number.isInteger(data.scheduleIndex)) node.dataset.scheduleIndex = String(data.scheduleIndex);
    $('.type', node).value = data.type || 'spot'; $('.date', node).value = data.date || '';
    $('.start-time', node).value = data.startTime || ''; $('.end-time', node).value = data.endTime || '';
    $('.name', node).value = data.name || ''; $('.address', node).value = data.address || ''; $('.note', node).value = data.note || '';
    if (data.photo) { const p=$('.preview',node);p.src=data.photo;p.hidden=false; }
    $('.delete', node).onclick = () => { node.remove(); save(); renderManualSchedule(); };
    $('.photo', node).onchange = e => { const f=e.target.files[0]; if(!f)return; const r=new FileReader(); r.onload=()=>{const p=$('.preview',node);p.src=r.result;p.hidden=false;save()}; r.readAsDataURL(f); };
    const locate = document.createElement('button'); locate.type = 'button'; locate.className = 'map-focus'; locate.textContent = '在地图中查看';
    locate.onclick = event => { event.stopPropagation(); const index = Number(node.dataset.scheduleIndex); if (Number.isInteger(index)) focusScheduleEvent(index); else focusNode(node); };
    $('.item-main', node).append(locate);
    if (Number.isInteger(data.scheduleIndex)) {
      const event = state.schedule[data.scheduleIndex];
      const place = state.locations.find(item => item.id === event?.locationId);
      const placeName = document.createElement('input'); placeName.className = 'place-query-name'; placeName.placeholder = '地点名称，如：伊宁机场'; placeName.value = place?.name || '';
      $('.item-main', node).insertBefore(placeName, $('.address', node));
      if (place?.address) $('.address', node).value = place.address;
      const createPlace = document.createElement('button'); createPlace.type = 'button'; createPlace.className = 'place-create'; createPlace.textContent = place ? '更新关联地点并查询' : '创建地点并查询';
      createPlace.hidden = event?.type === 'drive' || event?.type === 'flight'; createPlace.onclick = async clickEvent => { clickEvent.stopPropagation(); await createOrUpdatePlaceForNode(node); };
      $('.item-main', node).insertBefore(createPlace, locate);
      const routeInline = document.createElement('section'); routeInline.className = 'route-inline'; routeInline.hidden = event?.type !== 'drive';
      routeInline.innerHTML = '<b>路程起终点</b><div class="route-inline-grid"><input class="inline-origin-name" placeholder="起点名称"><input class="inline-origin-address" placeholder="起点地址"><input class="inline-destination-name" placeholder="终点名称"><input class="inline-destination-address" placeholder="终点地址"></div><textarea class="inline-waypoints" placeholder="途经点（可选），每行：名称｜地址"></textarea><button type="button" class="inline-route-create">查询地点并生成路线</button>';
      $('.item-main', node).insertBefore(routeInline, locate); fillInlineRouteControls(node, data.scheduleIndex);
      $('.inline-route-create', node).onclick = async clickEvent => { clickEvent.stopPropagation(); await createRouteFromNode(node); };
      refreshNodePlaceLink(node, data.scheduleIndex);
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'event-edit'; edit.textContent = '编辑事件 / 关联地点';
      edit.onclick = event => { event.stopPropagation(); openScheduleEditor(Number(node.dataset.scheduleIndex)); };
      $('.item-main', node).append(edit);
      if (event?.type === 'drive' || event?.type === 'flight') { $('.address', node).hidden = true; $('.place-query-name', node).hidden = true; }
    }
    node.addEventListener('change', () => { const type = $('.type', node).value, isDrive = type === 'drive', isFlight = type === 'flight'; $('.place-create', node)?.toggleAttribute('hidden', isDrive || isFlight); $('.place-query-name', node)?.toggleAttribute('hidden', isDrive || isFlight); $('.address', node)?.toggleAttribute('hidden', isDrive || isFlight); $('.route-inline', node)?.toggleAttribute('hidden', !isDrive); syncNodeToSchedule(node); save(); renderRouteTotals(); });
    node.addEventListener('click', event => { if (event.target.closest('input,select,textarea,button,label')) return; const index = Number(node.dataset.scheduleIndex); Number.isInteger(index) ? focusScheduleEvent(index) : focusNode(node); });
    node.addEventListener('dragstart', () => { state.dragging=node; node.classList.add('dragging'); });
    node.addEventListener('dragend', () => {
      node.classList.remove('dragging'); state.dragging=null;
      const orderedNodes = [...itemsEl.children];
      const orderedSchedule = orderedNodes.map(item => state.schedule[Number(item.dataset.scheduleIndex)]).filter(Boolean);
      if (orderedSchedule.length === state.schedule.length) {
        state.schedule = orderedSchedule;
        orderedNodes.forEach((item, index) => { item.dataset.scheduleIndex = String(index); });
        renderSchedule(state.schedule); applyDayFilter();
      }
      save();
    });
    node.addEventListener('dragover', e => { e.preventDefault(); if(state.dragging && state.dragging !== node) { const r=node.getBoundingClientRect(); itemsEl.insertBefore(state.dragging, e.clientY < r.top+r.height/2 ? node : node.nextSibling); } });
    itemsEl.append(node);
  }

  function refreshNodePlaceLink(node, index) {
    const oldLink = $('.event-place-link', node); oldLink?.remove();
    const event = state.schedule[index];
    if (event?.type === 'drive' || event?.type === 'flight') return;
    const place = state.locations.find(item => item.id === event?.locationId);
    if (!place) return;
    const link = document.createElement('small'); link.className = 'event-place-link'; link.textContent = `关联地点：${place.name || '未命名地点'}${place.address ? '' : '（地址待定）'}`;
    $('.item-main', node).insertBefore(link, $('.place-create', node) || $('.map-focus', node));
    const button = $('.place-create', node); if (button) button.textContent = '更新关联地点并查询';
  }

  function fillInlineRouteControls(node, index) {
    const event = state.schedule[index]; if (!event || !node) return;
    const links = event.routeLinks || {};
    const origin = state.locations.find(place => place.id === links.originPlaceId) || links.customOrigin || {};
    const destination = state.locations.find(place => place.id === links.destinationPlaceId) || links.customDestination || {};
    $('.inline-origin-name', node).value = origin.name || '';
    $('.inline-origin-address', node).value = origin.address || '';
    $('.inline-destination-name', node).value = destination.name || '';
    $('.inline-destination-address', node).value = destination.address || '';
    $('.inline-waypoints', node).value = (links.viaPlaceIds || []).map(id => state.locations.find(place => place.id === id)).filter(Boolean).map(place => `${place.name || ''}｜${place.address || ''}`).join('\n');
  }

  function parseInlineWaypoints(text) {
    return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map((line, index) => {
      const parts = line.split(/[｜|]/).map(part => part.trim());
      return parts.length > 1 ? { name: parts[0] || `途经点 ${index + 1}`, address: parts.slice(1).join('｜') } : { name: line, address: line };
    });
  }

  async function createRouteFromNode(node) {
    const index = Number(node.dataset.scheduleIndex), event = state.schedule[index];
    if (!event || event.type !== 'drive') return;
    const origin = { name: $('.inline-origin-name', node).value.trim(), address: $('.inline-origin-address', node).value.trim() };
    const destination = { name: $('.inline-destination-name', node).value.trim(), address: $('.inline-destination-address', node).value.trim() };
    const waypoints = parseInlineWaypoints($('.inline-waypoints', node).value);
    if (!origin.name || !origin.address || !destination.name || !destination.address) { alert('请完整填写起点和终点的名称、地址。'); return; }
    if (waypoints.some(place => !place.name || !place.address)) { alert('请按“名称｜地址”逐行填写途经点。'); return; }
    const button = $('.inline-route-create', node); button.disabled = true; button.textContent = '正在查询地点…';
    try {
      const originPlace = await resolveInlinePlace(origin.name, origin.address);
      const destinationPlace = await resolveInlinePlace(destination.name, destination.address);
      const viaPlaces = [];
      for (const waypoint of waypoints) viaPlaces.push(await resolveInlinePlace(waypoint.name, waypoint.address));
      if (!originPlace || !destinationPlace || viaPlaces.some(place => !place)) throw new Error('已取消新增地点，路线未创建。');
      const links = { originPlaceId: originPlace.id, destinationPlaceId: destinationPlace.id, viaPlaceIds: viaPlaces.map(place => place.id) };
      const route = upsertUniversalRoute(event.title, links);
      event.routeLinks = { ...links, routeId: route.id };
      save(); renderLocations(); renderSchedule(state.schedule); fillInlineRouteControls(node, index);
      button.textContent = '正在生成高德路线…';
      await showDriveSegment(index); await showDayOverview(state.dayFilter);
    } catch (error) { alert(error.message || '高德暂时无法查询地点或生成路线。'); }
    finally { button.disabled = false; button.textContent = '更新地点和路线'; }
  }

  async function createOrUpdatePlaceForNode(node) {
    const index = Number(node.dataset.scheduleIndex), event = state.schedule[index]; if (!event || event.type === 'drive' || event.type === 'flight') return;
    const name = $('.place-query-name', node).value.trim(); const address = $('.address', node).value.trim();
    if (!name || !address) { alert('请先填写地点名称和地点地址。'); return; }
    const button = $('.place-create', node); button.disabled = true; button.textContent = '正在查询高德…';
    try {
      const point = await geocode(address, name);
      let place = state.locations.find(item => item.id === event.locationId);
      if (!place) place = await confirmNewPlace({ type: event.type === 'transport' ? 'spot' : event.type, name, address, note: event.detail || '', fromEvent: true });
      if (!place) return;
      Object.assign(place, { type: event.type === 'transport' ? 'spot' : event.type, name, address, note: event.detail || '', resolved: { name: point.name || name, address: point.formatted_address || address, location: point.location } });
      event.locationId = place.id; event.address = '';
      refreshNodePlaceLink(node, index); renderLocations(); renderSchedule(state.schedule); save(); focusScheduleEvent(index);
    } catch (error) { alert(error.message || '高德暂时无法定位这个地点。'); }
    finally { button.disabled = false; button.textContent = event.locationId ? '更新关联地点并查询' : '创建地点并查询'; }
  }

  function refreshEventCards() { state.schedule.forEach((event, index) => updateNodeFromSchedule(index)); }

  function removeLocations(ids) {
    state.locations = state.locations.filter(place => !ids.has(place.id));
    const removedRouteIds = new Set(state.routes.filter(route => ids.has(route.originPlaceId) || ids.has(route.destinationPlaceId) || (route.viaPlaceIds || []).some(id => ids.has(id))).map(route => route.id));
    state.routes = state.routes.filter(route => !removedRouteIds.has(route.id));
    ids.forEach(id => selectedPlaceIds.delete(id));
    state.schedule.forEach(event => {
      if (ids.has(event.locationId)) delete event.locationId;
      if (!event.routeLinks) return;
      if (removedRouteIds.has(event.routeLinks.routeId)) delete event.routeLinks.routeId;
      if (ids.has(event.routeLinks.originPlaceId)) delete event.routeLinks.originPlaceId;
      if (ids.has(event.routeLinks.destinationPlaceId)) delete event.routeLinks.destinationPlaceId;
      event.routeLinks.viaPlaceIds = (event.routeLinks.viaPlaceIds || []).filter(id => !ids.has(id));
    });
    renderLocations(); renderSchedule(state.schedule); refreshEventCards(); save();
  }

  function syncNodeToSchedule(node) {
    const index = Number(node.dataset.scheduleIndex);
    if (!Number.isInteger(index) || !state.schedule[index]) { renderManualSchedule(); return; }
    const item = values(node);
    state.schedule[index] = { ...state.schedule[index], date: item.date, start: item.startTime, end: item.endTime, title: item.name, detail: item.note, address: state.schedule[index].locationId ? '' : item.address, type: item.type };
    renderSchedule(state.schedule);
    applyDayFilter();
  }

  function updateNodeFromSchedule(index) {
    const event = state.schedule[index];
    const node = [...itemsEl.children].find(item => Number(item.dataset.scheduleIndex) === index);
    if (!event || !node) return;
    $('.date', node).value = event.date; $('.start-time', node).value = event.start; $('.end-time', node).value = event.end || ''; $('.name', node).value = event.title; $('.note', node).value = event.detail || ''; $('.type', node).value = event.type || typeForTitle(event.title);
    const place = state.locations.find(item => item.id === event.locationId); $('.place-query-name', node).value = place?.name || ''; $('.address', node).value = place?.address || event.address || '';
    const isDrive = event.type === 'drive', isFlight = event.type === 'flight'; $('.place-create', node)?.toggleAttribute('hidden', isDrive || isFlight); $('.place-query-name', node)?.toggleAttribute('hidden', isDrive || isFlight); $('.address', node)?.toggleAttribute('hidden', isDrive || isFlight); $('.route-inline', node)?.toggleAttribute('hidden', !isDrive); fillInlineRouteControls(node, index); refreshNodePlaceLink(node, index);
  }

  function routeTotals() {
    return calculateRouteTotals(state.schedule, routeForScheduleEvent, state.dayFilter);
  }
  function renderRouteTotals(showDetail = false) {
    const { days, total, pending, eventCount } = routeTotals();
    $('#duration').textContent = total.count ? fmtDuration(total.duration) : '—';
    $('#distance').textContent = total.count ? `${(total.distance / 1000).toFixed(1)} 公里 · 过路费约 ${total.tolls.toFixed(0)} 元 · ${total.count}/${eventCount} 段已确认${pending ? ` · ${pending} 段待查询` : ''}` : `${eventCount} 段路程尚未查询`;
    const detail = $('#routeSummaryDetail');
    if (!showDetail) return;
    const rows = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, day]) => `<div class="route-summary-day"><b>${escapeHtml(date)}</b> · ${(day.distance / 1000).toFixed(1)} 公里 · ${fmtDuration(day.duration)} · 过路费 ${day.tolls.toFixed(0)} 元 · ${day.count} 段</div>`).join('');
    detail.innerHTML = `<b>${state.dayFilter ? `${escapeHtml(state.dayFilter)} 路程汇总` : '方案分日路程汇总'}</b><div class="route-summary-days">${rows || '<div class="route-summary-day">尚无已查询的路程。</div>'}</div><small>仅相加已保存的高德路线；${pending ? `另有 ${pending} 段待明确起终点或查询。` : '全部已确认路段均已统计。'}</small>`;
    detail.hidden = false;
  }
  $('#routeBtn').onclick = () => {
    const detail = $('#routeSummaryDetail');
    const button = $('#routeBtn');
    if (!detail.hidden) {
      detail.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      return;
    }
    renderRouteTotals(true);
    button.setAttribute('aria-expanded', 'true');
  };

  return { addItem, refreshNodePlaceLink, fillInlineRouteControls, parseInlineWaypoints, createRouteFromNode, createOrUpdatePlaceForNode, refreshEventCards, removeLocations, syncNodeToSchedule, updateNodeFromSchedule, routeTotals, renderRouteTotals };
}
