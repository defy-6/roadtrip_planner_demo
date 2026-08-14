export function createPlaceEditor({ state, $, api, geocode, placeTypeOptionsHtml, getDefaultType, findMatchingLocation, importUniversalPlace, normalizePlaceLookup, removeLocations, save, renderLocations }) {
  const dialog = $('#placeEditor');
  let pendingConfirmation = null, editingId = null, resolved = null, photos = [], photoIndex = -1;
  const detailIds = ['newPlaceIntro', 'newPlaceOpenTime', 'newPlaceRating', 'newPlaceReferenceCost', 'newPlaceTicketPrice', 'newPlaceTags'];
  const hasDetails = () => detailIds.some(id => Boolean($(`#${id}`).value.trim()));
  const fileToDataUrl = file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
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
  }
  function renderPhotos() {
    const container = $('#newPlacePhotoCandidates'); container.replaceChildren();
    photos.forEach((photo, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = index === photoIndex ? 'selected' : ''; button.title = `采用高德图片：${photo.title || ''}`;
      const image = document.createElement('img'); image.src = photo.url; image.alt = photo.title || '高德 POI 图片'; button.append(image);
      button.onclick = () => { photoIndex = index; renderPhotos(); $('#newPlaceAmapStatus').textContent = `已选第 ${index + 1} 张高德候选图，保存地点后生效。`; };
      container.append(button);
    });
    container.hidden = !photos.length;
  }
  function reset(initial = {}, place = null) {
    $('#placeEditorForm').reset(); editingId = place?.id || null; resolved = place?.resolved || null; photos = []; photoIndex = -1;
    renderPhotos(); renderResolved(); renderCurrentPhoto(place?.photo || '');
    $('#newPlaceType').innerHTML = placeTypeOptionsHtml(); $('#newPlaceType').value = place?.type || initial.type || getDefaultType() || 'spot';
    $('#newPlaceName').value = place?.name || initial.name || ''; $('#newPlaceAddress').value = place?.address || initial.address || ''; $('#newPlaceNote').value = place?.note || initial.note || '';
    const details = place?.poiDetails || {};
    detailIds.forEach((id, index) => { $(`#${id}`).value = details[['intro', 'openTime', 'rating', 'referenceCost', 'ticketPrice', 'tags'][index]] || ''; });
    $('#placeEditorDelete').hidden = !place; refreshLabels();
  }
  function confirmNewPlace(initial = {}) {
    const cached = findMatchingLocation(state.universalLocations, initial.address, initial.name);
    if (cached) return Promise.resolve(importUniversalPlace(cached));
    reset(initial); $('#newPlaceAmapStatus').textContent = '填写名称和完整地址后可分别查询；保存不会自动调用高德。';
    dialog.querySelector('h3').textContent = initial.fromEvent ? '确认新增并关联地点' : '新增地点'; dialog.showModal();
    requestAnimationFrame(() => $('#newPlaceName').focus());
    if (initial.name && initial.address) requestAnimationFrame(() => { queryLocation(); queryPhotos(); });
    return new Promise(resolveConfirmation => { pendingConfirmation = resolveConfirmation; });
  }
  function openPlaceEditor(placeId) {
    const place = state.locations.find(item => item.id === placeId); if (!place) return;
    reset({}, place); refreshLabels();
    $('#newPlaceAmapStatus').textContent = place.resolved ? `已定位：${place.resolved.name || place.name}。可重新查询位置、图片或 POI 详情；保存不会重复查询。` : '填写名称和完整地址后可分别查询；保存不会自动调用高德。';
    dialog.querySelector('h3').textContent = '编辑地点'; dialog.showModal(); requestAnimationFrame(() => $('#newPlaceName').focus());
  }
  function cancel() { dialog.close(); editingId = null; $('#placeEditorDelete').hidden = true; pendingConfirmation?.(null); pendingConfirmation = null; }
  async function queryLocation() {
    const name = $('#newPlaceName').value.trim(), address = $('#newPlaceAddress').value.trim(); if (!name || !address) { alert('请先填写地点名称和完整地址。'); return; }
    const button = $('#queryNewPlaceLocation'); button.disabled = true; button.textContent = '查询中…'; $('#newPlaceAmapStatus').textContent = '正在查询高德位置…';
    try { const point = await geocode(address, name); resolved = { name: point.name || name, address: point.formatted_address || address, location: point.location }; $('#newPlaceAddress').value = resolved.address; renderResolved(); $('#newPlaceAmapStatus').textContent = `已定位并回填高德完整地址。${photos.length ? '已保留图片候选。' : ''}`; }
    catch (error) { resolved = null; renderResolved(); $('#newPlaceAmapStatus').textContent = error.message || '高德位置查询失败，请检查名称和地址。'; }
    finally { button.disabled = false; refreshLabels(); }
  }
  async function queryPhotos() {
    const name = $('#newPlaceName').value.trim(), address = $('#newPlaceAddress').value.trim(); if (!name || !address) { alert('请先填写地点名称和完整地址。'); return; }
    const button = $('#queryNewPlacePhotos'); button.disabled = true; button.textContent = '查询中…'; $('#newPlaceAmapStatus').textContent = '正在查询高德图片…';
    try { const data = await api.getPlacePhotos({ name, address }); photos = data.photos || []; photoIndex = -1; renderPhotos(); const source = data.cached ? '本地缓存' : '本次高德查询'; $('#newPlaceAmapStatus').textContent = photos.length ? `找到 ${photos.length} 张高德候选图（${source}），请选择一张。` : `高德暂未返回可用图片（${source}）。`; }
    catch (error) { photos = []; photoIndex = -1; renderPhotos(); $('#newPlaceAmapStatus').textContent = error.message || '高德图片查询失败，请检查名称和地址。'; }
    finally { button.disabled = false; refreshLabels(); }
  }
  async function queryDetails(event) {
    const name = $('#newPlaceName').value.trim(), address = $('#newPlaceAddress').value.trim(); if (!name || !address) { alert('请先填写地点名称和完整地址。'); return; }
    const button = event.currentTarget; button.disabled = true; button.textContent = '查询中…'; $('#newPlaceAmapStatus').textContent = '正在获取高德 POI 详情…';
    try { const data = await api.getPlaceDetails({ name, address }), detail = data.poi || {}; detailIds.forEach((id, index) => { $(`#${id}`).value = detail[['intro', 'openTime', 'rating', 'referenceCost', 'ticketPrice', 'tags'][index]] || ''; }); if (detail.location) { resolved = { name: detail.name || name, address: detail.address || address, location: detail.location }; $('#newPlaceAddress').value = resolved.address; renderResolved(); } $('#newPlaceAmapStatus').textContent = `已填入高德 Web 服务实际返回的 POI 详情（${data.cached ? '本地缓存' : '本次高德查询'}）；空字段表示该接口未提供。`; }
    catch (error) { $('#newPlaceAmapStatus').textContent = error.message || '高德 POI 详情查询失败。'; }
    finally { button.disabled = false; refreshLabels(); }
  }
  async function submit(event) {
    event.preventDefault(); const name = $('#newPlaceName').value.trim(); if (!name) { $('#newPlaceName').focus(); return; }
    const photoFile = $('#newPlacePhoto').files[0], address = $('#newPlaceAddress').value.trim(), selectedPhoto = photos[photoIndex];
    const keys = ['intro', 'openTime', 'rating', 'referenceCost', 'ticketPrice', 'tags']; const poiDetails = Object.fromEntries(keys.map((key, index) => [key, $(`#${detailIds[index]}`).value.trim()]));
    const draft = { type: $('#newPlaceType').value, name, address, note: $('#newPlaceNote').value.trim(), poiDetails, ...(photoFile ? { photo: await fileToDataUrl(photoFile) } : selectedPhoto ? { photo: selectedPhoto.url, photoSource: `高德 POI · ${selectedPhoto.poiName || name}` } : {}) };
    const button = event.submitter; if (button) { button.disabled = true; button.textContent = '正在保存…'; }
    let place = editingId ? state.locations.find(item => item.id === editingId) : findMatchingLocation(state.locations, draft.address, draft.name); const addressChanged = Boolean(place && normalizePlaceLookup(place.address) !== normalizePlaceLookup(draft.address));
    if (!place) place = { id: crypto.randomUUID(), ...draft }; else Object.assign(place, draft);
    if (resolved?.location) place.resolved = resolved; else if (addressChanged) delete place.resolved;
    if (!state.locations.some(item => item.id === place.id)) state.locations.push(place);
    save(); renderLocations(); dialog.close(); editingId = null; $('#placeEditorDelete').hidden = true;
    if (button) { button.disabled = false; button.textContent = '保存地点'; } pendingConfirmation?.(place); pendingConfirmation = null;
  }
  $('#placeEditorCancel').onclick = cancel; dialog.oncancel = event => { event.preventDefault(); cancel(); };
  $('#placeEditorDelete').onclick = () => { const place = state.locations.find(item => item.id === editingId); if (!place || !confirm(`确定删除地点“${place.name || '未命名地点'}”吗？相关行程和路线关联会解除。`)) return; const id = place.id; cancel(); removeLocations(new Set([id])); };
  $('#queryNewPlaceLocation').onclick = queryLocation; $('#queryNewPlacePhotos').onclick = queryPhotos; $('#queryNewPlaceDetails').onclick = queryDetails; $('#placeEditorForm').onsubmit = submit;
  return { confirmNewPlace, openPlaceEditor };
}
