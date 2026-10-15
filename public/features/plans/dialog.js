// 行程方案对话框：新建/复制/删除方案的模态交互。
export function createPlanDialog({
  state, $, planDialog, isShareMode,
  planIdFromName, currentSnapshot, storePlanSnapshot, removePlanSnapshot,
  parseStoredJson, versionStorageKey, load, loadPreset,
  renderPlanSelect, renderSchedule, renderManualSchedule, save
}) {
  let planDialogMode = '';
  let opener = null;
  planDialog.classList.add('compact-form-dialog');
  planDialog.setAttribute('aria-labelledby', 'planDialogTitle');
  planDialog.setAttribute('aria-describedby', 'planDialogHint');
  planDialog.addEventListener('close', () => {
    if (planDialog.ownerDocument.querySelector('dialog[open]')) return;
    const target = opener?.isConnected && !opener.disabled ? opener : $('#planSelect');
    target?.focus({ preventScroll: true });
  });
  $('#planDialogHint', planDialog).setAttribute('role', 'status');
  $('#planDialogHint', planDialog).setAttribute('aria-live', 'polite');
  function openPlanDialog(mode, trigger = null) {
    if (isShareMode) return;
    opener = trigger || planDialog.ownerDocument.activeElement;
    const plan = state.plans.find(item => item.id === state.versionKey);
    planDialogMode = mode;
    const title = $('#planDialogTitle', planDialog), hint = $('#planDialogHint', planDialog), field = $('#planNameField', planDialog), input = $('#planDialogName', planDialog), submit = $('#planDialogSubmit', planDialog);
    const isDelete = mode === 'delete';
    planDialog.classList.toggle('is-danger-mode', isDelete);
    submit.classList.toggle('danger', isDelete);
    title.textContent = isDelete ? '确认删除行程方案' : mode === 'copy' ? '复制行程方案' : '新建行程方案';
    hint.textContent = isDelete ? `此操作不可恢复。请输入“${plan?.name || ''}”以确认删除。` : mode === 'copy' ? '将完整复制当前行程方案的时间表、地点与路线。' : '新方案创建后可单独编辑，不会影响当前行程方案。';
    field.firstChild.textContent = isDelete ? '确认方案名称' : '行程方案名称';
    input.value = isDelete ? '' : mode === 'copy' ? `${plan?.name || '未命名方案'} 副本` : '新建行程方案';
    input.placeholder = isDelete ? plan?.name || '' : '请输入行程方案名称'; submit.textContent = isDelete ? '确认删除' : mode === 'copy' ? '复制方案' : '创建方案';
    planDialog.showModal(); input.focus(); input.select();
  }
  $('#planDialogCancel', planDialog).onclick = () => planDialog.close();
  $('#planForm', planDialog).onsubmit = event => {
    event.preventDefault(); const name = $('#planDialogName', planDialog).value.trim(); const current = state.plans.find(item => item.id === state.versionKey);
    if (!name) return;
    if (planDialogMode === 'delete') {
      if (!current || name !== current.name) { $('#planDialogHint', planDialog).textContent = '行程方案名称不匹配，请重新输入。'; return; }
      removePlanSnapshot(current.id); state.plans = state.plans.filter(item => item.id !== current.id); state.versionKey = state.plans[0].id;
      renderPlanSelect(); const next = parseStoredJson(versionStorageKey(state.versionKey), null);
      if (next) { load(next, state.versionKey); renderSchedule(state.schedule); } else loadPreset(state.versionKey);
    } else {
      const id = planIdFromName(name);
      const snapshot = planDialogMode === 'copy'
        ? { ...structuredClone(currentSnapshot()), name, planKey: id, updatedAt: new Date().toISOString() }
        : { name, items: [], schedule: [], locations: [], routes: [], placeCategories: [], preferences: structuredClone(state.preferences), placeModelVersion: 1, placeCategoryVersion: 2, routeLinkModeVersion: 1, planKey: id };
      state.plans.push({ id, name }); state.versionKey = id; storePlanSnapshot(id, snapshot); renderPlanSelect(); load(snapshot, id);
      snapshot.schedule.length ? renderSchedule(state.schedule) : renderManualSchedule();
    }
    planDialog.close(); save();
  };
  const openFromButton = (mode, button) => {
    const active = planDialog.ownerDocument.activeElement;
    const mobileTrigger = active?.dataset?.command === `#${button.id}` ? active : button;
    openPlanDialog(mode, mobileTrigger);
  };
  $('#newPlanBtn').onclick = event => openFromButton('new', event.currentTarget);
  $('#copyPlanBtn').onclick = event => openFromButton('copy', event.currentTarget);
  $('#deletePlanBtn').onclick = event => { if (state.plans.length > 1) openFromButton('delete', event.currentTarget); };
  return { openPlanDialog };
}
