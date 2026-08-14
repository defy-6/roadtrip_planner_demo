// 行程列表页：我的行程 / 我协作的行程，新建与分享码加入
const { request, getUser, saveAuth } = require('../../utils/request');

const app = getApp();

Page({
  data: {
    user: null,
    mine: [],
    shared: [],
    newName: '',
    joinCode: '',
    loading: true,
    error: '',
    busy: false,
  },

  onShow() {
    if (!require('../../utils/request').getToken()) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    this.setData({ user: getUser() });
    this.loadTrips();
  },

  async loadTrips() {
    this.setData({ loading: true, error: '' });
    try {
      const { trips } = await request('/api/trips');
      const decorate = list => (list || []).map(t => ({ ...t, updatedText: (t.updated_at || '').slice(0, 10) || '—' }));
      this.setData({ mine: decorate(trips.mine), shared: decorate(trips.shared), loading: false });
    } catch (err) {
      this.setData({ error: err.message, loading: false });
    }
  },

  onInput(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
  },

  async createTrip() {
    const name = this.data.newName.trim();
    if (!name || this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      await request('/api/trips', { method: 'POST', data: { name } });
      this.setData({ newName: '', busy: false });
      this.loadTrips();
    } catch (err) {
      this.setData({ error: err.message, busy: false });
    }
  },

  async joinTrip() {
    const code = this.data.joinCode.trim();
    if (!code || this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      await request('/api/trips/join', { method: 'POST', data: { share_code: code } });
      this.setData({ joinCode: '', busy: false });
      this.loadTrips();
    } catch (err) {
      this.setData({ error: err.message, busy: false });
    }
  },

  openTrip(e) {
    const id = e.currentTarget.dataset.id;
    try { wx.setStorageSync('roadtrip-active-trip', id); } catch { /* 忽略 */ }
    wx.navigateTo({ url: `/pages/trip/trip?id=${id}` });
  },

  logout() {
    app.logout();
  },

  // 绑定 web 端账号：当前微信身份关联到已有用户名账号（两端数据互通）
  bindAccount() {
    wx.showModal({
      title: '绑定 web 账号',
      editable: true,
      placeholderText: 'web 端注册的用户名',
      success: res => {
        if (!res.confirm) return;
        const username = (res.content || '').trim();
        if (!username) return;
        wx.showModal({
          title: '输入密码',
          editable: true,
          placeholderText: '该账号的密码',
          success: async res2 => {
            if (!res2.confirm) return;
            this.setData({ busy: true });
            try {
              const result = await request('/api/auth/bind', { method: 'POST', data: { username, password: res2.content || '' } });
              saveAuth(result);
              wx.showToast({ title: '绑定成功', icon: 'success' });
              setTimeout(() => wx.reLaunch({ url: '/pages/trips/trips' }), 600);
            } catch (err) {
              this.setData({ busy: false });
              wx.showToast({ title: err.message, icon: 'none' });
            }
          },
        });
      },
    });
  },
});
