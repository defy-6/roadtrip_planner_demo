import { DRIVE_TRAVEL_MODES, TRANSPORT_MODES } from '../../core/constants.js';
import { createRouteOverlapTools } from '../map/geometry.js';
import { createRouteModel } from '../routes/model.js';

const routeVisualOverlapPolicy = Object.freeze({
  proximityMeters: 400,
  minCorridorMeters: 20_000,
  minShorterRouteRatio: .18
});

export function createRuntimeRoutes({ state, isShareMode, normalizeLookup }) {
  const model = createRouteModel({
    state,
    transportModes: TRANSPORT_MODES,
    driveTravelModes: DRIVE_TRAVEL_MODES,
    normalizeLookup
  });
  const { routesShareVisualCorridor } = createRouteOverlapTools(routeVisualOverlapPolicy);
  return {
    normalizedTransportMode: model.normalizedTransportMode,
    transportModeMeta: model.transportModeMeta,
    normalizedTravelMode: model.normalizedTravelMode,
    driveTravelMeta: model.driveTravelMeta,
    routeSignature: model.signature,
    routeForScheduleEvent: model.forScheduleEvent,
    upsertUniversalRoute: model.upsert,
    mergeUniversalRoutes: data => model.merge(data, isShareMode),
    routesShareVisualCorridor
  };
}

export { routeVisualOverlapPolicy };
