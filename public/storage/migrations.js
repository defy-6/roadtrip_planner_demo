export function createPlannerMigrations({ typeForTitle, createId, readFlag, writeFlag, pendingAddressMigrationKey }) {
  const migrateToUnifiedItems = data => {
    if (!data.schedule?.length || data.items?.length >= data.schedule.length) return data;
    const legacy = [...(data.items || [])], schedule = structuredClone(data.schedule);
    schedule.forEach(entry => {
      const matchIndex = legacy.findIndex(item => item.date === entry.date && (entry.title.includes(item.name) || item.name.includes(entry.title)));
      if (matchIndex >= 0) { const item = legacy.splice(matchIndex, 1)[0]; Object.assign(entry, { address: item.address, type: item.type, photo: item.photo || '', routeLinks: entry.routeLinks }); }
      else entry.type ||= typeForTitle(entry.title);
    });
    legacy.forEach(item => schedule.push({ date: item.date, start: item.startTime || '', end: item.endTime || '', title: item.name, detail: item.note || '', address: item.address, type: item.type, photo: item.photo || '' }));
    schedule.sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
    return { ...data, schedule, items: schedule.map((entry, scheduleIndex) => ({ type: entry.type || typeForTitle(entry.title), date: entry.date, startTime: entry.start, endTime: entry.end, name: entry.title, address: entry.address || '', note: entry.detail || '', photo: entry.photo || '', scheduleIndex })) };
  };
  const migrateLegacyLocations = data => {
    if (data.locations) return data;
    const locations = [], schedule = (data.schedule || []).filter(entry => {
      if (entry.type === 'hotel' && /住宿|酒店|民宿|客栈/.test(entry.title || '')) { locations.push({ id: createId(), type: 'hotel', name: entry.title, address: '', note: entry.detail || '' }); return false; }
      return true;
    });
    return { ...data, schedule, locations, items: schedule.map((entry, scheduleIndex) => ({ type: entry.type || typeForTitle(entry.title), date: entry.date, startTime: entry.start, endTime: entry.end, name: entry.title, address: entry.address || '', note: entry.detail || '', photo: entry.photo || '', scheduleIndex })) };
  };
  const migrateToPlaceModel = data => {
    if (data.placeModelVersion === 1) return data;
    const locations = [...(data.locations || [])];
    const placeFor = entry => {
      let place = locations.find(item => item.address && item.address === entry.address);
      if (!place) { place = { id: createId(), type: entry.type === 'food' ? 'food' : entry.type === 'hotel' ? 'hotel' : 'spot', name: entry.title, address: entry.address, note: entry.detail || '' }; locations.push(place); }
      return place;
    };
    const schedule = (data.schedule || []).map(entry => entry.address && entry.type !== 'drive' ? { ...entry, locationId: placeFor(entry).id, address: '' } : entry);
    return { ...data, schedule, locations, placeModelVersion: 1, items: schedule.map((entry, scheduleIndex) => ({ type: entry.type || typeForTitle(entry.title), date: entry.date, startTime: entry.start, endTime: entry.end, name: entry.title, address: '', note: entry.detail || '', photo: entry.photo || '', scheduleIndex })) };
  };
  const migrateExplicitRouteLinks = data => {
    if (data.routeLinkModeVersion === 1) return data;
    const schedule = (data.schedule || []).map(entry => entry.type === 'drive' ? { ...entry, routeLinks: {} } : entry);
    return { ...data, schedule, routeLinkModeVersion: 1, items: schedule.map((entry, scheduleIndex) => ({ type: entry.type || typeForTitle(entry.title), date: entry.date, startTime: entry.start, endTime: entry.end, name: entry.title, address: entry.address || '', note: entry.detail || '', photo: entry.photo || '', scheduleIndex })) };
  };
  const migrateFlightStopovers = data => {
    (data.schedule || []).forEach(event => {
      if (event.type !== 'flight' || !event.flightInfo || event.flightInfo.stopoverAirport) return;
      const match = String(event.detail || '').match(/经停\s*([^，,；;]+?机场)[，,；;\s]+(\d{1,2}:\d{2})\s*[–—~-]\s*(\d{1,2}:\d{2})/);
      if (match) Object.assign(event.flightInfo, { stopoverAirport: match[1].trim(), stopoverArrivalTime: match[2], stopoverDepartureTime: match[3] });
    });
    return data;
  };
  const clearInitialPendingAddresses = data => {
    if (readFlag(pendingAddressMigrationKey)) return data;
    writeFlag(pendingAddressMigrationKey);
    const clear = entry => ['hotel', 'food'].includes(entry.type) ? { ...entry, address: '' } : entry;
    return { ...data, items: (data.items || []).map(clear), schedule: (data.schedule || []).map(clear) };
  };
  return [migrateToUnifiedItems, migrateLegacyLocations, migrateToPlaceModel, migrateExplicitRouteLinks, migrateFlightStopovers, clearInitialPendingAddresses];
}

export function migratePlannerData(rawData, migrations = []) {
  return migrations.reduce((data, migrate) => migrate(data), structuredClone(rawData || {}));
}
