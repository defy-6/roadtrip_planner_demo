export function normalizedPriceItems(info = {}) {
  if (info.perPersonItems || info.sharedItems) return { perPersonItems: info.perPersonItems || [], sharedItems: info.sharedItems || [] };
  const perPersonItems = info.ticketPrice ? [{ amount: info.ticketPrice, people: info.people || 1, note: '门票' }] : [];
  const sharedItems = info.vehicleFee ? [{ amount: info.vehicleFee, note: '整车费用' }] : (info.total ? [{ amount: info.total, note: info.note || '' }] : []);
  return { perPersonItems, sharedItems };
}

export function calculatePriceInfo(perPersonItems = [], sharedItems = []) {
  const total = perPersonItems.reduce((sum, item) => sum + Number(item.amount || 0) * Math.max(1, Number(item.people || 1)), 0)
    + sharedItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  return total || perPersonItems.length || sharedItems.length ? { perPersonItems, sharedItems, total } : undefined;
}
