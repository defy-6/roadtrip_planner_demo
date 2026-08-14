// 账号会话管理：登录态恢复、行程列表、活动行程选择。
// 不直接访问 DOM；storage 由调用方注入（浏览器传 localStorage，测试传内存对象）。
import { TOKEN_KEY, ACTIVE_TRIP_KEY } from './account-keys.js';

export function createAccount({ api, storage }) {
  const state = {
    user: null,
    trips: { mine: [], shared: [] },
    activeTripId: null,
  };

  function getToken() {
    try { return storage.getItem(TOKEN_KEY); } catch { return null; }
  }

  function persistToken(token) {
    try {
      if (token) storage.setItem(TOKEN_KEY, token);
      else storage.removeItem(TOKEN_KEY);
    } catch { /* 隐私模式等场景忽略 */ }
    api.setToken(token);
  }

  function persistActiveTrip(id) {
    try {
      if (id) storage.setItem(ACTIVE_TRIP_KEY, id);
      else storage.removeItem(ACTIVE_TRIP_KEY);
    } catch { /* 忽略 */ }
    state.activeTripId = id;
    api.setActiveTrip(id);
  }

  // 静默恢复登录态：有 token 则校验并拉行程列表；失败清 token 返回 null。
  async function restore() {
    const token = getToken();
    if (!token) return null;
    api.setToken(token); // 同步 token 给 api（真实 api 从 storage 读取，此处为契约一致）
    try {
      const { user } = await api.authMe();
      state.user = user;
      await refreshTrips();
      return user;
    } catch {
      persistToken(null);
      state.user = null;
      state.trips = { mine: [], shared: [] };
      return null;
    }
  }

  async function refreshTrips() {
    const { trips } = await api.listTrips();
    state.trips = trips;
    const remembered = getActiveTripId();
    const all = [...trips.mine, ...trips.shared];
    const match = all.find(t => t._id === remembered) || all[0] || null;
    persistActiveTrip(match ? match._id : null);
    return match;
  }

  async function login(username, password) {
    const { token, user } = await api.authLogin({ username, password });
    persistToken(token);
    state.user = user;
    await refreshTrips();
    return user;
  }

  async function register(username, password, nickname) {
    const { token, user } = await api.authRegister({ username, password, nickname });
    persistToken(token);
    state.user = user;
    await refreshTrips();
    return user;
  }

  async function logout() {
    persistToken(null);
    state.user = null;
    state.trips = { mine: [], shared: [] };
    persistActiveTrip(null);
  }

  async function createTrip(name, data) {
    const { trip } = await api.createTrip({ name, data });
    await refreshTrips();
    persistActiveTrip(trip._id);
    return trip;
  }

  async function joinTrip(shareCode) {
    const { trip } = await api.joinTrip(shareCode);
    await refreshTrips();
    persistActiveTrip(trip._id);
    return trip;
  }

  function getActiveTripId() {
    try { return storage.getItem(ACTIVE_TRIP_KEY); } catch { return null; }
  }

  return {
    restore, login, register, logout,
    refreshTrips, createTrip, joinTrip,
    getUser: () => state.user,
    getTrips: () => state.trips,
    getActiveTripId,
    getToken,
  };
}
