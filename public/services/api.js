import { TOKEN_KEY } from './account-keys.js';

const MAX_SAVED_POLYLINE_POINTS = 240;
const POLYLINE_SAMPLE_STEP = 10;

// 腾讯云 HTTP 网关会在云函数执行前拒绝过大的请求。路线折线是行程数据的
// 主要体积来源；上传副本沿用后端读取接口的降采样规则，保留首尾点和地图形状。
function compactPolyline(polyline) {
  if (typeof polyline === 'string') {
    const points = polyline.split(';');
    if (points.length <= MAX_SAVED_POLYLINE_POINTS) return polyline;
    return points.filter((_, index) => index % POLYLINE_SAMPLE_STEP === 0 || index === points.length - 1).join(';');
  }
  if (Array.isArray(polyline) && polyline.length > MAX_SAVED_POLYLINE_POINTS) {
    return polyline.filter((_, index) => index % POLYLINE_SAMPLE_STEP === 0 || index === polyline.length - 1);
  }
  return polyline;
}

function compactPlannerPayload(value, key = '') {
  if (key === 'polyline') return compactPolyline(value);
  if (Array.isArray(value)) return value.map(item => compactPlannerPayload(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, compactPlannerPayload(child, childKey)]));
  }
  return value;
}

function plannerRoutes(data) {
  const active = data?.versions && data.activeVersion ? data.versions[data.activeVersion] : null;
  return Array.isArray(data?.routes) && data.routes.length ? data.routes : (active?.routes || []);
}

const stableSignature = value => JSON.stringify(value, (key, child) => ['updatedAt', 'baseUpdatedAt', 'savedAt'].includes(key) ? undefined : child);

function plannerDomains(data) {
  const version = data?.versions && data.activeVersion ? data.versions[data.activeVersion] : null;
  const slim = structuredClone(data || {});
  slim.routes = [];
  Object.values(slim.versions || {}).forEach(item => {
    item.schedule = [];
    item.locations = [];
    item.routes = [];
    item.expenses = [];
    item.placeCategories = [];
  });
  return {
    version,
    slim,
    schedule: version?.schedule || [],
    locations: version?.locations || [],
    expenses: version?.expenses || [],
    categories: version?.placeCategories || [],
    routes: plannerRoutes(data),
  };
}

function plannerSignatures(data) {
  const domains = plannerDomains(compactPlannerPayload(data));
  const sig = Object.fromEntries(Object.entries(domains).filter(([key]) => key !== 'version').map(([key, value]) => [key, stableSignature(value)]));
  // locations 额外维护“按 id 的有序签名”，用于增量定位变更/删除的地点
  const locs = (domains.locations || []).filter(Boolean);
  sig.locations = {
    all: stableSignature(locs),
    ids: locs.map(l => l.id).join(','),
    byId: Object.fromEntries(locs.map(l => [l.id, stableSignature(l)])),
  };
  return sig;
}

// 计算 locations 增量：相对上一版已签名 locations，找出需写入(新增/变更)和需删除的地点。
function plannerLocationDiff(state, nextLocations) {
  const prev = state?.savedSignatures?.locations;
  const prevById = (prev && typeof prev === 'object' && prev.byId) ? prev.byId : null;
  const hasPrevIds = prev && typeof prev === 'object' && typeof prev.ids === 'string' && prev.ids.length > 0;
  const prevIds = hasPrevIds ? prev.ids.split(',') : [];
  const next = (nextLocations || []).filter(Boolean);
  const nextById = Object.fromEntries(next.map(l => [l.id, stableSignature(l)]));
  // 首次/无从比较：全量写入，以免漏发（此时本地也往往尚无太多图，安全）
  if (!prevById || !hasPrevIds) return { upsert: next, deleted: [] };
  const prevIdSet = new Set(prevIds);
  // 写入：新增或签名变化的地点
  const upsert = next.filter(l => !(l.id in prevById) || prevById[l.id] !== nextById[l.id]);
  // 删除：上一版存在但本次已消失的地点
  const deleted = [...prevIdSet].filter(id => !(id in nextById));
  return { upsert, deleted };
}

