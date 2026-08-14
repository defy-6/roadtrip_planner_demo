// 请求封装：通过 wx.cloud.callFunction 调用后端云函数 api（免 HTTP 触发器/域名配置）。
// 云函数 event.__http 携带 method/path/headers/body，返回 { statusCode, body }（body 为 JSON 字符串）。
// 401（非登录接口）自动清 token 并回登录页。

const TOKEN_KEY = 'roadtrip-token';
const USER_KEY = 'roadtrip-user';

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
  return new Promise((resolve, reject) => {
    const token = getToken();
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
        const result = res.result || {};
        const statusCode = result.statusCode || 200;
        let payload;
        try { payload = JSON.parse(result.body || '{}'); }
        catch { payload = { error: result.body || '服务返回异常' }; }
        if (statusCode === 401 && !path.includes('/api/auth/')) {
          clearAuth();
          wx.reLaunch({ url: '/pages/login/login' });
          reject(new Error('登录已过期，请重新登录'));
          return;
        }
        if (statusCode >= 200 && statusCode < 300) {
          resolve(payload);
        } else {
          reject(new Error(payload.error || `请求失败（${statusCode}）`));
        }
      },
      fail: err => reject(new Error(`云函数调用失败：${err.errMsg || '未知错误'}`)),
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

module.exports = { request, getToken, clearAuth, saveAuth, getUser };
