export function createGeocodeService(api, { pause = () => Promise.resolve(), aliases = {} } = {}) {
  const cache = new Map();
  let queue = Promise.resolve();
  return async function geocode(address, keyword = '') {
    const mappedKeyword = aliases[keyword] || keyword;
    const cacheKey = `${address}|${mappedKeyword}`;
    if (!cache.has(cacheKey)) {
      const request = queue.then(async () => { const result = await api.geocode({ address, keyword: mappedKeyword }); await pause(700); return result.geocodes?.[0] || null; });
      queue = request.catch(() => undefined);
      cache.set(cacheKey, request);
    }
    const result = await cache.get(cacheKey);
    if (!result) throw new Error(`未找到：${address}`);
    return result;
  };
}
