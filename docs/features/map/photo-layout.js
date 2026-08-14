export function calloutBox(point, placement, compact = false, scale = 1) {
  const width = (compact ? 88 : 116) * scale, height = (compact ? 92 : 120) * scale, gap = (compact ? 8 : 10) * scale;
  if (placement === 'bottom') return { left: point.x - width / 2, top: point.y + gap, right: point.x + width / 2, bottom: point.y + gap + height };
  if (placement === 'left') return { left: point.x - gap - width, top: point.y - height / 2, right: point.x - gap, bottom: point.y + height / 2 };
  if (placement === 'right') return { left: point.x + gap, top: point.y - height / 2, right: point.x + gap + width, bottom: point.y + height / 2 };
  return { left: point.x - width / 2, top: point.y - gap - height, right: point.x + width / 2, bottom: point.y - gap };
}

export function boxesOverlap(first, second, padding = 8) {
  return first.left - padding < second.right && first.right + padding > second.left && first.top - padding < second.bottom && first.bottom + padding > second.top;
}

export function overlapArea(first, second, padding = 8) {
  const width = Math.max(0, Math.min(first.right + padding, second.right + padding) - Math.max(first.left - padding, second.left - padding));
  const height = Math.max(0, Math.min(first.bottom + padding, second.bottom + padding) - Math.max(first.top - padding, second.top - padding));
  return width * height;
}

export function segmentTouchesBox(first, second, box) {
  for (let index = 0; index <= 8; index += 1) {
    const ratio = index / 8, x = first.x + (second.x - first.x) * ratio, y = first.y + (second.y - first.y) * ratio;
    if (x >= box.left - 5 && x <= box.right + 5 && y >= box.top - 5 && y <= box.bottom + 5) return true;
  }
  return false;
}

export function layoutPhotoCallouts(entries, routeLatLngs, { toPoint, compact = false, scale = 1 }) {
  const routePoints = routeLatLngs.map(toPoint).filter(Boolean), candidates = ['top', 'right', 'left', 'bottom'];
  const prepared = entries.map(entry => ({ ...entry, point: toPoint(entry.latLng) })).filter(entry => entry.point);
  let states = [{ score: 0, placed: [] }];
  prepared.forEach((entry, entryIndex) => {
    const choices = candidates.map((placement, placementIndex) => {
      const box = calloutBox(entry.point, placement, compact, scale);
      const routeHits = routePoints.slice(1).reduce((count, point, index) => count + Number(segmentTouchesBox(routePoints[index], point, box)), 0);
      return { entry, entryIndex, placement, placementIndex, box, routeHits };
    });
    states = states.flatMap(state => choices.map(choice => ({ score: state.score + state.placed.reduce((sum, item) => sum + overlapArea(choice.box, item.box), 0) * 1000 + choice.routeHits * 80 + choice.placementIndex, placed: [...state.placed, choice] }))).sort((a, b) => a.score - b.score).slice(0, 320);
  });
  return new Map((states[0]?.placed || []).map(choice => [choice.entry.key, choice.placement]));
}
