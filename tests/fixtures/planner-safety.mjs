// Synthetic only: no production itinerary or account data.
export const plannerSafetyFixture = {
  activeVersion: 'dated', plans: [{ id: 'dated', name: '合成行程方案' }],
  versions: { dated: { name: '合成行程', planKey: 'dated', items: [],
    schedule: [{ date: '2026-11-02', start: '12:00', end: '13:00', type: 'food', title: '合成午餐' }],
    locations: [], routes: [], expenses: [], placeCategories: [], preferences: {} } },
  locations: [], routes: [], sharedSchedule: {}
};
