export function createRouteModel({ state, transportModes, driveTravelModes, normalizeLookup }) {
  const normalizedTransportMode = mode => transportModes[mode] ? mode : 'driving';
  const normalizedTravelMode = mode => driveTravelModes[mode] ? mode : 'recommended';
  const transportModeMeta = mode => transportModes[normalizedTransportMode(mode)];
  const driveTravelMeta = mode => driveTravelModes[normalizedTravelMode(mode)];
  const signature = route => [route?.originPlaceId || '', ...(route?.viaPlaceIds || []), route?.destinationPlaceId || '', normalizedTransportMode(route?.transportMode), normalizedTravelMode(route?.travelMode)].join('>');
  function endpointMatches(placeId, customPlace, routePlaceId) {
    if (placeId) return placeId === routePlaceId;
    if (!customPlace || !routePlaceId) return false;
    const routePlace = state.locations.find(place => place.id === routePlaceId); if (!routePlace) return false;
    const customKeys = [customPlace.name, customPlace.address].map(normalizeLookup).filter(Boolean);
    const routeKeys = [routePlace.name, routePlace.address, routePlace.resolved?.name, routePlace.resolved?.address].map(normalizeLookup).filter(Boolean);
    return customKeys.some(customKey => routeKeys.some(routeKey => customKey === routeKey || (customKey.length >= 3 && (customKey.includes(routeKey) || routeKey.includes(customKey)))));
  }
  function forScheduleEvent(event) {
    const links = event?.routeLinks || {}, direct = state.routes.find(route => route.id === links.routeId);
    if (links.routeId) return direct || null;
    const eventName = normalizeLookup(event?.title);
    return state.routes.find(route => {
      const routeName = normalizeLookup(route.name);
      return eventName && routeName && (eventName === routeName || eventName.includes(routeName) || routeName.includes(eventName))
        && normalizedTransportMode(route.transportMode) === normalizedTransportMode(links.transportMode)
        && normalizedTravelMode(route.travelMode) === normalizedTravelMode(links.travelMode)
        && endpointMatches(links.originPlaceId, links.customOrigin, route.originPlaceId)
        && endpointMatches(links.destinationPlaceId, links.customDestination, route.destinationPlaceId);
    });
  }
  function upsert(name, links) {
    let route = state.routes.find(item => signature(item) === signature(links));
    if (!route) { route = { id: crypto.randomUUID(), name: name || '未命名路线', originPlaceId: links.originPlaceId, destinationPlaceId: links.destinationPlaceId, viaPlaceIds: [...(links.viaPlaceIds || [])], transportMode: normalizedTransportMode(links.transportMode), travelMode: normalizedTravelMode(links.travelMode), transit: links.transit }; state.routes.push(route); }
    else if (name && (!route.name || route.name === '未命名路线')) route.name = name;
    return route;
  }
  function merge(data, readOnly = false) {
    if (readOnly) return data;
    const merged = [];
    const timestamp = result => Date.parse(result?.queriedAt || result?.updatedAt || 0) || 0;
    (data.routes || []).forEach(route => {
      const existing = merged.find(item => item.id === route.id || signature(item) === signature(route));
      if (!existing) { merged.push({ ...route, viaPlaceIds: [...(route.viaPlaceIds || [])] }); return; }
      const newer = timestamp(route.amap) >= timestamp(existing.amap) ? route.amap : existing.amap, older = newer === route.amap ? existing.amap : route.amap;
      const amap = newer ? { ...newer, ...(!newer.steps?.length && older?.steps?.length ? { steps: older.steps } : {}) } : undefined;
      Object.assign(existing, route, { viaPlaceIds: [...(route.viaPlaceIds || [])], ...(amap ? { amap: { ...amap } } : {}) });
    });
    return { ...data, routes: merged };
  }
  return { normalizedTransportMode, normalizedTravelMode, transportModeMeta, driveTravelMeta, signature, forScheduleEvent, upsert, merge };
}
