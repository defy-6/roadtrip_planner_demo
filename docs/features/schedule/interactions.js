export function shiftScheduleEntries(schedule, indexes, minutes) {
  const toMinutes = value => { const [hour, minute] = String(value || '00:00').split(':').map(Number); return hour * 60 + minute; };
  const format = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  indexes.forEach(index => {
    const entry = schedule[index]; if (!entry) return;
    const start = toMinutes(entry.start), end = toMinutes(entry.end || entry.start), shiftedStart = Math.max(0, Math.min(1435, start + minutes));
    entry.start = format(shiftedStart); entry.end = format(Math.min(1439, shiftedStart + Math.max(0, end - start)));
  });
}

export function snapScheduleDrop(schedule, date, rawMinute, indexes = [], clockToMinute) {
  const excluded = new Set(indexes.map(Number));
  const previousEnds = schedule.filter((entry, index) => entry.date === date && !excluded.has(index) && clockToMinute(entry.end || entry.start) <= rawMinute).map(entry => clockToMinute(entry.end || entry.start));
  const previousEnd = previousEnds.length ? Math.max(...previousEnds) : null;
  return previousEnd !== null && rawMinute - previousEnd <= 45 ? previousEnd : Math.max(7 * 60, Math.min(22 * 60 + 55, Math.round(rawMinute / 5) * 5));
}
