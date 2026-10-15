// 请求封装：通过 wx.cloud.callFunction 调用后端云函数 api（免 HTTP 触发器/域名配置）。
// 云函数 event.__http 携带 method/path/headers/body，返回 { statusCode, body }（body 为 JSON 字符串）。
// 401（非登录接口）自动清 token 并回登录页。

const TOKEN_KEY = 'roadtrip-token';
const USER_KEY = 'roadtrip-user';
const drafts = require('./drafts');

function currentPage() {
  if (typeof getCurrentPages !== 'function') return null;
  const pages = getCurrentPages();
  return pages[pages.length - 1] || null;
}

function resetTripRevision(tripId) {
  const page = currentPage();
  if (page?.__tripReadVersions) delete page.__tripReadVersions[tripId];
}

function getToken() {
  try { return wx.getStorageSync(TOKEN_KEY) || null; } catch { return null; }
}

function clearAuth() {
  try {
    wx.removeStorageSync(TOKEN_KEY);
    wx.removeStorageSync(USER_KEY);
  } catch { /* 忽略 */ }
}

function request(path, { method = 'GET', data } = {}) {
  // Version belongs to the page/draft that read it, never a global latest version.
  const page = currentPage();
  const tripId = /^\/api\/trips\/([^/?]+)/.exec(path)?.[1];
  const scopedTrip = tripId && tripId !== 'join';
  if (scopedTrip && method !== 'GET') {
    data = { ...data, baseUpdatedAt: data?.baseUpdatedAt || page?.__tripReadVersions?.[tripId] };
  }
  return new Promise((resolve, reject) => {
    const token = getToken();
    const draftDurable = scopedTrip && method !== 'GET' ? drafts.retain(page, tripId, { path, method, data }) : false;
    const failWithDraft = error => {
      if (scopedTrip && method !== 'GET') {
        const durable = draftDurable;
        error.draftRetained = durable;
        error.message += durable ? '；本机恢复草稿已保存' : '；草稿未能落盘，请勿退出当前页面';
      }
      reject(error);
    };
    wx.cloud.callFunction({
      name: 'api',
      data: {
        __http: {
          method,
          path,
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: data,
        },
      },
      success: res => {
        if (getToken() !== token) {
          const error = new Error('登录账号已变化，本次响应不用于当前页面');
          error.code = 'SESSION_CHANGED'; failWithDraft(error); return;
        }
        const result = res.result || {};
        const statusCode = result.statusCode || 200;
        let payload;
        try { payload = JSON.parse(result.body || '{}'); }
        catch { payload = { error: result.body || '服务返回异常' }; }
        if (statusCode === 401 && !path.includes('/api/auth/')) {
          failWithDraft(new Error('登录已过期，请重新登录'));
          clearAuth();
          wx.reLaunch({ url: '/pages/login/login' });
          return;
        }
        if (statusCode >= 200 && statusCode < 300) {
          const revision = payload.updated_at || payload.trip?.updated_at;
          if (scopedTrip && revision && page) {
            page.__tripReadVersions ||= {};
            const previous = page.__tripReadVersions[tripId];
            if (method === 'GET' && previous && previous !== revision) {
              const error = new Error('读取期间云端版本变化，请保留本地修改并重新读取');
              error.code = 'VERSION_CONFLICT'; error.status = 409;
              reject(error); return;
            }
            page.__tripReadVersions[tripId] = revision;
          }
          if (scopedTrip && method !== 'GET') drafts.acknowledge(page, { path, method });
          resolve(payload);
        } else {
          // 保留 HTTP 状态码与服务端业务错误码：小程序需要据此区分版本冲突（VERSION_CONFLICT）、
          // 备份校验失败（BACKUP_*）等，不能把冲突降级成普通错误后静默覆盖。
          const error = new Error(payload.error || `请求失败（${statusCode}）`);
          error.status = statusCode;
          error.code = payload.code || null;
          error.payload = payload;
          failWithDraft(error);
        }
      },
      fail: err => failWithDraft(new Error(`云函数调用失败：${err.errMsg || '未知错误'}`)),
    });
  });
}

function saveAuth({ token, user }) {
  try {
    wx.setStorageSync(TOKEN_KEY, token);
    wx.setStorageSync(USER_KEY, user || {});
  } catch { /* 忽略 */ }
}

function getUser() {
  try { return wx.getStorageSync(USER_KEY) || null; } catch { return null; }
}

module.exports = { request, getToken, clearAuth, saveAuth, getUser, resetTripRevision };
