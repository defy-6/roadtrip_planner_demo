export function bindRuntimeCommands({
  eventTarget = window,
  documentRef = document,
  urlApi = URL,
  BlobCtor = Blob,
  randomUUID = () => crypto.randomUUID(),
  $,
  state,
  itemsEl,
  values,
  changeDayFilter,
  loadPreset,
  setPlaceTypeFilter,
  renderLocations,
  renderUniversalPlaces,
  universalPlaceDialog,
  addPlaceButton,
  addPlaceCategoryButton,
  placeCategoryEditor,
  openPlaceEditor,
  save,
  persistence,
  confirmAction,
  showToast = () => {},
  updateScheduleWeather,
  openExpenseLedger,
  undo,
  redo
}) {
  const listeners = [];
  const bind = (target, type, listener) => {
    if (!target) return;
    target.addEventListener(type, listener);
    listeners.push([target, type, listener]);
  };

  bind($('#placeTypeFilter'), 'change', event => {
    setPlaceTypeFilter(event.target.value);
    renderLocations();
  });
  let libraryOpener = null;
  bind($('#placeLibraryBtn'), 'click', event => {
    const active = documentRef.activeElement;
    libraryOpener = active?.dataset?.placeAction === 'universal' ? active : event.currentTarget;
    renderUniversalPlaces();
    universalPlaceDialog.showModal();
  });
  bind(universalPlaceDialog, 'close', () => {
    const active = documentRef.activeElement;
    if (active !== documentRef.body && active !== libraryOpener && !universalPlaceDialog.contains(active)) return;
    if (!documentRef.querySelector('dialog[open]') && libraryOpener?.isConnected) libraryOpener.focus({ preventScroll: true });
  });
  bind($('#closeUniversalPlaceDialog'), 'click', () => universalPlaceDialog.close());
  bind(documentRef.querySelector('#exportBtn'), 'click', () => {
    // 这是"当前方案"的方案级 JSON 导出，不是完整旅行备份：
    // 不含其它方案、账本费用与通用地点库，因此显式自述范围，避免被当成完整备份使用。
    const payload = {
      exportScope: 'plan',
      exportedAt: new Date().toISOString(),
      note: '仅当前方案 JSON（不含其它方案、费用与通用地点库），不是完整旅行备份；完整备份请在账号面板中创建。',
      planKey: state.versionKey || 'current',
      name: $('#tripName').value,
      items: [...itemsEl.children].map(values),
      schedule: state.schedule,
      locations: state.locations,
      routes: state.routes,
      preferences: state.preferences,
      placeModelVersion: 1,
      routeLinkModeVersion: 1
    };
    const blob = new BlobCtor([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const anchor = Object.assign(documentRef.createElement('a'), { href: urlApi.createObjectURL(blob), download: 'roadtrip-plan.json' });
    anchor.click();
    urlApi.revokeObjectURL(anchor.href);
  });
  bind($('#mapDayFilter'), 'change', event => changeDayFilter(event.target.value));
  bind($('#planSelect'), 'change', event => loadPreset(event.target.value));
  bind(addPlaceButton, 'click', () => openPlaceEditor(null, () => addPlaceButton));
  bind(addPlaceCategoryButton, 'click', () => {
    placeCategoryEditor.showModal();
    $('#newPlaceCategoryName').focus();
  });
  bind(placeCategoryEditor, 'close', () => {
    if (!documentRef.querySelector('dialog[open]') && addPlaceCategoryButton?.isConnected) {
      addPlaceCategoryButton.focus({ preventScroll: true });
    }
  });
  bind($('#placeCategoryEditorForm'), 'submit', event => {
    event.preventDefault();
    const name = $('#newPlaceCategoryName').value.trim();
    const color = $('#newPlaceCategoryColor').value;
    if (!name) return;
    state.placeCategories ||= [];
    if (!state.placeCategories.some(category => category.name === name)) {
      state.placeCategories.push({ id: randomUUID(), name, color });
    }
    save();
    renderLocations();
    placeCategoryEditor.close();
  });
  bind($('#placeCategoryEditorCancel'), 'click', () => placeCategoryEditor.close());
  bind($('#updateScheduleWeather'), 'click', event => updateScheduleWeather(event.currentTarget));
  bind(eventTarget, 'mobile:accountingopen', openExpenseLedger);
  bind($('#undoBtn'), 'click', undo);
  bind($('#redoBtn'), 'click', redo);
  bind(eventTarget, 'planner:pendingexport', async () => {
    if (!persistence?.editable) return;
    const pending = await persistence.readPendingChanges();
    if (!pending) { showToast('没有待同步修改'); return; }
    const backup = { kind: 'roadtrip-pending-changes', formatVersion: 1, data: pending };
    const anchor = Object.assign(documentRef.createElement('a'), {
      href: urlApi.createObjectURL(new BlobCtor([JSON.stringify(backup, null, 2)], { type: 'application/json' })),
      download: 'pending-trip-backup.json'
    });
    // Safari may begin resolving the blob after click() returns. Keep both the
    // URL and attached anchor alive until the download has started.
    documentRef.body?.append(anchor);
    anchor.click();
    setTimeout(() => { urlApi.revokeObjectURL(anchor.href); anchor.remove?.(); }, 1000);
  });
  bind(eventTarget, 'planner:pendingdiscard', async () => {
    if (!persistence?.editable || !confirmAction) return;
    const pending = await persistence.readPendingChanges();
    if (!pending) return;
    const approved = await confirmAction({ title: '放弃待同步修改？',
      message: '只清除本地待同步队列，不改动云端。未备份的本地修改将无法恢复。',
      detail: '建议先取消并导出待同步备份；确认后重新读取云端，页内其他修改仍会单独确认。',
      confirmLabel: '放弃队列并读取云端' });
    if (!approved) return;
    if (!(await persistence.discardPendingChanges(pending))) {
      showToast('队列已变化或清除失败，修改仍保留，请重新核对', 'warning'); return;
    }
    eventTarget.dispatchEvent(new CustomEvent('planner:retry'));
  });

  return {
    destroy() {
      listeners.forEach(([target, type, listener]) => target.removeEventListener(type, listener));
    }
  };
}
