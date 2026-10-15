// Read-only projection of existing plan data; no persistence or completion flags.
export function reviewDays(schedule = [], locations = [], expenseEntries = []) {
  const places = new Map(locations.map(place => [place.id, place]));
  const days = new Map();
  schedule.forEach((event, eventIndex) => {
    const date = event.date || '';
    if (!days.has(date)) days.set(date, []);
    const place = places.get(event.locationId);
    days.get(date).push({
      eventIndex,
      start: event.start || '', end: event.end || '',
      title: event.title || '未命名安排',
      note: event.detail || '',
      placeName: place?.name || '',
      placeNote: place?.note || '',
      photo: place?.photo || '',
    });
  });
  const expensesByDate = new Map();
  expenseEntries.forEach(entry => {
    if (!Number.isFinite(entry.amount)) return;
    const date = entry.date || '';
    if (!days.has(date)) days.set(date, []);
    if (!expensesByDate.has(date)) expensesByDate.set(date, []);
    expensesByDate.get(date).push(entry);
  });
  return [...days].sort(([left], [right]) => (left || '9999').localeCompare(right || '9999'))
    .map(([date, events]) => {
      const expenses = expensesByDate.get(date) || [];
      return { date, events: events.sort((left, right) => left.start.localeCompare(right.start)),
        expenses, expenseTotal: expenses.length ? expenses.reduce((total, entry) => total + entry.amount, 0) : null };
    });
}
