export function createPlaceDropController({ state, $, escapeHtml, routeForScheduleEvent }) {
  const actionDialog = $('#placeDropEditor');
  const createDialog = $('#placeCreateDropEditor');

  function chooseAction(event, place) {
    const route = event.type === 'drive' ? routeForScheduleEvent(event) : null;
    const links = route ? { ...event.routeLinks, ...route } : event.routeLinks || {};
    const targets = event.type === 'drive'
      ? [
        { key: 'originPlaceId', label: '起点', id: links.originPlaceId },
        ...(links.viaPlaceIds || []).map((id, index) => ({ key: 'viaPlaceIds', viaIndex: index, label: `途经点 ${index + 1}`, id })),
        { key: 'destinationPlaceId', label: '终点', id: links.destinationPlaceId }
      ]
      : [{ key: 'locationId', label: '关联地点', id: event.locationId }];
    const select = $('#placeDropTarget');
    select.innerHTML = targets.map((target, index) => {
      const current = state.locations.find(item => item.id === target.id);
      return `<option value="${index}">${escapeHtml(target.label)}：${escapeHtml(current?.name || '未关联')}</option>`;
    }).join('');
    $('#placeDropTargetLabel').hidden = targets.length < 2;
    $('#placeDropPrompt').textContent = `将“${place.name || '未命名地点'}”拖入“${event.title || '未命名事件'}”。请选择处理方式。`;
    actionDialog.showModal();
    return new Promise(resolve => {
      const close = action => { actionDialog.close(); resolve(action ? { action, target: targets[Number(select.value) || 0] } : null); };
      $('#placeDropCancel').onclick = () => close(null);
      $('#placeDropReplace').onclick = () => close('replace');
      $('#placeDropUpdate').onclick = () => close('update');
      actionDialog.oncancel = dialogEvent => { dialogEvent.preventDefault(); close(null); };
    });
  }

  function confirmCreation(place, date, start, end) {
    $('#placeCreateDropPrompt').textContent = `在 ${date} ${start}–${end} 新建“${place.name || '未命名地点'}”事件，并关联该地点？`;
    createDialog.showModal();
    return new Promise(resolve => {
      const close = confirmed => { createDialog.close(); resolve(confirmed); };
      $('#placeCreateDropCancel').onclick = () => close(false);
      $('#placeCreateDropConfirm').onclick = () => close(true);
      createDialog.oncancel = dialogEvent => { dialogEvent.preventDefault(); close(false); };
    });
  }

  function apply(event, place, choice) {
    if (!choice) return false;
    const route = event.type === 'drive' ? routeForScheduleEvent(event) : null;
    const links = route ? { ...event.routeLinks, ...route } : event.routeLinks || {};
    const target = choice.target;
    if (choice.action === 'update' && target.id) {
      const current = state.locations.find(item => item.id === target.id);
      if (current && current.id !== place.id) Object.assign(current, structuredClone({ ...place, id: current.id }));
    } else if (target.key === 'viaPlaceIds') {
      links.viaPlaceIds ||= []; links.viaPlaceIds[target.viaIndex] = place.id;
    } else links[target.key] = place.id;
    if (event.type === 'drive') {
      event.routeLinks = { ...event.routeLinks, ...links };
      if (route) Object.assign(route, links);
    } else event.locationId = choice.action === 'update' && target.id ? target.id : place.id;
    return true;
  }

  return { chooseAction, confirmCreation, apply };
}
