export function createRoutingService(api) {
  return ({ origin, destination, strategy }) => api.calculateRoute({ origin, destination, strategy });
}