// API_BASE 由入口层(bootstrap)传入:默认空 = 同源(本地 server.js / 静态托管相对路径)。
// 云端部署时两种传输：
//  1) 若传入 cloudCall（CloudBase Web SDK 调云函数，由 bootstrap 注入）→ callFunction 走 __http 协议
//  2) 否则用 apiBase（HTTP 访问服务域名）fetch
async function request(url, options = {}, { storage, onUnauthorized, apiBase = '', cloudCall } = {}) {
  const headers = { ...(options.headers || {}) };
  const token = (() => { try { return storage?.getItem(TOKEN_KEY); } catch { return null; } })();
  if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`;

  // ---- 云端模式：CloudBase Web SDK callFunction（复用云函数 __http 协议） ----
  if (cloudCall) {
    let body = {};
    if (options.body) {
      try { body = JSON.parse(options.body); } catch { body = {}; }
    }
    const result = await cloudCall({ method: options.method || 'GET', path: url, headers, body });
    const statusCode = result.statusCode || 200;
    let payload;
    try { payload = JSON.parse(result.body || '{}'); } catch { payload = { error: result.body || '服务返回异常' }; }
    if (statusCode === 401 && token && !url.includes('/api/auth/')) onUnauthorized?.();
    if (!(statusCode >= 200 && statusCode < 300)) throw new Error(payload.error || `请求失败：${statusCode}`);
    return payload;
  }

  // ---- 本地 / HTTP 访问模式 ----
  const fullUrl = `${apiBase}${url}`;
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
  if (response.status === 413) throw new Error('上传数据超过腾讯云网关限制（413），请更新网页端后重试');
  if (!response.ok) throw new Error(result.error || `请求失败：${response.status}`);
  return result;
}

export function createApi({ storage, onUnauthorized, apiBase = '', cloudCall } = {}) {
  const state = { activeTripId: null, savedSignatures: null };

  // 统一带 base 的请求：apiBase 默认空 = 同源
  const requestWithBase = (url, options = {}) => request(url, options, { storage, onUnauthorized, apiBase, cloudCall });
  const jsonPost = (url, data) => requestWithBase(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  return {
    setToken: () => {}, // token 由 request 每次从 storage 读取，无需显式设置
    setActiveTrip: id => {
      if (state.activeTripId !== id) state.savedSignatures = null;
      state.activeTripId = id;
    },
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
        state.savedSignatures = plannerSignatures(trip.data || {});
        return { data: trip.data, trip };
      }
      // 云端模式无活动行程：不请求本地文件接口（云函数无 /api/planner-data），返回空
      if (apiBase) return { data: null, trip: null };
      return requestWithBase('/api/planner-data');
    },
    savePlannerData: async data => {
      if (state.activeTripId) {
        const id = state.activeTripId;
        // 拆分保存：大字段（时间表/地点/路线）走轻量接口，避免单文档超限；其余小字段整体更新
        const compactData = compactPlannerPayload(data);
        const domains = plannerDomains(compactData);
        const nextSignatures = plannerSignatures(compactData);
        // locations 用增量 diff（避免每次全量重传所有地点图片，从而根治单点图片导致的全量 413）；
        // 其他域用整域签名判断是否变化。
        const locationDiff = plannerLocationDiff(state, domains.locations);
        const locChanged = locationDiff.upsert.length > 0 || locationDiff.deleted.length > 0;
        const changed = key => {
          if (key === 'locations') return locChanged;
          return !state.savedSignatures || nextSignatures[key] !== state.savedSignatures[key];
        };
        const header = { 'Content-Type': 'application/json' };
        if (changed('slim')) await requestWithBase(`/api/trips/${id}`, { method: 'PUT', headers: header, body: JSON.stringify({ data: domains.slim, preserve_large_fields: true }) });
        if (changed('schedule')) await requestWithBase(`/api/trips/${id}/schedule`, { method: 'PUT', headers: header, body: JSON.stringify({ schedule: domains.schedule }) });
        if (changed('locations')) {
          // 只发送新增/变更的地点 + 待删除 id，其余地点不重传
          const locBody = JSON.stringify({ locations: locationDiff.upsert, deleted: locationDiff.deleted });
          // 单张图片体积硬防线：超过 1.2MB base64 说明压缩未生效/存入原始大图，
          // 拦截并明确提示（而非靠 4.5MB 总量兜底或裸 413）。
          const oversized = (locationDiff.upsert || []).filter(loc => typeof loc?.photo === 'string' && loc.photo.startsWith('data:') && loc.photo.length > 1.2 * 1024 * 1024);
          if (oversized.length) {
            throw new Error(`有 ${oversized.length} 张地点图片过大（压缩后仍超过 1.2MB）。请重新选择较小图片，或压缩后重试。`);
          }
          // 体积防线：即便一次变更的地点图很多，也给出可操作的提示而非裸 413
          const GATEWAY_CEILING = 4.5 * 1024 * 1024;
          if (locBody.length > GATEWAY_CEILING) {
            const dataUrls = locationDiff.upsert.filter(loc => typeof loc?.photo === 'string' && loc.photo.startsWith('data:')).length;
            throw new Error(`本次更新的地点图片总量过大（约 ${(locBody.length / 1024 / 1024).toFixed(1)}MB，上限约 4.5MB）。请减少或更换部分地点图片（${dataUrls} 张基础图）。`);
          }
          await requestWithBase(`/api/trips/${id}/locations`, { method: 'PUT', headers: header, body: locBody });
        }
        if (changed('expenses')) await requestWithBase(`/api/trips/${id}/expenses`, { method: 'PUT', headers: header, body: JSON.stringify({ expenses: domains.expenses }) });
        if (changed('categories')) await requestWithBase(`/api/trips/${id}/categories`, { method: 'PUT', headers: header, body: JSON.stringify({ categories: domains.categories }) });
        // 路线逐条写入；全部成功后才清理已删除路线，避免半途失败造成数据丢失。
        const routes = domains.routes;
        if (changed('routes')) {
          for (const route of routes) {
            if (!route?.id) continue;
            await requestWithBase(`/api/trips/${id}/routes/item`, { method: 'PUT', headers: header, body: JSON.stringify({ route }) });
          }
          await requestWithBase(`/api/trips/${id}/routes/sync`, { method: 'PUT', headers: header, body: JSON.stringify({ routeIds: routes.map(route => route?.id).filter(Boolean) }) });
        }
        state.savedSignatures = nextSignatures;
        const trip = await requestWithBase(`/api/trips/${id}`);
        return { updatedAt: trip.trip.updated_at, savedAt: trip.trip.updated_at };
      }
      // 云端模式无活动行程：保存无意义，必须明确报错
      //（原实现静默返回成功，导致“保存了但刷新又恢复”且无任何提示）
      if (apiBase) throw new Error('尚未选择活动行程，无法保存。请先登录并选择或创建一个行程。');
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
