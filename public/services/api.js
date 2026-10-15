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

const stableSignature = value => JSON.stringify(value, (key, child) => ['updatedAt', 'baseUpdatedAt', 'savedAt', 'baseLibraryRevision', 'sourceTripId', 'sourceActorScope'].includes(key) ? undefined : child);

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
  // 安全护栏：若"本次消失"的地点数量异常大（超过上一版一半），说明本次 locations
  // 很可能是不完整/未正确加载的数据，而非真实删除。此时不再提交 deleted，
  // 只推送新增/变更，避免把整片计划地点一次性误删到云端（历史曾因此丢数据）。
  const suspiciousBulkDelete = deleted.length > 0 && deleted.length > prevIdSet.size / 2;
  return { upsert, deleted: suspiciousBulkDelete ? [] : deleted };
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
    if (!(statusCode >= 200 && statusCode < 300)) { const error = new Error(payload.error || `请求失败：${statusCode}`); error.status = statusCode; error.code = payload.code || (statusCode === 409 ? 'VERSION_CONFLICT' : 'REQUEST_FAILED'); throw error; }
    return payload;
  }

  // ---- 本地 / HTTP 访问模式 ----
  const fullUrl = `${apiBase}${url}`;
  let response;
  const controller = options.signal ? null : new AbortController();
  const timeout = controller ? setTimeout(() => controller.abort(), 12_000) : null;
  try {
    response = await fetch(fullUrl, { ...options, headers, signal: options.signal || controller.signal });
  } catch (error) {
    throw new Error(error?.name === 'AbortError' ? '请求超时，请稍后重试' : '网络连接失败，请检查本地服务是否已启动', { cause: error });
  } finally {
    if (timeout) clearTimeout(timeout);
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
  if (!response.ok) { const error = new Error(result.error || `请求失败：${response.status}`); error.status = response.status; error.code = result.code || (response.status === 409 ? 'VERSION_CONFLICT' : 'REQUEST_FAILED'); throw error; }
  return result;
}

