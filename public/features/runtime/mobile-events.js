export function bindRuntimeMobileEvents({
  eventTarget = window,
  plannerReady,
  $,
  api,
  persistence,
  save,
  getMap,
  ensureMapReady,
  showDayOverview,
  changeDayFilter,
  renderLocations,
  cycleBaseLayer,
  clearMapSelection,
  fitOverview,
  locate,
  focusScheduleEvent,
  showPlaceOnMap,
  showToast = (message, tone) => window.showSaveToast?.(message, tone),
  requestFrame = callback => requestAnimationFrame(callback)
}) {
  let mapViewTimer = null;

  const handleViewChange = event => {
    const view = event.detail?.view;
    if (view === 'map') {
      clearTimeout(mapViewTimer);
      mapViewTimer = setTimeout(async () => {
        await plannerReady;
        if (!(await ensureMapReady())) return;
        getMap()?.invalidateSize();
        await showDayOverview($('#mapDayFilter').value || '');
      }, 80);
      return;
    }
    if (view === 'places') {
      plannerReady.then(() => requestFrame(renderLocations));
    }
  };

  const handleMapAction = async event => {
    const action = event.detail?.action;
    if (action === 'layers') {
      if (!getMap()) { showToast('地图尚未就绪，请稍后再试'); return; }
      const label = cycleBaseLayer();
      eventTarget.dispatchEvent(new CustomEvent('mobile:maplayerchanged', { detail: { label } }));
      return;
    }
    if (action === 'fit') {
      if (!getMap()) { showToast('地图尚未就绪，请稍后再试'); return; }
      await clearMapSelection();
      fitOverview();
      return;
    }
    if (action === 'locate') locate();
  };

  const handleRouteFocus = event => {
    const index = Number(event.detail?.index);
    if (Number.isInteger(index)) focusScheduleEvent(index, { skipDriveQuery: true });
  };

  const handlePlaceFocus = async event => {
    const placeId = String(event.detail?.placeId || '');
    const date = String(event.detail?.date || '');
    if (!placeId) return;
    if (date && [...$('#dayFilter').options].some(option => option.value === date)) {
      await changeDayFilter(date);
    }
    await showPlaceOnMap(placeId);
  };

  const handleTripRename = event => {
    if (api.getActiveTripId?.() && !persistence.autoSaveEnabled) {
      showToast('读取或待同步修改尚未处理，暂不能修改云端名称', 'warning'); return;
    }
    const name = (event.detail?.name || '').trim();
    if (!name) return;
    $('#tripName').value = name;
    save();
  };

  const handleSave = () => {
    const status = $('#fileSaveStatus');
    const report = (message, tone) => {
      if (status) {
        status.dataset.tone = tone;
        status.textContent = message;
      }
      showToast(message, tone);
    };
    if (!persistence.autoSaveEnabled) {
      // editable 仍为真说明不是只读分享/预览，而是初始化读取失败导致保存被暂停。
      report(
        persistence.editable ? '尚未读取到最新行程数据，暂时无法保存，请先重试读取' : '当前为只读预览，无法保存',
        'warning'
      );
      return;
    }
    try {
      save({ manual: true });
      report('正在保存…', 'info');
    } catch (error) {
      report(`保存失败：${error?.message || error}`, 'error');
    }
  };

  const listeners = [
    ['mobile:viewchange', handleViewChange],
    ['mobile:mapaction', handleMapAction],
    ['mobile:routefocus', handleRouteFocus],
    ['mobile:placefocus', handlePlaceFocus],
    ['mobile:triprename', handleTripRename],
    ['mobile:save', handleSave]
  ];
  listeners.forEach(([type, listener]) => eventTarget.addEventListener(type, listener));

  return {
    destroy() {
      clearTimeout(mapViewTimer);
      listeners.forEach(([type, listener]) => eventTarget.removeEventListener(type, listener));
    }
  };
}
