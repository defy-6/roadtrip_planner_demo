// 登录页：微信无感登录 + 账号密码登录/注册（与 web 端同一套账号体系）
const { request, getToken, clearAuth, saveAuth } = require('../../utils/request');

Page({
  data: {
    authMode: 'login', // login | register
    username: '',
    password: '',
    busy: false,
    error: '',
  },

  onLoad() {
    // 已有 token：静默校验，有效则直接进首页
    if (getToken()) {
      request('/api/auth/me')
        .then(() => wx.reLaunch({ url: '/pages/trips/trips' }))
        .catch(() => clearAuth());
    }
  },

  onInput(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
  },

  switchMode() {
    this.setData({
      authMode: this.data.authMode === 'login' ? 'register' : 'login',
      error: '',
    });
  },

  // 微信一键登录：wx.login 拿 code → 云函数换 openid 自动注册/登录
  wxLogin() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    wx.login({
      success: async ({ code }) => {
        try {
          const res = await request('/api/auth/wx-login', { method: 'POST', data: { code } });
          saveAuth(res);
          wx.reLaunch({ url: '/pages/trips/trips' });
        } catch (err) {
          this.setData({ error: err.message, busy: false });
        }
      },
      fail: () => this.setData({ error: '微信登录失败，请重试', busy: false }),
    });
  },

  async submitAccount() {
    const { authMode, username, password, busy } = this.data;
    if (busy) return;
    if (!username.trim() || password.length < 6) {
      this.setData({ error: authMode === 'register' ? '用户名至少 2 位，密码至少 6 位' : '请输入用户名和密码' });
      return;
    }
    this.setData({ busy: true, error: '' });
    try {
      const path = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const body = authMode === 'register'
        ? { username: username.trim(), password, nickname: username.trim() }
        : { username: username.trim(), password };
      const res = await request(path, { method: 'POST', data: body });
      saveAuth(res);
      wx.reLaunch({ url: '/pages/trips/trips' });
    } catch (err) {
      this.setData({ error: err.message, busy: false });
    }
  },
});