export function createApi({ storage, onUnauthorized, apiBase = '', cloudCall } = {}) {
  const state = { activeTripId: null, savedSignatures: null, remoteUpdatedAt: '', libraryRevision: 0, librarySignature: '' };
  const revisions = new Map();
  let actorToken, actorScope = 'local', resourceGeneration = 0;
  const currentToken = () => storage?.getItem(TOKEN_KEY) || '';
  const changedContext = (code, message) => { const error = new Error(message); error.code = code; error.status = 409; throw error; };
  const ensureActor = () => {
    if (actorToken === undefined) actorToken = currentToken();
    if (actorToken !== currentToken()) changedContext('SESSION_CHANGED', '账号会话已变化，本地修改仍保留，请重新登录后核对');
  };
  const ensureResource = (id, generation) => {
    ensureActor();
    if (id !== state.activeTripId || generation !== resourceGeneration) changedContext('RESOURCE_CHANGED', '旅行已切换，原旅行修改仍保留，未写入其他旅行');
  };

  // 统一带 base 的请求：apiBase 默认空 = 同源
  const requestWithBase = (url, options = {}) => request(url, options, { storage, onUnauthorized, apiBase, cloudCall });
  const jsonPost = (url, data) => requestWithBase(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const rememberTrip = response => {
    if (response.trip?._id && response.trip.updated_at) revisions.set(response.trip._id, response.trip.updated_at);
    return response;
  };
  const mutateTrip = async (id, suffix, method, data = {}) => {
    ensureActor();
    const baseline = data.baseUpdatedAt || (id === state.activeTripId ? state.remoteUpdatedAt : revisions.get(id));
    const result = await requestWithBase(`/api/trips/${id}${suffix}`, { method,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, baseUpdatedAt: baseline }) });
    ensureActor();
    rememberTrip(result);
    const next = result.updated_at || result.trip?.updated_at;
    if (next && id === state.activeTripId) state.remoteUpdatedAt = next;
    return result;
  };

  return {
    setToken: () => {}, // token 由 request 每次从 storage 读取，无需显式设置
    setActorScope: scope => { actorScope = scope; actorToken = currentToken(); },
    getActorScope: () => actorScope,
    setActiveTrip: id => {
      if (state.activeTripId !== id) { resourceGeneration++; state.savedSignatures = null; state.remoteUpdatedAt = ''; state.librarySignature = ''; }
      state.activeTripId = id;
    },
    getActiveTripId: () => state.activeTripId,
    // 当前权威版本（云端 updated_at 或本地文件 updatedAt）：待同步数据的安全重放前置条件。
    getRemoteRevision: () => state.remoteUpdatedAt,
    getLibraryRevision: () => state.libraryRevision,

    // ---- 账号 ----
    authRegister: data => jsonPost('/api/auth/register', data),
    authLogin: data => jsonPost('/api/auth/login', data),
    authWxLogin: data => jsonPost('/api/auth/wx-login', data),
    authMe: () => requestWithBase('/api/auth/me'),

    // ---- 行程 ----
    listTrips: () => requestWithBase('/api/trips'),
    createTrip: data => jsonPost('/api/trips', data),
    getTrip: async id => rememberTrip(await requestWithBase(`/api/trips/${id}`)),
    updateTrip: (id, data) => mutateTrip(id, '', 'PUT', data),
    deleteTrip: id => mutateTrip(id, '', 'DELETE'),
    joinTrip: data => requestWithBase('/api/trips/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    tripShare: (id, enabled, readonly = true) => mutateTrip(id, '/share', 'POST', { enabled, readonly }),
    tripMembers: id => requestWithBase(`/api/trips/${id}/members`),
    updateTripMember: (id, data) => mutateTrip(id, '/members', 'PUT', data),
    removeTripMember: (id, userId) => mutateTrip(id, '/members', 'DELETE', { user_id: userId }),
    listTripBackups: id => requestWithBase(`/api/trips/${id}/backups`),
    createTripBackup: id => requestWithBase(`/api/trips/${id}/backups`, { method: 'POST' }),
    restoreTripBackup: (id, backupId, { allowMissingLinks = false } = {}) => mutateTrip(id, '/backups/restore', 'POST', { backup_id: backupId, allow_missing_links: allowMissingLinks }),

    // ---- 行程数据（云分流：登录并选定活动行程后读写云端；否则读写本地文件） ----
    getPlannerData: async () => {
      ensureActor();
      const generation = resourceGeneration, id = state.activeTripId;
      if (state.activeTripId) {
        const { trip } = await requestWithBase(`/api/trips/${id}`);
        ensureResource(id, generation);
        state.savedSignatures = plannerSignatures(trip.data || {}); state.remoteUpdatedAt = trip.updated_at || '';
        state.libraryRevision = Number(trip.place_library_revision || 0);
        state.librarySignature = stableSignature(trip.data?.locations || []);
        rememberTrip({ trip });
        return { data: trip.data, trip };
      }
      // 云端模式无活动行程：不请求本地文件接口（云函数无 /api/planner-data），返回空
      if (apiBase) return { data: null, trip: null };
      const local = await requestWithBase('/api/planner-data');
      ensureResource(id, generation);
      // 本地文件模式同样维护"当前权威版本"，供待同步数据的安全重放前置条件比较。
      state.remoteUpdatedAt = local?.revision || local?.data?.updatedAt || local?.data?.savedAt || '';
      return local;
    },
    savePlannerData: async data => {
      ensureActor();
      const { sourceTripId, sourceActorScope, baseUpdatedAt: payloadBaseline, baseLibraryRevision: capturedLibraryRevision, ...plannerData } = data;
      if (sourceTripId && sourceTripId !== (state.activeTripId || 'local')) changedContext('RESOURCE_CHANGED', '保存快照属于另一旅行，已拒绝写入');
      if (sourceActorScope && sourceActorScope !== actorScope) changedContext('SESSION_CHANGED', '保存快照属于另一账号，已拒绝写入');
      data = plannerData;
      const generation = resourceGeneration;
      if (state.activeTripId) {
        const id = state.activeTripId;
        const remote = await requestWithBase(`/api/trips/${id}`);
        ensureResource(id, generation);
        const libraryBaseline = capturedLibraryRevision ?? state.libraryRevision;
        if (remote.trip?.place_library_revision !== undefined && Number(remote.trip.place_library_revision) !== libraryBaseline) {
          const conflict = new Error('账号地点库已更新，请保留本地修改并重新核对后保存。');
          conflict.code = 'VERSION_CONFLICT'; conflict.status = 409; throw conflict;
        }
        if (state.remoteUpdatedAt && remote.trip?.updated_at && remote.trip.updated_at !== state.remoteUpdatedAt) {
          const conflict = new Error('云端行程已被其他协作者更新，请刷新并确认变更后再保存。'); conflict.code = 'VERSION_CONFLICT'; conflict.status = 409; throw conflict;
        }
        if (payloadBaseline && payloadBaseline !== remote.trip?.updated_at) changedContext('VERSION_CONFLICT', '保存快照基于旧版本，本地修改已保留，请核对后重试');
        // 拆分保存：大字段（时间表/地点/路线）走轻量接口，避免单文档超限；其余小字段整体更新
        const compactData = compactPlannerPayload(data);
        const domains = plannerDomains(compactData);
        const nextSignatures = plannerSignatures(compactData);
        const saveDomain = async (url, options) => {
          ensureResource(id, generation);
          const result = await requestWithBase(url, options);
          ensureResource(id, generation);
          state.remoteUpdatedAt = result.updated_at || result.trip?.updated_at || state.remoteUpdatedAt;
          if (result.place_library_revision !== undefined) state.libraryRevision = result.place_library_revision;
          return result;
        };
        // locations 用增量 diff（避免每次全量重传所有地点图片，从而根治单点图片导致的全量 413）；
        // 其他域用整域签名判断是否变化。
        const locationDiff = plannerLocationDiff(state, domains.locations);
        const locChanged = locationDiff.upsert.length > 0 || locationDiff.deleted.length > 0;
        const changed = key => {
          if (key === 'locations') return locChanged;
          return !state.savedSignatures || nextSignatures[key] !== state.savedSignatures[key];
        };
        const header = { 'Content-Type': 'application/json' };
        // 每个写请求都带"基于哪个版本"的前置条件（baseUpdatedAt）。服务端把"版本检查 + 写入"合并为一次
        // 条件更新，因此即便两个客户端同时保存，后者也会收到 409 而不会静默覆盖前者；
        // 不用只靠上面那次"先 GET 再 PUT"。各域串行写入，后一域以前一域返回的新版本为基线。
        const withBase = body => ({ ...body, baseUpdatedAt: state.remoteUpdatedAt, baseLibraryRevision: libraryBaseline });
        if (changed('slim')) {
          // A preferences/name update must not rewrite an unchanged account library.
          if (stableSignature(domains.slim.locations || []) === state.librarySignature) delete domains.slim.locations;
          const slimBody = JSON.stringify(withBase({ data: domains.slim, preserve_large_fields: true,
            ...(domains.version?.name?.trim() ? { name: domains.version.name.trim() } : {}) }));
          // 通用库(locations)随 slim 全量上传；给总量兜底，避免通用库累积大量 base64 后裸 413。
          const slimLarge = (domains.slim?.locations || []).filter(loc => typeof loc?.photo === 'string' && loc.photo.startsWith('data:')).length;
          if (slimBody.length > 4.5 * 1024 * 1024) {
            throw new Error(`我的地点库总量过大（约 ${(slimBody.length / 1024 / 1024).toFixed(1)}MB，上限约 4.5MB，含 ${slimLarge} 张本地图片）。请清理未使用的地点，或更换为高德网络图片。`);
          }
          await saveDomain(`/api/trips/${id}`, { method: 'PUT', headers: header, body: slimBody });
        }
        if (changed('schedule')) await saveDomain(`/api/trips/${id}/schedule`, { method: 'PUT', headers: header, body: JSON.stringify(withBase({ schedule: domains.schedule })) });
        if (changed('locations')) {
          // 只发送新增/变更的地点 + 待删除 id，其余地点不重传
          const locBody = JSON.stringify(withBase({ locations: locationDiff.upsert, deleted: locationDiff.deleted }));
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
          await saveDomain(`/api/trips/${id}/locations`, { method: 'PUT', headers: header, body: locBody });
        }
        if (changed('expenses')) await saveDomain(`/api/trips/${id}/expenses`, { method: 'PUT', headers: header, body: JSON.stringify(withBase({ expenses: domains.expenses })) });
        if (changed('categories')) await saveDomain(`/api/trips/${id}/categories`, { method: 'PUT', headers: header, body: JSON.stringify(withBase({ categories: domains.categories })) });
        // 路线逐条写入；全部成功后才清理已删除路线，避免半途失败造成数据丢失。
        const routes = domains.routes;
        if (changed('routes')) {
          for (const route of routes) {
            if (!route?.id) continue;
            await saveDomain(`/api/trips/${id}/routes/item`, { method: 'PUT', headers: header, body: JSON.stringify(withBase({ route })) });
          }
          await saveDomain(`/api/trips/${id}/routes/sync`, { method: 'PUT', headers: header, body: JSON.stringify(withBase({ routeIds: routes.map(route => route?.id).filter(Boolean) })) });
        }
        state.savedSignatures = nextSignatures;
        state.librarySignature = stableSignature(data.locations || []);
        // Never adopt a later writer's revision without adopting its snapshot.
        return { updatedAt: state.remoteUpdatedAt, savedAt: state.remoteUpdatedAt };
      }
      // 云端模式无活动行程：保存无意义，必须明确报错
      //（原实现静默返回成功，导致“保存了但刷新又恢复”且无任何提示）
      if (apiBase) throw new Error('尚未选择活动行程，无法保存。请先登录并选择或创建一个行程。');
      const result = await requestWithBase('/api/planner-data', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, baseUpdatedAt: payloadBaseline || state.remoteUpdatedAt }) });
      ensureResource(null, generation);
      state.remoteUpdatedAt = result?.updatedAt || result?.savedAt || state.remoteUpdatedAt;
      return result;
    },

    // ---- 本地服务（高德/天气等，与账号无关） ----
    getPreviewMode: () => requestWithBase('/api/preview-mode'),
    geocode: ({ address, keyword = '' }) => requestWithBase(`/api/geocode?${new URLSearchParams({ address, keyword })}`),
    calculateRoute: payload => requestWithBase('/api/route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
    getWeather: params => requestWithBase(`/api/weather?${new URLSearchParams(params)}`),
    getPlacePhotos: ({ name, address }) => requestWithBase(`/api/place-photos?${new URLSearchParams({ name, address })}`),
    getPlaceDetails: ({ name, address }) => requestWithBase(`/api/place-details?${new URLSearchParams({ name, address })}`),
    proxyMapImage: url => requestWithBase(`/api/map-image?${new URLSearchParams({ url })}`)
  };
}
