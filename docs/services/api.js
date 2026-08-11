async function request(url, options) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '请求失败');
  return result;
}

export function createApi() {
  return {
    getPlannerData: () => request('/api/planner-data'),
    savePlannerData: data => request('/api/planner-data', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    geocode: ({ address, keyword = '' }) => request(`/api/geocode?${new URLSearchParams({ address, keyword })}`),
    calculateRoute: payload => request('/api/route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
    getWeather: params => request(`/api/weather?${new URLSearchParams(params)}`)
  };
}
