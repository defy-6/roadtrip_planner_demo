export function createPlansFeature({ state, select, deleteButton, escapeHtml, defaultPlanId }) {
  function normalizePlanContainer(raw = {}) {
    if (Array.isArray(raw.plans) && raw.plans.length) {
      const plans = raw.plans.map(plan => ({ id: plan.id, name: plan.name || '未命名计划' })).filter(plan => plan.id);
      const versions = Object.fromEntries(plans.map(plan => [plan.id, raw.versions?.[plan.id]]).filter(([, snapshot]) => snapshot));
      const activeVersion = versions[raw.activeVersion] ? raw.activeVersion : plans.find(plan => versions[plan.id])?.id;
      return { ...raw, plans, versions, activeVersion, sharedSchedule: {} };
    }
    const legacy = raw.versions?.b || raw.versions?.a || Object.values(raw.versions || {}).find(Boolean) || raw;
    if (!legacy?.schedule && !legacy?.items) return { ...raw, plans: [], versions: {}, sharedSchedule: {} };
    const snapshot = { ...structuredClone(legacy), name: '新疆自驾游', planKey: defaultPlanId };
    return { ...raw, activeVersion: defaultPlanId, plans: [{ id: defaultPlanId, name: '新疆自驾游' }], versions: { [defaultPlanId]: snapshot }, sharedSchedule: {} };
  }

  function renderPlanSelect() {
    const element = select(); if (!element) return;
    element.innerHTML = state.plans.map(plan => `<option value="${escapeHtml(plan.id)}">${escapeHtml(plan.name)}</option>`).join('');
    element.value = state.versionKey;
    const button = deleteButton(); if (button) button.disabled = state.plans.length <= 1;
  }

  function setPlanCatalog(container) {
    const normalized = normalizePlanContainer(container);
    state.plans = normalized.plans || [];
    if (!state.plans.length) state.plans = [{ id: defaultPlanId, name: '新疆自驾游' }];
    state.versionKey = normalized.activeVersion && state.plans.some(plan => plan.id === normalized.activeVersion) ? normalized.activeVersion : state.plans[0].id;
    renderPlanSelect();
    return normalized;
  }

  return { normalizePlanContainer, renderPlanSelect, setPlanCatalog };
}
