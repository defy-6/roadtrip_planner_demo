// 行远途记 · 小程序入口
const { getToken, clearAuth } = require('./utils/request');

App({
  globalData: {
    user: null,
  },

  onLaunch() {
    // 初始化云开发环境（与云函数 api 同一环境）
    if (wx.cloud) {
      wx.cloud.init({
        env: 'cloud1-d0giwgf98368c9398',
        traceUser: true,
      });
    }
    // 有 token 时首页自行校验；无 token 时首页引导到登录页
    if (!getToken()) {
      wx.reLaunch({ url: '/pages/login/login' });
    }
  },

  // 退出登录：清 token 并回登录页
  logout() {
    clearAuth();
    this.globalData.user = null;
    wx.reLaunch({ url: '/pages/login/login' });
  },
});
