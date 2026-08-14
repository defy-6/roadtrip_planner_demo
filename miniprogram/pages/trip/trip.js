// 行程工作台：时间表 / 地图 / 计划 三视图 + 分享管理
const { request } = require('../../utils/request');

const TYPE_LABELS = {
  spot: '景点', drive: '路程', flight: '航班', transport: '交通',
  food: '餐饮', hotel: '住宿', service: '服务区', fuel: '加油', supply: '补给',
};

const ROUTE_COLORS = ['#075b43', '#4385c8', '#e36b32', '#9168b0', '#c8a438', '#4a7f8f', '#a04f43'];

Page({
  data: {
    id: '',
    name: '',
    role: 'owner',
    updatedText: '—',
    shareEnabled: false,
    shareCode: '',
    activeTab: 'schedule',
    // 时间表
    dates: [],
    activeDate: '',
    events: [],
    // 地图
    mapMarkers: [],
    mapPolylines: [],
    mapPoints: [],
    mapCenter: { longitude: 84.0, latitude: 43.3 },
    mapStats: { distance: '—', duration: '—', count: 0 },
    // 计划
    plans: [],
    activeVersion: '',
    planLoaded: false,
    // 地点
    locLoaded: false,
    allLocations: [],
    filteredLocations: [],
    locSearch: '',
    locType: '',
    loading: true,
    error: '',
    busy: false,
  },

  onLoad(options) {
    this.setData({ id: options.id || '' });
    this.schedule = [];
    this.loadSchedule();
  },

  async loadSchedule() {
    this.setData({ loading: true, error: '' });
    try {
      const res = await request(`/api/trips/${this.data.id}/schedule`);
      this.schedule = res.schedule || [];
      const dates = [...new Set(this.schedule.map(e => e.date).filter(Boolean))].sort();
      this.setData({
        name: res.name || '',
        role: res.role || 'editor',
        updatedText: (res.updated_at || '').slice(0, 10) || '—',
        shareEnabled: !!res.share_enabled,
        shareCode: res.share_code || '',
        dates,
        activeDate: dates[0] || '',
        loading: false,
      });
      this.renderEvents();
    } catch (err) {
      this.setData({ error: err.message, loading: false });
    }
  },

  renderEvents() {
    const { activeDate } = this.data;
    const events = this.schedule
      .map((e, index) => ({ ...e, index }))
      .filter(e => e.date === activeDate)
      .sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')));
    this.setData({ events });
  },

  pickDate(e) {
    this.setData({ activeDate: e.currentTarget.dataset.date });
    this.renderEvents();
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab });
    if (tab === 'map' && !this.data.planLoaded) this.loadPlan();
    if (tab === 'plans' && !this.data.planLoaded) this.loadPlan();
    if (tab === 'places' && !this.data.locLoaded) this.loadLocations();
  },

  // ---------- 地图 ----------
  async loadPlan() {
    this.setData({ error: '' });
    try {
      const res = await request(`/api/trips/${this.data.id}/plan`);
      const plan = res.plan || {};
      const markers = (plan.locations || []).map((l, i) => {
        const [lng, lat] = String(l.resolved && l.resolved.location || '').split(',').map(Number);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
        return {
          id: i, latitude: lat, longitude: lng, width: 20, height: 20,
          callout: { content: l.name || '', display: 'BYCLICK', fontSize: 12, borderRadius: 6, padding: 6, bgColor: '#075b43', color: '#fff' },
        };
      }).filter(Boolean);
      const polylines = (plan.routes || []).map((r, i) => ({
        points: (r.amap && r.amap.steps || []).flatMap(s => String(s.polyline || '').split(';').filter(Boolean).map(pt => {
          const [lng, lat] = pt.split(',').map(Number);
          return { latitude: lat, longitude: lng };
        })),
        color: ROUTE_COLORS[i % ROUTE_COLORS.length],
        width: 4,
        arrowLine: true,
      })).filter(p => p.points.length > 1);
      const meters = (plan.routes || []).reduce((sum, r) => sum + Number((r.amap && r.amap.distance) || 0), 0);
      const seconds = (plan.routes || []).reduce((sum, r) => sum + Number((r.amap && r.amap.duration) || 0), 0);
      const fmtKm = m => m >= 1000 ? `${(m / 1000).toFixed(1)} 公里` : `${m} 米`;
      const fmtDur = s => s >= 3600 ? `${Math.floor(s / 3600)} 小时 ${Math.round(s % 3600 / 60)} 分` : `${Math.round(s / 60)} 分钟`;
      const points = markers.map(m => ({ latitude: m.latitude, longitude: m.longitude }));
      const first = points[0];
      this.setData({
        mapMarkers: markers,
        mapPolylines: polylines,
        mapPoints: points,
        mapCenter: first || this.data.mapCenter,
        mapStats: { distance: fmtKm(meters), duration: fmtDur(seconds), count: (plan.routes || []).length },
        plans: res.plans || [],
        activeVersion: res.activeVersion || '',
        planLoaded: true,
      });
    } catch (err) {
      this.setData({ error: err.message });
    }
  },

  // ---------- 计划 ----------
  async switchPlan(e) {
    const id = e.currentTarget.dataset.id;
    if (id === this.data.activeVersion || this.data.busy) return;
    this.setData({ busy: true });
    try {
      await request(`/api/trips/${this.data.id}/plan`, { method: 'PUT', data: { activeVersion: id } });
      this.setData({ busy: false, planLoaded: false, activeTab: 'schedule' });
      await this.loadSchedule();
      await this.loadPlan();
      wx.showToast({ title: '已切换计划', icon: 'none' });
    } catch (err) {
      this.setData({ busy: false, error: err.message });
    }
  },

  promptNewPlan() {
    wx.showModal({
      title: '新建计划',
      editable: true,
      placeholderText: '计划名称，例如：川西环线',
      success: async res => {
        const name = (res.content || '').trim();
        if (!res.confirm || !name) return;
        this.setData({ busy: true });
        try {
          await request(`/api/trips/${this.data.id}/plans`, { method: 'POST', data: { name } });
          this.setData({ busy: false, planLoaded: false });
          await this.loadSchedule();
          await this.loadPlan();
          wx.showToast({ title: '已创建', icon: 'success' });
        } catch (err) {
          this.setData({ busy: false, error: err.message });
        }
      },
    });
  },

  copyPlan() {
    if (this.data.busy) return;
    wx.showModal({
      title: '复制计划',
      content: '复制当前计划的时间表、地点与路线？',
      success: async res => {
        if (!res.confirm) return;
        this.setData({ busy: true });
        try {
          await request(`/api/trips/${this.data.id}/plans/copy`, { method: 'POST' });
          this.setData({ busy: false, planLoaded: false });
          await this.loadSchedule();
          await this.loadPlan();
          wx.showToast({ title: '已复制', icon: 'success' });
        } catch (err) {
          this.setData({ busy: false, error: err.message });
        }
      },
    });
  },

  promptDeletePlan() {
    const { plans, activeVersion, busy } = this.data;
    if (busy || plans.length <= 1) {
      wx.showToast({ title: '至少保留一个计划', icon: 'none' });
      return;
    }
    const items = plans.filter(p => p.id !== activeVersion).map(p => p.name);
    wx.showActionSheet({
      itemList: items,
      success: async res => {
        const target = plans.filter(p => p.id !== activeVersion)[res.tapIndex];
        wx.showModal({
          title: '删除计划',
          content: `确定删除「${target.name}」？`,
          success: async modal => {
            if (!modal.confirm) return;
            this.setData({ busy: true });
            try {
              await request(`/api/trips/${this.data.id}/plans`, { method: 'DELETE', data: { id: target.id } });
              this.setData({ busy: false, planLoaded: false });
              await this.loadSchedule();
              await this.loadPlan();
              wx.showToast({ title: '已删除', icon: 'success' });
            } catch (err) {
              this.setData({ busy: false, error: err.message });
            }
          },
        });
      },
    });
  },

  // ---------- 事件编辑入口 ----------
  openEdit(e) {
    const index = e.currentTarget.dataset.index;
    wx.navigateTo({ url: `/pages/event-edit/event-edit?id=${this.data.id}&date=${this.data.activeDate}&index=${index}` });
  },

  addEvent() {
    wx.navigateTo({ url: `/pages/event-edit/event-edit?id=${this.data.id}&date=${this.data.activeDate}&index=-1` });
  },

  typeLabel(type) {
    return TYPE_LABELS[type] || '其他';
  },

  // ---------- 分享 ----------
  async toggleShare() {
    const { id, busy, shareEnabled } = this.data;
    if (busy) return;
    this.setData({ busy: true });
    try {
      const { trip } = await request(`/api/trips/${id}/share`, { method: 'POST', data: { enabled: !shareEnabled } });
      this.setData({ shareEnabled: !!trip.share_enabled, shareCode: trip.share_code || '', busy: false });
      wx.showToast({ title: trip.share_enabled ? '已开启分享' : '已关闭分享', icon: 'none' });
    } catch (err) {
      this.setData({ busy: false, error: err.message });
    }
  },

  copyCode() {
    const code = this.data.shareCode;
    if (!code) return;
    wx.setClipboardData({ data: code, success: () => wx.showToast({ title: '分享码已复制', icon: 'none' }) });
  },

  // ---------- 地点库 ----------
  async loadLocations() {
    this.setData({ error: '' });
    try {
      const res = await request(`/api/trips/${this.data.id}/locations`);
      this.allLocations = res.locations || [];
      this.setData({ locLoaded: true });
      this.renderLocations();
    } catch (err) {
      this.setData({ error: err.message });
    }
  },

  renderLocations() {
    const { locSearch, locType } = this.data;
    const kw = locSearch.trim().toLowerCase();
    const filtered = this.allLocations.filter(l => {
      if (locType && l.type !== locType) return false;
      if (kw && !(l.name || '').toLowerCase().includes(kw) && !(l.address || '').toLowerCase().includes(kw)) return false;
      return true;
    });
    this.setData({ filteredLocations: filtered });
  },

  onLocSearch(e) {
    this.setData({ locSearch: e.detail.value });
    this.renderLocations();
  },

  onLocType(e) {
    this.setData({ locType: e.currentTarget.dataset.type });
    this.renderLocations();
  },

  openLocation(e) {
    const locationId = e.currentTarget.dataset.id || '';
    wx.navigateTo({ url: `/pages/location-edit/location-edit?id=${this.data.id}&locationId=${locationId}` });
  },

  addLocation() {
    wx.navigateTo({ url: `/pages/location-edit/location-edit?id=${this.data.id}&locationId=` });
  },

  // ---------- 行程改名 ----------
  renameTrip() {
    wx.showModal({
      title: '重命名行程',
      editable: true,
      placeholderText: '行程名称',
      content: this.data.name,
      success: async res => {
        const name = (res.content || '').trim();
        if (!res.confirm || !name || name === this.data.name) return;
        this.setData({ busy: true });
        try {
          await request(`/api/trips/${this.data.id}`, { method: 'PUT', data: { name } });
          this.setData({ name, busy: false });
          wx.showToast({ title: '已重命名', icon: 'success' });
        } catch (err) {
          this.setData({ busy: false, error: err.message });
        }
      },
    });
  },

  // ---------- 账本 ----------
  openExpenses() {
    wx.navigateTo({ url: `/pages/expense/expense?id=${this.data.id}` });
  },

  // ---------- 天气 ----------
  async showWeather() {
    const date = this.data.activeDate;
    if (!date) {
      wx.showToast({ title: '请先选择日期', icon: 'none' });
      return;
    }
    if (!this.data.planLoaded) await this.loadPlan();
    const first = this.data.mapMarkers[0];
    if (!first) {
      wx.showToast({ title: '行程暂无可用地点坐标', icon: 'none' });
      return;
    }
    try {
      const res = await request('/api/weather', {
        data: { latitude: String(first.latitude), longitude: String(first.longitude), date },
      });
      wx.showModal({
        title: `${date} 天气`,
        content: `${res.conditionText || '未知'} · ${res.temperature != null ? `${res.temperature}°C` : '—'}\n降水概率 ${res.precipitationProbability != null ? `${res.precipitationProbability}%` : '—'} · 风速 ${res.windSpeed != null ? `${res.windSpeed} km/h` : '—'}`,
        showCancel: false,
      });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  // ---------- 保存地图截图 ----------
  saveMap() {
    const ctx = wx.createMapContext('tripMap', this);
    ctx.snapshot({
      success: res => {
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
          fail: () => wx.showToast({ title: '保存失败（需相册权限）', icon: 'none' }),
        });
      },
      fail: () => wx.showToast({ title: '截图失败', icon: 'none' }),
    });
  },
});
