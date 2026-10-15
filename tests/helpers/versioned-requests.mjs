// Test-only: legacy workflow tests act as freshly-reading modern clients.
// Explicit (including empty/stale) baselines are never replaced by this helper.
export async function withCurrentBaseline(store, method, pathname, body, token) {
  const id = /^\/api\/trips\/([^/?]+)/.exec(pathname)?.[1];
  if (!id || id === 'join' || method === 'GET') return body;
  const trip = await store.findOne('trips', { _id: id });
  if (!trip) return body;
  const next = { ...body };
  if (!Object.hasOwn(next, 'baseUpdatedAt')) next.baseUpdatedAt = trip.updated_at;
  if (Array.isArray(next.data?.locations) && !Object.hasOwn(next, 'baseLibraryRevision')) {
    const session = await store.findOne('sessions', { token });
    const user = session && await store.findOne('users', { _id: session.user_id });
    next.baseLibraryRevision = Number(user?.place_library_revision || 0);
  }
  return next;
}
