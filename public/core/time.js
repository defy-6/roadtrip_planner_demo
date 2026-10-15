export const DEFAULT_TRIP_TIME_ZONE = 'Asia/Shanghai';

const formatterCache = new Map();

function formatter(timeZone) {
  if (!formatterCache.has(timeZone)) formatterCache.set(timeZone, new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23'
  }));
  return formatterCache.get(timeZone);
}

export function zonedClock(date = new Date(), timeZone = DEFAULT_TRIP_TIME_ZONE) {
  try {
    const parts = Object.fromEntries(formatter(timeZone).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    return { iso: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute), timeZone };
  } catch {
    const fallback = new Date(date.getTime() + 8 * 3600 * 1000);
    return {
      iso: `${fallback.getUTCFullYear()}-${String(fallback.getUTCMonth() + 1).padStart(2, '0')}-${String(fallback.getUTCDate()).padStart(2, '0')}`,
      hour: fallback.getUTCHours(), minute: fallback.getUTCMinutes(), timeZone: DEFAULT_TRIP_TIME_ZONE
    };
  }
}

export function zonedToday(timeZone = DEFAULT_TRIP_TIME_ZONE, date = new Date()) {
  return zonedClock(date, timeZone).iso;
}

export function clockToMinutes(value, fallback = NaN) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return fallback;
  const hour = Number(match[1]), minute = Number(match[2]);
  return hour >= 0 && hour <= 24 && minute >= 0 && minute < 60 && !(hour === 24 && minute) ? hour * 60 + minute : fallback;
}

export function transportArrivalDate(event) {
  return event?.transportInfo?.arrivalDate || event?.flightInfo?.arrivalDate || event?.date || '';
}

function nextIsoDate(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function expandScheduleSegments(events = []) {
  return events.flatMap((event, index) => {
    let arrivalDate = transportArrivalDate(event);
    if (arrivalDate === event?.date && clockToMinutes(event.end) < clockToMinutes(event.start)) arrivalDate = nextIsoDate(event.date);
    if (!event?.date || !arrivalDate || arrivalDate <= event.date) return [{ ...event, index, displayDate: event.date, segmentStart: event.start, segmentEnd: event.end, segmentKind: 'single' }];
    const segments = [{ ...event, index, displayDate: event.date, segmentStart: event.start, segmentEnd: '24:00', segmentKind: 'departure' }];
    let date = nextIsoDate(event.date);
    while (date < arrivalDate) { segments.push({ ...event, index, displayDate: date, segmentStart: '00:00', segmentEnd: '24:00', segmentKind: 'continuation' }); date = nextIsoDate(date); }
    segments.push({ ...event, index, displayDate: arrivalDate, segmentStart: '00:00', segmentEnd: event.end, segmentKind: 'arrival' });
    return segments;
  });
}
