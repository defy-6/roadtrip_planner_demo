import { compressImageFile } from '../../core/utils.js';
import { mapDisplayType } from './model.js';
import { createPlaceEditorContext } from './editor-context.js';
import { createPlaceEditorSections } from './editor-sections.js';

export function createPlaceEditor({ state, $, api, geocode, confirmAction, placeTypeOptionsHtml, getDefaultType, findMatchingLocation, importUniversalPlace, normalizePlaceLookup, removeLocations, save, renderLocations, getContext = () => ({}) }) {
  const dialog = $('#placeEditor');
  dialog.classList.add('place-editor-dialog');
  dialog.querySelector('h3').id = 'placeEditorTitle';
  dialog.setAttribute('aria-labelledby', 'placeEditorTitle');
  const editorContext = createPlaceEditorContext({ dialog, getContext });
  let getReturnTarget = () => null;
  dialog.addEventListener('close', () => {
    if (dialog.ownerDocument.querySelector('dialog[open]')) return;
    const target = getReturnTarget();
    if (target?.isConnected) target.focus({ preventScroll: true });
  });
  const queryStatus = $('#newPlaceAmapStatus');
  queryStatus.classList.add('place-query-status');
  queryStatus.setAttribute('role', 'status');
  queryStatus.setAttribute('aria-live', 'polite');
  const setQueryStatus = (message, tone = 'info') => {
    queryStatus.textContent = message;
    queryStatus.dataset.tone = tone;
  };
  const showQueryError = (message, target) => {
    setQueryStatus(message, 'error');
    target?.focus();
    queryStatus.scrollIntoView({ block: 'nearest' });
  };
  ['newPlaceName', 'newPlaceAddress'].forEach(id => $(`#${id}`).addEventListener('input', () => {
    if (queryStatus.dataset.tone === 'error') setQueryStatus('填写名称后可查询位置；查询图片和 POI 详情还需要完整地址。');
  }));
  const { photoSection, photoUploadName, detailsSection, associations, candidatesPanel } = createPlaceEditorSections(dialog);
  let pendingConfirmation = null, editingId = null, resolved = null, photos = [], photoIndex = -1;
  const detailIds = ['newPlaceIntro', 'newPlaceOpenTime', 'newPlaceRating', 'newPlaceReferenceCost', 'newPlaceTicketPrice', 'newPlaceTags'];
  const hasDetails = () => detailIds.some(id => Boolean($(`#${id}`).value.trim()));
  function renderResolved() {
    const node = $('#newPlaceResolvedCoords');
    if (!resolved?.location) { node.hidden = true; node.textContent = ''; return; }
    const [longitude, latitude] = resolved.location.split(',');
    node.textContent = `高德定位：${resolved.address || resolved.name || ''} · 经度 ${longitude}，纬度 ${latitude}`; node.hidden = false;
  }
  function renderCurrentPhoto(photo = '') {
    const container = $('#newPlaceCurrentPhoto'), image = $('#newPlaceCurrentPhotoImage');
    if (!photo) { container.hidden = true; image.removeAttribute('src'); return; }
    image.src = photo; container.hidden = false;
  }
  function refreshLabels() {
    $('#queryNewPlaceLocation').textContent = resolved?.location ? '重新查询位置' : '查询高德位置';
    $('#queryNewPlacePhotos').textContent = !$('#newPlaceCurrentPhoto').hidden || photos.length ? '重新查询图片' : '查询高德图片';
    $('#queryNewPlaceDetails').textContent = hasDetails() ? '重新获取 POI 详情' : '获取 POI 详情';
    photoSection.querySelector('[data-place-photo-summary]').textContent = !$('#newPlaceCurrentPhoto').hidden || photos.length ? '已有图片 · 可更换' : '可选 · 相册或高德图片';
    detailsSection.querySelector('[data-place-details-summary]').textContent = hasDetails() || $('#newPlaceNote').value.trim() ? '已填写 · 可编辑' : '选填';
  }
  function eventAssociations(placeId) {
    if (!placeId) return [];
    return (state.schedule || []).flatMap((event, index) => {
      const roles = [];
      if (event.locationId === placeId) roles.push('关联地点');
      const flight = event.flightInfo || {};
      if (flight.departurePlaceId === placeId) roles.push('起飞机场');
      if (flight.stopoverPlaceId === placeId) roles.push('经停机场');
      if (flight.arrivalPlaceId === placeId) roles.push('到达机场');
      const train = event.transportInfo?.kind === 'train' ? event.transportInfo : {};
      if (train.departurePlaceId === placeId) roles.push('动车出发站');
      if (train.arrivalPlaceId === placeId) roles.push('动车到达站');
      const links = event.routeLinks || {};
      if (links.originPlaceId === placeId) roles.push('路线起点');
      if ((links.viaPlaceIds || []).includes(placeId)) roles.push('路线途经点');
      if (links.destinationPlaceId === placeId) roles.push('路线终点');
      const route = (state.routes || []).find(item => item.id && item.id === links.routeId);
      if (route?.originPlaceId === placeId) roles.push('路线库起点');
      if ((route?.viaPlaceIds || []).includes(placeId)) roles.push('路线库途经点');
      if (route?.destinationPlaceId === placeId) roles.push('路线库终点');
      return roles.length ? [{ event, index, roles: [...new Set(roles)] }] : [];
    });
  }
  function renderAssociations(placeId) {
    const matches = eventAssociations(placeId);
    associations.replaceChildren();
    if (!placeId) { associations.hidden = true; return; }
    const heading = document.createElement('b'); heading.textContent = `关联安排（${matches.length}）`; associations.append(heading);
    if (!matches.length) {
      const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = '这个地点目前没有关联任何安排。'; associations.append(empty);
    } else {
      const list = document.createElement('ul');
      matches.forEach(({ event, roles }) => {
        const item = document.createElement('li');
        const time = [event.start, event.end].filter(Boolean).join('–');
        item.textContent = `${event.date || '日期待定'}${time ? ` ${time}` : ''} · ${event.title || '未命名安排'} · ${roles.join('、')}`;
        list.append(item);
      });
      associations.append(list);
    }
    associations.hidden = false;
  }
  function renderPhotos() {
    const container = $('#newPlacePhotoCandidates'); container.replaceChildren();
    photos.forEach((photo, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = index === photoIndex ? 'selected' : ''; button.title = `采用高德图片：${photo.title || ''}`;
      button.setAttribute('aria-label', `采用第 ${index + 1} 张高德图片：${photo.title || 'POI 图片'}`);
      button.setAttribute('aria-pressed', String(index === photoIndex));
      const image = document.createElement('img'); image.src = photo.url; image.alt = photo.title || '高德 POI 图片'; button.append(image);
      button.onclick = () => {
        photoIndex = index;
        [...container.children].forEach((candidate, candidateIndex) => {
          candidate.classList.toggle('selected', candidateIndex === photoIndex);
          candidate.setAttribute('aria-pressed', String(candidateIndex === photoIndex));
        });
        setQueryStatus(`已选第 ${index + 1} 张高德候选图，保存地点后生效。`, 'success');
      };
      container.append(button);
    });
    container.hidden = !photos.length;
  }
  function renderLocationCandidates(candidates, name) {
    candidatesPanel.replaceChildren();
    candidates.slice(0, 10).forEach(point => {
      const duplicate = findMatchingLocation(state.locations, point.formatted_address, point.name || name, point.location)
        || findMatchingLocation(state.universalLocations, point.formatted_address, point.name || name, point.location);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'place-query-candidate';
      const title = document.createElement('b'); title.textContent = point.name || name;
      const address = document.createElement('small'); address.textContent = point.formatted_address || '地址未提供';
      const action = document.createElement('em'); action.textContent = duplicate ? '使用已有地点' : editingId ? '选择此位置' : '一键新建';
      button.append(title, address, action);
      button.onclick = () => {
        if (duplicate) {
          const place = state.locations.find(item => item.id === duplicate.id) || importUniversalPlace(duplicate);
          renderLocations(); dialog.close(); editingId = null; pendingConfirmation?.(place); pendingConfirmation = null;
          return;
        }
        resolved = { name: point.name || name, address: point.formatted_address || '', location: point.location };
        if (!editingId) {
          const keys = ['intro', 'openTime', 'rating', 'referenceCost', 'ticketPrice', 'tags'];
          const poiDetails = Object.fromEntries(keys.map((key, index) => [key, $(`#${detailIds[index]}`).value.trim()]));
          const place = {
            id: crypto.randomUUID(), type: $('#newPlaceType').value, name: resolved.name, address: resolved.address,
            note: $('#newPlaceNote').value.trim(), poiDetails, resolved
          };
          state.locations.push(place); save(); renderLocations(); dialog.close();
          candidatesPanel.hidden = true; pendingConfirmation?.(place); pendingConfirmation = null;
          return;
        }
        $('#newPlaceName').value ||= resolved.name; $('#newPlaceAddress').value = resolved.address; renderResolved(); candidatesPanel.hidden = true;
        setQueryStatus('已选择高德候选位置，保存地点后生效。', 'success'); refreshLabels();
      };
      candidatesPanel.append(button);
    });
    candidatesPanel.hidden = !candidates.length;
  }
  function reset(initial = {}, place = null) {
    $('#placeEditorForm').reset(); editingId = place?.id || null; resolved = place?.resolved || null; photos = []; photoIndex = -1; candidatesPanel.replaceChildren(); candidatesPanel.hidden = true;
    renderPhotos(); renderResolved(); renderCurrentPhoto(place?.photo || '');
    $('#newPlaceType').innerHTML = placeTypeOptionsHtml(); $('#newPlaceType').value = mapDisplayType(place?.type || initial.type || getDefaultType() || 'spot');
    $('#newPlaceName').value = place?.name || initial.name || ''; $('#newPlaceAddress').value = place?.address || initial.address || ''; $('#newPlaceNote').value = place?.note || initial.note || '';
    const details = place?.poiDetails || {};
    detailIds.forEach((id, index) => { $(`#${id}`).value = details[['intro', 'openTime', 'rating', 'referenceCost', 'ticketPrice', 'tags'][index]] || ''; });
    photoSection.open = false; detailsSection.open = false; photoUploadName.textContent = '未选择图片';
    $('#placeEditorDelete').hidden = !place; renderAssociations(place?.id); refreshLabels();
  }
  function confirmNewPlace(initial = {}) {
    const active = dialog.ownerDocument.activeElement;
    getReturnTarget = () => active;
    const cached = findMatchingLocation(state.universalLocations, initial.address, initial.name);
    if (cached) return Promise.resolve(importUniversalPlace(cached));
    reset(initial); editorContext.render(); setQueryStatus('只填写名称也可以查询高德位置；地址可用于缩小搜索范围。');
    dialog.querySelector('h3').textContent = initial.fromEvent ? '确认新增并关联地点' : '新增地点'; dialog.showModal();
    requestAnimationFrame(() => $('#newPlaceName').focus());
    if (initial.name) requestAnimationFrame(async () => { await queryLocation(); if ($('#newPlaceAddress').value.trim()) queryPhotos(); });
    return new Promise(resolveConfirmation => { pendingConfirmation = resolveConfirmation; });
  }
  function openPlaceEditor(placeId, returnTarget) {
    const active = dialog.ownerDocument.activeElement;
    getReturnTarget = returnTarget || (() => active);
    // placeId 为空 = 新建地点（reset 已支持 place 为空）
    const place = state.locations.find(item => item.id === placeId);
    reset({}, place || null); editorContext.render(); refreshLabels();
    setQueryStatus(place?.resolved ? `已定位：${place.resolved.name || place.name}。可重新查询位置、图片或 POI 详情；保存不会重复查询。` : '只填写名称也可以查询高德位置；地址可用于缩小搜索范围。', place?.resolved ? 'success' : 'info');
    dialog.querySelector('h3').textContent = place ? '编辑地点' : '新增地点'; dialog.showModal(); requestAnimationFrame(() => $('#newPlaceName').focus());
  }
  function cancel() { dialog.close(); editingId = null; $('#placeEditorDelete').hidden = true; pendingConfirmation?.(null); pendingConfirmation = null; }
  async function queryLocation() {
    const name = $('#newPlaceName').value.trim(), address = $('#newPlaceAddress').value.trim(); if (!name) { showQueryError('请先填写地点名称。', $('#newPlaceName')); return false; }
    const button = $('#queryNewPlaceLocation'); button.disabled = true; button.textContent = '查询中…'; setQueryStatus('正在查询高德位置…');
    try {
      const result = await api.geocode({ address: address || name, keyword: name });
      const candidates = (result.geocodes || []).filter(point => point?.location);
      if (!candidates.length) throw new Error('高德没有找到匹配地点');
      renderLocationCandidates(candidates, name);
      if (candidates.length === 1) { const point = candidates[0]; resolved = { name: point.name || name, address: point.formatted_address || address, location: point.location }; $('#newPlaceAddress').value = resolved.address; renderResolved(); }
      setQueryStatus(candidates.length > 1 ? `找到 ${candidates.length} 个高德候选，请选择正确地点。` : `已按${address ? '名称和地址' : '名称'}定位并回填地址。`, 'success'); return true;
    }
    catch (error) { resolved = null; renderResolved(); showQueryError(error.message || '高德位置查询失败，请检查地点名称。', $('#newPlaceName')); return false; }
    finally { button.disabled = false; refreshLabels(); }
  }
  async function queryPhotos() {
    const name = $('#newPlaceName').value.trim(), address = $('#newPlaceAddress').value.trim(); if (!name || !address) { showQueryError('请先填写地点名称和完整地址。', !name ? $('#newPlaceName') : $('#newPlaceAddress')); return; }
    const button = $('#queryNewPlacePhotos'); button.disabled = true; button.textContent = '查询中…'; setQueryStatus('正在查询高德图片…');
    try { const data = await api.getPlacePhotos({ name, address }); photos = data.photos || []; photoIndex = -1; renderPhotos(); if (photos.length) photoSection.open = true; const source = data.cached ? '本地缓存' : '本次高德查询'; setQueryStatus(photos.length ? `找到 ${photos.length} 张高德候选图（${source}），请选择一张。` : `高德暂未返回可用图片（${source}）。`, photos.length ? 'success' : 'warning'); }
    catch (error) { photos = []; photoIndex = -1; renderPhotos(); showQueryError(error.message || '高德图片查询失败，请检查名称和地址。', $('#newPlaceAddress')); }
    finally { button.disabled = false; refreshLabels(); }
  }
  async function queryDetails(event) {
    const name = $('#newPlaceName').value.trim(), address = $('#newPlaceAddress').value.trim(); if (!name || !address) { showQueryError('请先填写地点名称和完整地址。', !name ? $('#newPlaceName') : $('#newPlaceAddress')); return; }
    const button = event.currentTarget; button.disabled = true; button.textContent = '查询中…'; setQueryStatus('正在获取高德 POI 详情…');
    try { const data = await api.getPlaceDetails({ name, address }), detail = data.poi || {}; detailIds.forEach((id, index) => { $(`#${id}`).value = detail[['intro', 'openTime', 'rating', 'referenceCost', 'ticketPrice', 'tags'][index]] || ''; }); detailsSection.open = true; if (detail.location) { resolved = { name: detail.name || name, address: detail.address || address, location: detail.location }; $('#newPlaceAddress').value = resolved.address; renderResolved(); } setQueryStatus(`已填入高德 Web 服务实际返回的 POI 详情（${data.cached ? '本地缓存' : '本次高德查询'}）；空字段表示该接口未提供。`, 'success'); }
    catch (error) { showQueryError(error.message || '高德 POI 详情查询失败。', $('#newPlaceAddress')); }
    finally { button.disabled = false; refreshLabels(); }
  }
  async function submit(event) {
    event.preventDefault(); const name = $('#newPlaceName').value.trim(); if (!name) { $('#newPlaceName').focus(); return; }
    const photoFile = $('#newPlacePhoto').files[0], address = $('#newPlaceAddress').value.trim(), selectedPhoto = photos[photoIndex];
    const keys = ['intro', 'openTime', 'rating', 'referenceCost', 'ticketPrice', 'tags']; const poiDetails = Object.fromEntries(keys.map((key, index) => [key, $(`#${detailIds[index]}`).value.trim()]));
    const draft = { type: $('#newPlaceType').value, name, address, note: $('#newPlaceNote').value.trim(), poiDetails, ...(photoFile ? { photo: await compressImageFile(photoFile) } : selectedPhoto ? { photo: selectedPhoto.url, photoSource: `高德 POI · ${selectedPhoto.poiName || name}` } : {}) };
    const button = event.submitter; if (button) { button.disabled = true; button.textContent = '正在保存…'; }
    let place = editingId ? state.locations.find(item => item.id === editingId) : findMatchingLocation(state.locations, draft.address, draft.name, resolved?.location);
    if (!place && !editingId) place = importUniversalPlace(findMatchingLocation(state.universalLocations, draft.address, draft.name, resolved?.location));
    const addressChanged = Boolean(place && normalizePlaceLookup(place.address) !== normalizePlaceLookup(draft.address));
    if (!place) place = { id: crypto.randomUUID(), ...draft }; else Object.assign(place, draft);
    if (resolved?.location) place.resolved = resolved; else if (addressChanged) delete place.resolved;
    if (!state.locations.some(item => item.id === place.id)) state.locations.push(place);
    save(); renderLocations(); dialog.close(); editingId = null; $('#placeEditorDelete').hidden = true;
    if (button) { button.disabled = false; button.textContent = '保存地点'; } pendingConfirmation?.(place); pendingConfirmation = null;
  }
  $('#placeEditorCancel').onclick = cancel; dialog.oncancel = event => { event.preventDefault(); cancel(); };
  $('#placeEditorDelete').onclick = async event => {
    const place = state.locations.find(item => item.id === editingId); if (!place) return;
    const trigger = event.currentTarget;
    trigger.focus({ preventScroll: true });
    const confirmed = await confirmAction({
      title: '删除地点',
      message: `确定删除“${place.name || '未命名地点'}”吗？`,
      detail: '相关行程和路线中的地点关联会解除，此操作无法撤销。',
      confirmLabel: '删除地点'
    });
    if (!confirmed) {
      if (dialog.open && dialog.ownerDocument.querySelectorAll('dialog[open]').length === 1) trigger.focus({ preventScroll: true });
      return;
    }
    const id = place.id; cancel(); removeLocations(new Set([id]));
  };
  $('#queryNewPlaceLocation').onclick = queryLocation; $('#queryNewPlacePhotos').onclick = queryPhotos; $('#queryNewPlaceDetails').onclick = queryDetails; $('#placeEditorForm').onsubmit = submit;
  return { confirmNewPlace, openPlaceEditor };
}
