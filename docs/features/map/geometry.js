export function routePointDistanceMeters(first, second) {
  const latitude = ((first[0] + second[0]) / 2) * Math.PI / 180;
  return Math.hypot((second[0] - first[0]) * 111320, (second[1] - first[1]) * 111320 * Math.cos(latitude));
}

export function corridorRouteSamples(latLngs, spacing = 250) {
  if (latLngs.length < 2) return latLngs;
  const samples = [latLngs[0]];
  for (let index = 1; index < latLngs.length; index += 1) {
    const first = latLngs[index - 1], second = latLngs[index], distance = routePointDistanceMeters(first, second);
    const steps = Math.max(1, Math.ceil(distance / spacing));
    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps;
      samples.push([first[0] + (second[0] - first[0]) * ratio, first[1] + (second[1] - first[1]) * ratio]);
    }
  }
  return samples;
}

export function routeLengthMeters(latLngs) {
  return latLngs.slice(1).reduce((total, point, index) => total + routePointDistanceMeters(latLngs[index], point), 0);
}

export function createRouteOverlapTools(policy = { proximityMeters: 400, minCorridorMeters: 20_000, minShorterRouteRatio: .18 }) {
  const sharedRouteCorridorMeters = (first, second) => {
    const samples = points => {
      if (!points.length) return [];
      const result = [{ point: points[0], distanceFromPrevious: 0 }];
      let carriedDistance = 0;
      for (let index = 1; index < points.length; index += 1) {
        carriedDistance += routePointDistanceMeters(points[index - 1], points[index]);
        if (carriedDistance >= 250) { result.push({ point: points[index], distanceFromPrevious: carriedDistance }); carriedDistance = 0; }
      }
      if (result.at(-1)?.point !== points.at(-1)) result.push({ point: points.at(-1), distanceFromPrevious: carriedDistance });
      return result;
    };
    const gridSize = .004;
    const grid = new Map();
    samples(second).forEach(sample => {
      const [lat, lng] = sample.point, key = `${Math.floor(lat / gridSize)}:${Math.floor(lng / gridSize)}`;
      const entries = grid.get(key) || []; entries.push(sample.point); grid.set(key, entries);
    });
    let currentRun = 0, longestRun = 0;
    samples(first).forEach(sample => {
      const [lat, lng] = sample.point, row = Math.floor(lat / gridSize), col = Math.floor(lng / gridSize), candidates = [];
      for (let y = -1; y <= 1; y += 1) for (let x = -1; x <= 1; x += 1) candidates.push(...(grid.get(`${row + y}:${col + x}`) || []));
      if (candidates.some(candidate => routePointDistanceMeters(sample.point, candidate) <= policy.proximityMeters)) {
        currentRun += sample.distanceFromPrevious; longestRun = Math.max(longestRun, currentRun);
      } else currentRun = 0;
    });
    return longestRun;
  };
  const routesShareVisualCorridor = (first, second) => {
    const shorterLength = Math.min(routeLengthMeters(first), routeLengthMeters(second));
    if (!shorterLength) return false;
    const sharedMeters = Math.max(sharedRouteCorridorMeters(first, second), sharedRouteCorridorMeters(second, first));
    return sharedMeters >= policy.minCorridorMeters && sharedMeters / shorterLength >= policy.minShorterRouteRatio;
  };
  return { sharedRouteCorridorMeters, routesShareVisualCorridor };
}

export function translateRouteForDisplay(latLngs, offset, projection) {
  if (!projection || !offset || latLngs.length < 2) return latLngs;
  const points = latLngs.map(projection.toPoint);
  let start = points[0], end = points.at(-1);
  if (start.distanceTo(end) < 2) {
    for (let index = points.length - 1; index > 0; index -= 1) if (points[0].distanceTo(points[index]) >= 2) { end = points[index]; break; }
  }
  const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy) || 1;
  const moveX = -dy / length * offset, moveY = dx / length * offset;
  return points.map(point => projection.toLatLng(point.x + moveX, point.y + moveY));
}

export function routeArrowPose(latLngs, fraction = .52, projection) {
  if (!projection || latLngs.length < 2) return null;
  const points = latLngs.map(projection.toPoint), segments = [];
  let totalLength = 0;
  for (let index = 1; index < points.length; index += 1) {
    const length = points[index - 1].distanceTo(points[index]);
    if (!length) continue;
    segments.push({ from: points[index - 1], to: points[index], length, start: totalLength }); totalLength += length;
  }
  if (!totalLength) return null;
  const target = totalLength * Math.min(.9, Math.max(.1, fraction));
  const segment = segments.find(item => item.start + item.length >= target) || segments.at(-1);
  const progress = Math.max(0, Math.min(1, (target - segment.start) / segment.length));
  const x = segment.from.x + (segment.to.x - segment.from.x) * progress, y = segment.from.y + (segment.to.y - segment.from.y) * progress;
  return { latLng: projection.toLatLng(x, y), bearing: Math.atan2(segment.to.y - segment.from.y, segment.to.x - segment.from.x) * 180 / Math.PI };
}
