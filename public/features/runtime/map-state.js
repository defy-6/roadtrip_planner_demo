export function createRuntimeMapState() {
  const state = {
    map: undefined,
    routeLayer: undefined,
    markerLayer: undefined,
    dayOverviewLayer: undefined,
    dayPhotoCalloutLayer: undefined,
    dayPhotoCalloutRenderer: null,
    dayPhotoCalloutLayoutTimer: null,
    dayOverviewRequestId: 0,
    dayOverviewBounds: undefined,
    mapFocusDate: '',
    renderedOverviewDate: null,
    mapRouteLegend: undefined
  };
  const accessors = {};
  Object.keys(state).forEach(key => {
    const suffix = `${key[0].toUpperCase()}${key.slice(1)}`;
    accessors[`get${suffix}`] = () => state[key];
    accessors[`set${suffix}`] = value => { state[key] = value; };
  });
  return {
    ...accessors,
    getLayers: () => [state.dayPhotoCalloutLayer, state.dayOverviewLayer, state.markerLayer, state.routeLayer],
    resetMapFocusDate: () => { state.mapFocusDate = ''; }
  };
}
