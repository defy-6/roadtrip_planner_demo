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

const eventExpenseCategory = event => ({
  food: '餐饮', hotel: '住宿', drive: '交通', route: '交通', transport: '交通', spot: '门票', supply: '补给'
}[event?.type] || '行程');

const expenseClockMinute = value => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : 24 * 60 + 1;
};

export function compareExpenseChronology(left, right) {
  return String(left.date || '9999-12-31').localeCompare(String(right.date || '9999-12-31'))
    || expenseClockMinute(left.start || left.time) - expenseClockMinute(right.start || right.time)
    || Number(left.eventIndex ?? Number.MAX_SAFE_INTEGER) - Number(right.eventIndex ?? Number.MAX_SAFE_INTEGER)
    || Number(left.itemOrder ?? Number.MAX_SAFE_INTEGER) - Number(right.itemOrder ?? Number.MAX_SAFE_INTEGER);
}

export function createExpenseExportEntries({ schedule = [], expenses = [] } = {}) {
  const eventItems = schedule.flatMap((event, eventIndex) => {
    const items = normalizedPriceItems(event.priceInfo);
    const common = { date: event.date, start: event.start, category: eventExpenseCategory(event), event: event.title || '未命名安排', source: 'event', eventIndex };
    return [
      ...items.perPersonItems.map((item, itemIndex) => {
        const unitPrice = Number(item.amount || 0), people = Math.max(1, Number(item.people || 1));
        return { ...common, id: `event-${eventIndex}-person-${itemIndex}`, itemOrder: itemIndex, item: item.note || '单人费用', pricingMode: '单人费用', unitPrice, people, amount: unitPrice * people };
      }),
      ...items.sharedItems.map((item, itemIndex) => {
        const amount = Number(item.amount || 0);
        return { ...common, id: `event-${eventIndex}-shared-${itemIndex}`, itemOrder: items.perPersonItems.length + itemIndex, item: item.note || '共同费用', pricingMode: '共同费用', unitPrice: amount, people: '', amount };
      })
    ].filter(item => item.amount || item.item);
  });
  const independentItems = expenses.map((expense, expenseIndex) => ({
    ...expense, event: '', item: expense.note || '未命名支出', pricingMode: '独立账目', unitPrice: Number(expense.amount || 0),
    people: '', amount: Number(expense.amount || 0), source: 'expense', eventIndex: Number.MAX_SAFE_INTEGER, itemOrder: expenseIndex
  }));
  return [...eventItems, ...independentItems].sort(compareExpenseChronology);
}
