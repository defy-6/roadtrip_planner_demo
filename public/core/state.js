export function createStore(initialState = {}) {
  let state = structuredClone(initialState);
  const listeners = new Set();
  return {
    getState: () => state,
    replace(nextState, meta = {}) {
      const previous = state;
      state = structuredClone(nextState);
      listeners.forEach(listener => listener(state, previous, meta));
    },
    update(updater, meta = {}) {
      const previous = state;
      state = updater(structuredClone(state));
      listeners.forEach(listener => listener(state, previous, meta));
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  };
}

export const initialPlannerState = {
  planner: { activePlanId: 'xinjiang-roadtrip', plans: [], schedule: [], locations: [], routes: [], placeCategories: [], preferences: {} },
  ui: { dayFilter: '', selectedEventIndex: null, selectedScheduleIndexes: [], selectedPlaceIds: [] }
};

// 兼容第一阶段运行时：后续 feature 会逐步改为通过 createStore 的 action 更新。
export function createRuntimePlannerState() {
  return { items: [], dragging: null, schedule: [], locations: [], universalLocations: [], routes: [], placeCategories: [], versionKey: 'xinjiang-roadtrip', plans: [], preferences: { pace: '适中', vehicle: '自驾', buffer: '30' }, dayFilter: '', selectedIndex: null };
}
