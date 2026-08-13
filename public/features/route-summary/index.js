export const fmtDuration = seconds => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round(seconds % 3600 / 60);
  return hours ? `${hours}小时${minutes}分` : `${minutes}分钟`;
};

export function calculateRouteTotals(schedule, routeForScheduleEvent, dayFilter = '') {
  const events = schedule.filter(event => event.type === 'drive' && (!dayFilter || event.date === dayFilter));
  const days = new Map();
  let pending = 0;
  events.forEach(event => {
    const route = routeForScheduleEvent(event);
    if (!route?.amap) { pending += 1; return; }
    const day = days.get(event.date) || { distance: 0, duration: 0, tolls: 0, count: 0 };
    day.distance += Number(route.amap.distance || 0);
    day.duration += Number(route.amap.duration || 0);
    day.tolls += Number(route.amap.tolls || 0);
    day.count += 1;
    days.set(event.date, day);
  });
  const total = [...days.values()].reduce((sum, day) => ({ distance: sum.distance + day.distance, duration: sum.duration + day.duration, tolls: sum.tolls + day.tolls, count: sum.count + day.count }), { distance: 0, duration: 0, tolls: 0, count: 0 });
  return { days, total, pending, eventCount: events.length };
}
