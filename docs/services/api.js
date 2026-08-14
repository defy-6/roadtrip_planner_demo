import { TOKEN_KEY } from './account-keys.js';

// API_BASE 由入口层(bootstrap)传入:默认空 = 同源(本地 server.js / 静态托管相对路径)。
// 云端部署时由 bootstrap 读取页面注入的 __API_BASE__(云函数公用域名),全部请求指向云端。
async function request(url, options = {}, { storage, onUnauthorized, apiBase = '' } = {}) {
  const fullUrl = `${apiBase}${url}`;
  const headers = { ...(options.headers || {}) };
  const token = (() => { try { return storage?.getItem(TOKEN_KEY); } catch { return null; } })();
  if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(fullUrl, { ...options, headers });
  } catch (error) {
    throw new Error(error?.name === 'AbortError' ? '请求超时，请稍后重试' : '网络连接失败，请检查本地服务是否已启动', { cause: error });
  }

  if (response.status === 401 && token && !url.includes('/api/auth/')) {
    onUnauthorized?.();
  }

  const contentType = response.headers.get('content-type') || '';
  let result;
  if (contentType.includes('application/json')) {
    try { result = await response.json(); }
    catch { result = { error: `服务返回了无效 JSON（${response.status}）` }; }
  } else {
    const body = await response.text();
    result = { error: body.trim() || `服务响应 ${response.status}` };
  }
  if (!response.ok) throw new Error(result.error || `请求失败：${response.status}`);
  return result;
}

export function createApi({ storage, onUnauthorized, apiBase = '' } = {}) {
  const state = { activeTripId: null };

  // 统一带 base 的请求：apiBase 默认空 = 同源
  const requestWithBase = (url, options = {}) => request(url, options, { storage, onUnauthorized, apiBase });
  const jsonPost = (url, data) => requestWithBase(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  return {
    setToken: () => {}, // token 由 request 每次从 storage 读取，无需显式设置
    setActiveTrip: id => { state.activeTripId = id; },
    getActiveTripId: () => state.activeTripId,

    // ---- 账号 ----
    authRegister: data => jsonPost('/api/auth/register', data),
    authLogin: data => jsonPost('/api/auth/login', data),
    authWxLogin: data => jsonPost('/api/auth/wx-login', data),
    authMe: () => requestWithBase('/api/auth/me'),

    // ---- 行程 ----
    listTrips: () => requestWithBase('/api/trips'),
    createTrip: data => jsonPost('/api/trips', data),
    getTrip: id => requestWithBase(`/api/trips/${id}`),
    updateTrip: (id, data) => requestWithBase(`/api/trips/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    deleteTrip: id => requestWithBase(`/api/trips/${id}`, { method: 'DELETE' }),
    joinTrip: data => requestWithBase('/api/trips/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    tripShare: (id, enabled) => requestWithBase(`/api/trips/${id}/share`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) }),
    tripMembers: id => requestWithBase(`/api/trips/${id}/members`),

    // ---- 行程数据（云分流：登录并选定活动行程后读写云端；否则读写本地文件） ----
    getPlannerData: async () => {
      if (state.activeTripId) {
        const { trip } = await requestWithBase(`/api/trips/${state.activeTripId}`);
        return { data: trip.data, trip };
      }
      return requestWithBase('/api/planner-data');
    },
    savePlannerData: async data => {
      if (state.activeTripId) {
        const { trip } = await requestWithBase(`/api/trips/${state.activeTripId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data }),
        });
        // 兼容现有 onFileSaved 对 updatedAt/savedAt 的读取
        return { updatedAt: trip.updated_at, savedAt: trip.updated_at };
      }
      return requestWithBase('/api/planner-data', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    },

    // ---- 本地服务（高德/天气等，与账号无关） ----
    getPreviewMode: () => requestWithBase('/api/preview-mode'),
    geocode: ({ address, keyword = '' }) => requestWithBase(`/api/geocode?${new URLSearchParams({ address, keyword })}`),
    calculateRoute: payload => requestWithBase('/api/route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
    getWeather: params => requestWithBase(`/api/weather?${new URLSearchParams(params)}`),
    getPlacePhotos: ({ name, address }) => requestWithBase(`/api/place-photos?${new URLSearchParams({ name, address })}`),
    getPlaceDetails: ({ name, address }) => requestWithBase(`/api/place-details?${new URLSearchParams({ name, address })}`)
  };
}
