export function flightPlaces(entry, locations) {
  const info = entry?.flightInfo || {};
  return [info.departurePlaceId, info.stopoverPlaceId, info.arrivalPlaceId].map(id => locations.find(place => place.id === id)).filter(Boolean);
}

export function parseFlightStopover(detail = '') {
  const match = String(detail).match(/经停\s*([^，,；;]+?机场)[，,；;\s]+(\d{1,2}:\d{2})\s*[–—~-]\s*(\d{1,2}:\d{2})/);
  return match ? { stopoverAirport: match[1].trim(), stopoverArrivalTime: match[2], stopoverDepartureTime: match[3] } : null;
}
