// 计划对话框：新建/复制/删除计划的模态交互。
export function createPlanDialog({
  state, $, planDialog, isShareMode,
  planIdFromName, currentSnapshot, storePlanSnapshot, removePlanSnapshot,
  parseStoredJson, versionStorageKey, load, loadPreset,
  renderPlanSelect, renderSchedule, renderManualSchedule, save
}) {
  let planDialogMode = '';
  function openPlanDialog(mode) {
    if (isShareMode) return;
    const plan = state.plans.find(item => item.id === state.versionKey);
    planDialogMode = mode;
    const title = $('#planDialogTitle', planDialog), hint = $('#planDialogHint', planDialog), field = $('#planNameField', planDialog), input = $('#planDialogName', planDialog), submit = $('#planDialogSubmit', planDialog);
    const isDelete = mode === 'delete';
    title.textContent = isDelete ? '确认删除计划' : mode === 'copy' ? '复制计划' : '新建计划';
    hint.textContent = isDelete ? `此操作不可恢复。请输入“${plan?.name || ''}”以确认删除。` : mode === 'copy' ? '将完整复制当前计划的时间表、地点与路线。' : '新计划创建后可单独编辑，不会影响当前计划。';
    field.firstChild.textContent = isDelete ? '确认计划名称' : '计划名称';
    input.value = isDelete ? '' : mode === 'copy' ? `${plan?.name || '未命名计划'} 副本` : '新建计划';
    input.placeholder = isDelete ? plan?.name || '' : '请输入计划名称'; submit.textContent = isDelete ? '确认删除' : mode === 'copy' ? '复制计划' : '创建计划';
    planDialog.showModal(); input.focus(); input.select();
  }
  $('#planDialogCancel', planDialog).onclick = () => planDialog.close();
  $('#planForm', planDialog).onsubmit = event => {
    event.preventDefault(); const name = $('#planDialogName', planDialog).value.trim(); const current = state.plans.find(item => item.id === state.versionKey);
    if (!name) return;
    if (planDialogMode === 'delete') {
      if (!current || name !== current.name) { $('#planDialogHint', planDialog).textContent = '计划名称不匹配，请重新输入。'; return; }
      removePlanSnapshot(current.id); state.plans = state.plans.filter(item => item.id !== current.id); state.versionKey = state.plans[0].id;
      renderPlanSelect(); const next = parseStoredJson(versionStorageKey(state.versionKey), null);
      if (next) { load(next, state.versionKey); renderSchedule(state.schedule); } else loadPreset(state.versionKey);
    } else {
      const id = planIdFromName(name);
      const snapshot = planDialogMode === 'copy'
        ? { ...structuredClone(currentSnapshot()), name, planKey: id, updatedAt: new Date().toISOString() }
        : { name, items: [], schedule: [], locations: [], routes: [], placeCategories: [], preferences: structuredClone(state.preferences), placeModelVersion: 1, routeLinkModeVersion: 1, planKey: id };
      state.plans.push({ id, name }); state.versionKey = id; storePlanSnapshot(id, snapshot); renderPlanSelect(); load(snapshot, id);
      snapshot.schedule.length ? renderSchedule(state.schedule) : renderManualSchedule();
    }
    planDialog.close(); save();
  };
  $('#newPlanBtn').onclick = () => openPlanDialog('new');
  $('#copyPlanBtn').onclick = () => openPlanDialog('copy');
  $('#deletePlanBtn').onclick = () => { if (state.plans.length > 1) openPlanDialog('delete'); };
  return { openPlanDialog };
}
