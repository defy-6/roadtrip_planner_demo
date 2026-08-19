// 行程工作台：时间表 / 地图 / 计划 三视图 + 分享管理
const { request } = require('../../utils/request');

const TYPE_LABELS = {
  spot: '景点', drive: '路程', flight: '航班', transport: '交通',
  food: '餐饮', hotel: '住宿', service: '服务区', fuel: '加油', supply: '补给',
};

const ROUTE_COLORS = ['#075b43', '#4385c8', '#e36b32', '#9168b0', '#c8a438', '#4a7f8f', '#a04f43'];

// 按天着色：同日多段由深到浅（amt 为负变深）
function shadeColor(hex, amt) {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + amt));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amt));
  const b = Math.min(255, Math.max(0, (num & 0xff) + amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

Page({
    data: {
      id: '',
      name: '',
      role: 'owner',
      updatedText: '—',
      shareEnabled: false,
      shareReadonly: false,
      shareCode: '',
      isEditable: true,
      activeTab: 'schedule',
      locManage: false,
      selectedLocIds: [],
    // 时间表
    dates: [],
    activeDate: '',
    events: [],
    timeline: [],
    timelineHours: [],
    timelineBlocks: [],
    timelineHeight: 1400,
    gridDays: [],
    hourLabels: ['07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00'],
    scheduleView: 'list',
    canUndo: false,
    canRedo: false,
    multiMode: false,
    selectedEvents: [],
    // 地图
    mapMarkers: [],
    mapPolylines: [],
    mapPoints: [],
    mapCenter: { longitude: 84.0, latitude: 43.3 },
    mapStats: { distance: '—', duration: '—', count: 0 },
    mapDate: '',
    mapDates: [],
    mapRoutes: [],
    mapLegend: [],
    dailySummary: [],
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
    placeTab: 'plan',
    universalLocations: [],
    loading: true,
    error: '',
    busy: false,
  },

  onLoad(options) {
    this.setData({ id: options.id || '' });
    this.schedule = [];
    this.undoStack = [];
    this.redoStack = [];
    this.prevSchedule = null;
  },

  // 每次显示都刷新（首次 + 从编辑页返回），保证编辑结果立即可见
  onShow() {
    if (this.data.id) this.loadSchedule();
  },

  // 计划切换/新建/复制/删除后调用：重置撤销栈（避免把切换前的旧计划压栈）
  resetHistory() {
    this.undoStack = [];
    this.redoStack = [];
    this.prevSchedule = null;
    this.setData({ canUndo: false, canRedo: false });
  },

  async loadSchedule() {
    this.setData({ loading: true, error: '' });
    try {
      const res = await request(`/api/trips/${this.data.id}/schedule`);
      const next = res.schedule || [];
      // 变化检测：子页面保存返回后进入撤销栈（保留最近 20 步）
      if (this.prevSchedule && JSON.stringify(this.prevSchedule) !== JSON.stringify(next)) {
        this.undoStack.push(this.prevSchedule);
        if (this.undoStack.length > 20) this.undoStack.shift();
        this.redoStack = [];
      }
      this.prevSchedule = JSON.parse(JSON.stringify(next));
      this.schedule = next;
      const dates = [...new Set(next.map(e => e.date).filter(Boolean))].sort();
      this.setData({
        name: res.name || '',
        role: res.role || 'editor',
        isEditable: res.role !== 'viewer',
        updatedText: (res.updated_at || '').slice(0, 10) || '—',
        shareEnabled: !!res.share_enabled,
        shareReadonly: !!res.share_readonly,
        shareCode: res.share_code || '',
        dates,
        activeDate: dates[0] || '',
        canUndo: this.undoStack.length > 0,
        canRedo: this.redoStack.length > 0,
        loading: false,
      });
      this.renderEvents();
      // 地图可能依赖刚加载的 schedule 路线
      if (this.data.activeTab === 'map') this.renderMap();
    } catch (err) {
      this.setData({ error: err.message, loading: false });
    }
  },

  async undo() {
    if (!this.undoStack.length || this.data.busy) return;
    const prev = this.undoStack.pop();
    this.redoStack.push(this.prevSchedule);
    const ok = await this.putSchedule(prev);
    if (!ok) {
      this.undoStack.push(prev);
      this.redoStack.pop();
    }
    this.setData({ canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0 });
  },

  async redo() {
    if (!this.redoStack.length || this.data.busy) return;
    const next = this.redoStack.pop();
    this.undoStack.push(this.prevSchedule);
    const ok = await this.putSchedule(next);
    if (!ok) {
      this.redoStack.push(next);
      this.undoStack.pop();
    }
    this.setData({ canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0 });
  },

  async putSchedule(schedule) {
    this.setData({ busy: true });
    try {
      await request(`/api/trips/${this.data.id}/schedule`, { method: 'PUT', data: { schedule } });
      this.prevSchedule = JSON.parse(JSON.stringify(schedule));
      this.schedule = schedule;
      this.setData({ canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0, busy: false });
      this.renderEvents();
      return true;
    } catch (err) {
      this.setData({ busy: false, error: err.message });
      return false;
    }
  },

  renderEvents() {
    const { activeDate, scheduleView } = this.data;
    const dayEvents = this.schedule
      .map((e, index) => {
        const ri = e.routeInfo;
        const wt = e.weather ? ` · ${e.weather.text}${e.weather.temp ? ` ${e.weather.temp}°` : ''}` : '';
        const pt = e.price ? ` · ¥${e.price}` : '';
        return {
          ...e,
          index,
          hh: Number(String(e.start || '').slice(0, 2)) || 0,
          routeText: e.type === 'drive' && ri ? `${ri.distanceText} · ${ri.durationText}` : '',
          weatherText: wt,
          priceText: pt,
        };
      })
      .filter(e => e.date === activeDate)
      .sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')));
    this.setData({ events: dayEvents });
    if (scheduleView === 'timeline') this.renderTimeline(dayEvents);
    if (scheduleView === 'grid') this.renderGrid();
  },

  // 日历网格：多日并排 + 事件按起止绝对定位 + 重叠分列
  renderGrid() {
    const dates = [...new Set(this.schedule.map(e => e.date).filter(Boolean))].sort();
    const HOUR_START = 7;
    const HOUR_END = 23;
    const TOTAL_MIN = (HOUR_END - HOUR_START) * 60;
    const COL_H = 1680; // 16 小时 × 105px
    const toMin = t => {
      const [h, m] = String(t || '00:00').split(':').map(Number);
      return (h || 0) * 60 + (m || 0);
    };
    const days = dates.map(date => {
      const evs = this.schedule
        .map((e, index) => ({ ...e, index }))
        .filter(e => e.date === date)
        .map(e => {
          const startMin = toMin(e.start);
          const endMin = toMin(e.end) || startMin + 60;
          const ri = e.routeInfo;
          const wt = e.weather ? ` ${e.weather.text}${e.weather.temp ? ` ${e.weather.temp}°` : ''}` : '';
          const pt = e.price ? ` ¥${e.price}` : '';
          return {
            ...e,
            top: ((startMin - HOUR_START * 60) / TOTAL_MIN) * COL_H,
            height: Math.max(((endMin - startMin) / TOTAL_MIN) * COL_H, 40),
            infoText: [e.type === 'drive' && ri ? ri.distanceText : '', wt, pt].filter(Boolean).join(' · '),
          };
        })
        .sort((a, b) => a.top - b.top || String(a.start).localeCompare(String(b.start)));
      // 重叠分列（贪心 lanes）
      const lanes = [];
      evs.forEach(ev => {
        let placed = false;
        for (const lane of lanes) {
          if (lane.end <= ev.top) {
            lane.end = ev.top + ev.height;
            lane.items.push(ev);
            placed = true;
            break;
          }
        }
        if (!placed) lanes.push({ end: ev.top + ev.height, items: [ev] });
      });
      return { date, lanes };
    });
    // 全局最大并发列数统一分宽（避免短 lane 事件视觉重叠）
    const maxLane = Math.max(1, ...days.map(d => d.lanes.length));
    days.forEach(day => {
      day.events = day.lanes.flatMap(lane => lane.items.map((ev, ei) => ({
        ...ev,
        left: (ei / maxLane) * 100,
        width: 100 / maxLane,
      })));
      delete day.lanes;
    });
    this.setData({ gridDays: days });
  },

  // 时间轴视图：单日垂直时间轴（小时刻度 + 事件按起止绝对定位 + 重叠分列）
  renderTimeline(dayEvents) {
    const HOUR_START = 7;
    const HOUR_END = 23;
    const TOTAL_MIN = (HOUR_END - HOUR_START) * 60;
    const HOUR_H = 88;
    const COL_H = (TOTAL_MIN * HOUR_H) / 60;
    const toMin = t => {
      const [h, m] = String(t || '00:00').split(':').map(Number);
      return (h || 0) * 60 + (m || 0);
    };
    const evs = dayEvents
      .map(e => {
        const startMin = toMin(e.start);
        const endMin = toMin(e.end) || startMin + 60;
        const ri = e.routeInfo;
        const wt = e.weather ? ` ${e.weather.text}${e.weather.temp ? ` ${e.weather.temp}°` : ''}` : '';
        const pt = e.price ? ` ¥${e.price}` : '';
        return {
          ...e,
          top: ((startMin - HOUR_START * 60) / TOTAL_MIN) * COL_H,
          height: Math.max(((endMin - startMin) / TOTAL_MIN) * COL_H, 36),
          infoText: [e.type === 'drive' && ri ? ri.distanceText : '', wt, pt].filter(Boolean).join(' · '),
        };
      })
      .sort((a, b) => a.top - b.top || String(a.start).localeCompare(String(b.start)));
    // 重叠分列
    const lanes = [];
    evs.forEach(ev => {
      let placed = false;
      for (const lane of lanes) {
        if (lane.end <= ev.top) {
          lane.end = ev.top + ev.height;
          lane.items.push(ev);
          placed = true;
          break;
        }
      }
      if (!placed) lanes.push({ end: ev.top + ev.height, items: [ev] });
    });
    const maxLane = Math.max(1, ...lanes.map(l => l.items.length));
    const events = lanes.flatMap(l => l.items.map((ev, ei) => ({
      ...ev,
      left: (ei / maxLane) * 100,
      width: 100 / maxLane,
    })));
    const hours = [];
    for (let h = HOUR_START; h <= HOUR_END; h += 1) {
      hours.push({ label: `${String(h).padStart(2, '0')}:00`, top: ((h - HOUR_START) / TOTAL_MIN) * COL_H });
    }
    this.setData({ timelineHours: hours, timelineBlocks: events, timelineHeight: COL_H });
  },

  switchScheduleView(e) {
    const view = e.currentTarget.dataset.view;
    this.setData({ scheduleView: view });
    this.renderEvents();
  },

  pickDate(e) {
    this.setData({ activeDate: e.currentTarget.dataset.date });
    this.renderEvents();
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab });
    if (tab === 'map') {
      // 确保数据就绪后渲染地图（各加载器完成后也会各自 renderMap）
      if (!this.data.planLoaded) this.loadPlan();
      if (!this.data.locLoaded) this.loadLocations();
      this.renderMap();
    }
    if (tab === 'plans' && !this.data.planLoaded) this.loadPlan();
    if (tab === 'places' && !this.data.locLoaded) this.loadLocations();
  },

  // 地图：标记来自地点库，路线来自时间表 drive 事件 + 历史 plan.routes（支持日期筛选）
  renderMap() {
    const { mapDate } = this.data;
    const driveEvents = this.schedule
      .map((e, index) => ({ ...e, index }))
      .filter(e => e.type === 'drive' && e.routeInfo && Array.isArray(e.routeInfo.polyline) && e.routeInfo.polyline.length > 1)
      .filter(e => !mapDate || e.date === mapDate);
    const fmtKm = m => m >= 1000 ? `${(m / 1000).toFixed(1)} 公里` : `${m} 米`;
    const fmtDur = s => s >= 3600 ? `${Math.floor(s / 3600)} 小时 ${Math.round(s % 3600 / 60)} 分` : `${Math.round(s / 60)} 分钟`;
    // 按天着色：同日多段由深到浅；历史路线用基础色轮换
    const dayColorIndex = {};
    const schedulePolylines = driveEvents.map((e, i) => {
      if (dayColorIndex[e.date] == null) dayColorIndex[e.date] = 0;
      const base = ROUTE_COLORS[Object.keys(dayColorIndex).indexOf(e.date) % ROUTE_COLORS.length];
      const depth = -Math.min(dayColorIndex[e.date] * 18, 120);
      dayColorIndex[e.date] += 1;
      return {
        points: e.routeInfo.polyline,
        color: shadeColor(base, depth),
        width: 4,
        arrowLine: true,
      };
    });
    // 历史路线（web 端计算）：仅"全部"时并入
    const legacy = !mapDate ? (this.planRoutes || []) : [];
    const polylines = [...legacy, ...schedulePolylines];
    const meters = driveEvents.reduce((s, e) => s + Number(e.routeInfo.distance || 0), 0)
      + (mapDate ? 0 : (this.legacyRouteStats ? this.legacyRouteStats.meters : 0));
    const seconds = driveEvents.reduce((s, e) => s + Number(e.routeInfo.duration || 0), 0)
      + (mapDate ? 0 : (this.legacyRouteStats ? this.legacyRouteStats.seconds : 0));
    const count = driveEvents.length + (mapDate ? 0 : (this.legacyRouteStats ? this.legacyRouteStats.count : 0));
    // 航班航线（起降机场连虚线，需地点库坐标）
    const flightRoutes = this.schedule
      .map((e, index) => ({ ...e, index }))
      .filter(e => e.type === 'flight' && e.flightInfo && (!mapDate || e.date === mapDate))
      .map(e => {
        const dep = this.allLocations.find(l => l.resolved && l.type === 'flight' && l.name.includes(e.flightInfo.departureAirport));
        const arr = this.allLocations.find(l => l.resolved && l.type === 'flight' && l.name.includes(e.flightInfo.arrivalAirport));
        if (!dep || !arr) return null;
        const toPt = loc => {
          const [lng, lat] = String(loc.resolved.location || '').split(',').map(Number);
          return { latitude: lat, longitude: lng };
        };
        return { points: [toPt(dep), toPt(arr)], color: '#8a8f98', width: 2, arrowLine: true, dashArray: [6, 4] };
      })
      .filter(Boolean);
    // 图例（日期 → 颜色）
    const legend = [];
    if (!mapDate) {
      Object.keys(dayColorIndex).forEach(date => {
        legend.push({ color: ROUTE_COLORS[Object.keys(dayColorIndex).indexOf(date) % ROUTE_COLORS.length], label: date.slice(5) });
      });
    }
    if (flightRoutes.length) legend.push({ color: '#8a8f98', label: '航班航线' });
    // 路线顺序徽章（marker 标注序号，放各路线起点）
    const badgeMarkers = schedulePolylines.map((p, i) => ({
      id: 1000 + i,
      latitude: p.points[0].latitude,
      longitude: p.points[0].longitude,
      width: 22,
      height: 22,
      label: { content: String(i + 1), fontSize: 12, fontWeight: 'bold', borderRadius: 999, padding: 4, bgColor: '#075b43', color: '#ffffff', anchorX: -6, anchorY: -30 },
    }));
    // 分日汇总（全部视图下显示）
    const daily = {};
    driveEvents.forEach(e => {
      const d = e.date || '未排期';
      daily[d] = daily[d] || { date: d, meters: 0, seconds: 0, count: 0 };
      daily[d].meters += Number(e.routeInfo.distance || 0);
      daily[d].seconds += Number(e.routeInfo.duration || 0);
      daily[d].count += 1;
    });
    const dailySummary = Object.values(daily).sort((a, b) => String(a.date).localeCompare(String(b.date))).map(d => ({
      ...d,
      distance: d.meters >= 1000 ? `${(d.meters / 1000).toFixed(1)} 公里` : `${d.meters} 米`,
      duration: fmtDur(d.seconds),
    }));
    this.setData({
      dailySummary,
      mapPolylines: [...legacy, ...schedulePolylines, ...flightRoutes],
      mapLegend: legend,
      mapRoutes: driveEvents.map(e => ({
        index: e.index, title: e.title, date: e.date,
        distanceText: e.routeInfo.distanceText || fmtKm(Number(e.routeInfo.distance || 0)),
        durationText: e.routeInfo.durationText || fmtDur(Number(e.routeInfo.duration || 0)),
        tolls: Number(e.routeInfo.tolls || 0),
      })),
      mapStats: { distance: fmtKm(meters), duration: fmtDur(seconds), count },
      mapDates: [...new Set(this.schedule.map(ev => ev.date).filter(Boolean))].sort(),
    });
  },

  pickMapDate(e) {
    this.setData({ mapDate: e.currentTarget.dataset.date });
    this.renderMap();
  },

  openRouteEvent(e) {
    const index = e.currentTarget.dataset.index;
    wx.navigateTo({ url: `/pages/event-edit/event-edit?id=${this.data.id}&date=${this.data.mapDate || ''}&index=${index}` });
  },

  newRoute() {
    wx.navigateTo({ url: `/pages/event-edit/event-edit?id=${this.data.id}&date=${this.data.mapDate || this.data.activeDate || ''}&index=-1&type=drive` });
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
          id: i, latitude: lat, longitude: lng,
          width: l.photo ? 44 : 20,
          height: l.photo ? 44 : 20,
          cornerRadius: 6,
          iconPath: l.photo || '',
          label: { content: l.type || '', fontSize: 10, borderRadius: 4, padding: 2, bgColor: '#ffffff', color: '#5a6472', anchorX: -8, anchorY: -28 },
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
      // 历史路线（web 端计算存于 plan.routes，无日期关联）：仅"全部"时显示
      this.planRoutes = polylines;
      this.legacyRouteStats = (plan.routes || []).reduce((acc, r) => {
        acc.meters += Number((r.amap && r.amap.distance) || 0);
        acc.seconds += Number((r.amap && r.amap.duration) || 0);
        acc.count += 1;
        return acc;
      }, { meters: 0, seconds: 0, count: 0 });
      const points = markers.map(m => ({ latitude: m.latitude, longitude: m.longitude }));
      const first = points[0];
      this.setData({
        mapMarkers: markers,
        mapPoints: points,
        mapCenter: first || this.data.mapCenter,
        plans: res.plans || [],
        activeVersion: res.activeVersion || '',
        planLoaded: true,
      });
      this.renderMap();
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
      this.resetHistory();
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
          this.resetHistory();
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
          this.resetHistory();
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
              this.resetHistory();
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
    const { id, busy, shareEnabled, shareReadonly } = this.data;
    if (busy) return;
    this.setData({ busy: true });
    try {
      const { trip } = await request(`/api/trips/${id}/share`, { method: 'POST', data: { enabled: !shareEnabled, readonly: shareReadonly } });
      this.setData({ shareEnabled: !!trip.share_enabled, shareReadonly: !!trip.share_readonly, shareCode: trip.share_code || '', busy: false });
      wx.showToast({ title: trip.share_enabled ? '已开启分享' : '已关闭分享', icon: 'none' });
    } catch (err) {
      this.setData({ busy: false, error: err.message });
    }
  },

  async toggleReadonly(e) {
    const readonly = e.detail.value;
    this.setData({ shareReadonly: readonly });
    try {
      const { trip } = await request(`/api/trips/${this.data.id}/share`, { method: 'POST', data: { enabled: true, readonly } });
      this.setData({ shareReadonly: !!trip.share_readonly });
      wx.showToast({ title: readonly ? '已设为只读分享' : '已设为可编辑分享', icon: 'none' });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
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
      // 地图依赖地点库（照片标记/航班航线）
      if (this.data.activeTab === 'map') this.renderMap();
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

  // 通用地点库
  switchPlaceTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ placeTab: tab });
    if (tab === 'univ' && !this.data.univLoaded) this.loadUniversal();
  },

  async loadUniversal() {
    try {
      const res = await request(`/api/trips/${this.data.id}/universal`);
      this.setData({ universalLocations: res.locations || [], univLoaded: true });
    } catch (err) {
      this.setData({ error: err.message });
    }
  },

  async addFromUniversal(e) {
    if (!this.data.isEditable) return;
    const locationId = e.currentTarget.dataset.id;
    try {
      await request(`/api/trips/${this.data.id}/universal`, { method: 'POST', data: { locationId } });
      wx.showToast({ title: '已添加到当前计划', icon: 'success' });
      // 刷新当前计划地点列表
      this.allLocations = [];
      this.setData({ locLoaded: false, placeTab: 'plan' });
      await this.loadLocations();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  // 新增自定义地点分类（名称 + 选颜色）
  addCategory() {
    wx.showModal({
      title: '新增地点分类',
      editable: true,
      placeholderText: '分类名称，例如：加油站',
      success: res => {
        const name = (res.content || '').trim();
        if (!res.confirm || !name) return;
        const colorNames = ['紫', '金', '青', '棕', '蓝', '洋红'];
        const colorValues = ['#7a5aa8', '#c8a438', '#4a7f8f', '#a04f43', '#2f73a9', '#9168b0'];
        wx.showActionSheet({
          itemList: colorNames,
          success: async colorRes => {
            try {
              const cur = await request(`/api/trips/${this.data.id}/categories`);
              const categories = [...(cur.categories || [])];
              if (categories.some(c => c.name === name)) {
                wx.showToast({ title: '分类已存在', icon: 'none' });
                return;
              }
              categories.push({ id: `cat-${Date.now()}`, name, color: colorValues[colorRes.tapIndex] || colorValues[0] });
              await request(`/api/trips/${this.data.id}/categories`, { method: 'PUT', data: { categories } });
              wx.showToast({ title: '已添加分类', icon: 'success' });
            } catch (err) {
              wx.showToast({ title: err.message, icon: 'none' });
            }
          },
        });
      },
    });
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

  // ---------- 批量更新天气 ----------
  async batchWeather() {
    const date = this.data.activeDate;
    if (!date) {
      wx.showToast({ title: '请先选择日期', icon: 'none' });
      return;
    }
    if (!this.data.locLoaded) await this.loadLocations();
    const dayEvents = this.schedule.filter(e => e.date === date);
    const locs = this.allLocations;
    const queryWeather = async (loc, d) => {
      if (!loc || !loc.resolved) return null;
      const [lng, lat] = String(loc.resolved.location || '').split(',').map(Number);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
      try {
        const w = await request('/api/weather', { data: { latitude: String(lat), longitude: String(lng), date: d } });
        return { text: w.conditionText || '', temp: w.temperature != null ? String(w.temperature) : '' };
      } catch { return null; }
    };
    let updated = 0;
    for (const ev of dayEvents) {
      let weather = null;
      if (ev.type === 'drive') {
        // 多段查询：起点 + 终点各查一次
        const dep = locs.find(l => l.resolved && (l.name === (ev.originName || ev.origin) || (ev.originAddress && (l.name === ev.originAddress || l.address === ev.originAddress))));
        const arr = locs.find(l => l.resolved && (l.name === (ev.destinationName || ev.destination) || (ev.destinationAddress && (l.name === ev.destinationAddress || l.address === ev.destinationAddress))));
        const depW = await queryWeather(dep, date);
        const arrW = await queryWeather(arr, date);
        if (depW || arrW) {
          const parts = [];
          if (depW) parts.push(`出发 ${depW.text}${depW.temp ? ` ${depW.temp}°` : ''}`);
          if (arrW) parts.push(`到达 ${arrW.text}${arrW.temp ? ` ${arrW.temp}°` : ''}`);
          weather = { text: parts.join(' · '), temp: '' };
        }
      } else {
        // flight 按起降机场、其余按标题/地址
        let loc = null;
        if (ev.type === 'flight' && ev.flightInfo) {
          loc = locs.find(l => l.resolved && l.type === 'flight' && (
            l.name.includes(ev.flightInfo.departureAirport) || l.name.includes(ev.flightInfo.arrivalAirport)));
        }
        if (!loc) {
          loc = locs.find(l => (ev.address && (l.name === ev.address || l.address === ev.address)) || l.name === ev.title);
        }
        const w = await queryWeather(loc, date);
        if (w) weather = w;
      }
      if (weather) {
        ev.weather = weather;
        updated += 1;
      }
    }
    if (updated > 0) {
      await request(`/api/trips/${this.data.id}/schedule`, { method: 'PUT', data: { schedule: this.schedule } });
      this.renderEvents();
    }
    wx.showToast({ title: `已更新 ${updated} 个事件天气`, icon: 'none' });
  },

  // ---------- 导出 JSON（云存储 → 下载分享） ----------
  exportJson() {
    wx.showLoading({ title: '正在导出…' });
    request(`/api/trips/${this.data.id}/export`, { method: 'POST' })
      .then(async res => {
        if (!res.fileID) throw new Error('导出失败');
        const dl = await wx.cloud.downloadFile({ fileID: res.fileID });
        wx.hideLoading();
        wx.shareFileMessage({
          filePath: dl.tempFilePath,
          fileName: `${this.data.name || '行程'}.json`,
          success: () => wx.showToast({ title: '已分享', icon: 'success' }),
          fail: () => wx.showModal({ title: '导出成功', content: '文件已生成（可到云存储 console 下载）', showCancel: false }),
        });
      })
      .catch(err => {
        wx.hideLoading();
        wx.showToast({ title: err.message, icon: 'none' });
      });
  },

  // ---------- 航班导入 ----------
  openFlightImport() {
    wx.navigateTo({ url: `/pages/flight-import/flight-import?id=${this.data.id}` });
  },

  // ---------- 批量地点（选择模式 → 删除选中） ----------
  toggleLocManage() {
    this.setData({ locManage: !this.data.locManage, selectedLocIds: [] });
  },

  toggleLocSelect(e) {
    const locationId = e.currentTarget.dataset.id;
    const selected = this.data.selectedLocIds.slice();
    const idx = selected.indexOf(locationId);
    if (idx >= 0) selected.splice(idx, 1);
    else selected.push(locationId);
    this.setData({ selectedLocIds: selected });
  },

  deleteSelectedLocations() {
    const { selectedLocIds } = this.data;
    if (!selectedLocIds.length) return;
    wx.showModal({
      title: '批量删除',
      content: `确定删除选中的 ${selectedLocIds.length} 个地点？`,
      success: async res => {
        if (!res.confirm) return;
        try {
          const remaining = this.allLocations.filter(l => !selectedLocIds.includes(l.id));
          await request(`/api/trips/${this.data.id}/locations`, { method: 'PUT', data: { locations: remaining } });
          this.allLocations = remaining;
          this.setData({ locManage: false, selectedLocIds: [] });
          this.renderLocations();
          wx.showToast({ title: '已删除', icon: 'success' });
        } catch (err) {
          wx.showToast({ title: err.message, icon: 'none' });
        }
      },
    });
  },

  async saveLocations() {
    await request(`/api/trips/${this.data.id}/locations`, { method: 'PUT', data: { locations: this.allLocations } });
  },

  // 批量查询位置：选中地点逐个 geocode 回填坐标
  async batchGeocode() {
    const selected = this.allLocations.filter(l => this.data.selectedLocIds.includes(l.id));
    if (!selected.length) return;
    wx.showLoading({ title: '正在查询位置…' });
    let ok = 0;
    for (const loc of selected) {
      try {
        const res = await request('/api/geocode', { data: { address: loc.name, keyword: loc.address || loc.name } });
        const pois = (res && res.pois) || [];
        const first = pois.find(p => p.location);
        if (first && first.location) {
          loc.resolved = { name: first.name || loc.name, location: first.location };
          ok += 1;
        }
      } catch { /* 单条失败跳过 */ }
    }
    await this.saveLocations();
    wx.hideLoading();
    wx.showToast({ title: `已更新 ${ok} 个地点位置`, icon: 'none' });
    this.setData({ locManage: false, selectedLocIds: [] });
    this.renderLocations();
  },

  // 批量获取图片：选中地点逐个 place-photos 取首图
  async batchFetchPhotos() {
    const selected = this.allLocations.filter(l => this.data.selectedLocIds.includes(l.id));
    if (!selected.length) return;
    wx.showLoading({ title: '正在获取图片…' });
    let ok = 0;
    for (const loc of selected) {
      if (!loc.address) continue;
      try {
        const res = await request('/api/place-photos', { data: { name: loc.name, address: loc.address } });
        const photos = (res && res.photos) || [];
        if (photos[0] && photos[0].url) {
          loc.photo = photos[0].url;
          loc.photoSource = '高德';
          ok += 1;
        }
      } catch { /* 单条失败跳过 */ }
    }
    await this.saveLocations();
    wx.hideLoading();
    wx.showToast({ title: `已获取 ${ok} 个地点图片`, icon: 'none' });
    this.setData({ locManage: false, selectedLocIds: [] });
    this.renderLocations();
  },

  // 文本批量新增：每行「类型｜名称｜地址」
  batchAddPlaces() {
    wx.showModal({
      title: '批量新增地点',
      editable: true,
      placeholderText: '每行一条：类型｜名称｜地址\n例如：景点｜赛里木湖｜博尔塔拉',
      success: async res => {
        if (!res.confirm || !(res.content || '').trim()) return;
        const lines = (res.content || '').split('\n').map(l => l.trim()).filter(Boolean);
        const typeMap = { 景点: 'spot', 饮食: 'food', 餐饮: 'food', 住宿: 'hotel', 购物: 'shopping', 加油: 'fuel', 服务区: 'service', 补给: 'supply', 机场: 'flight', 交通: 'transport', 地名: 'geography', 路程: 'drive' };
        const created = [];
        lines.forEach(line => {
          const [typeRaw, name, address] = line.split('｜');
          if (!name) return;
          created.push({
            id: `loc-${Date.now()}-${Math.floor(Math.random() * 1e6)}-${created.length}`,
            type: typeMap[(typeRaw || '').trim()] || 'spot',
            name: name.trim(),
            address: (address || '').trim(),
            note: '',
          });
        });
        if (!created.length) {
          wx.showToast({ title: '没有识别到有效行', icon: 'none' });
          return;
        }
        this.allLocations = [...this.allLocations, ...created];
        await this.saveLocations();
        this.setData({ locManage: false, selectedLocIds: [] });
        this.renderLocations();
        wx.showToast({ title: `已新增 ${created.length} 个地点`, icon: 'success' });
      },
    });
  },

  // ---------- 时间表 PNG 导出（canvas 绘制全部日期 → 保存相册） ----------
  exportSchedulePng() {
    const all = this.schedule;
    if (!all.length) {
      wx.showToast({ title: '还没有事件', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '正在生成图片…' });
    const query = wx.createSelectorQuery().in(this);
    query.select('#scheduleCanvas').fields({ node: true, size: true }).exec(res => {
      if (!res || !res[0] || !res[0].node) {
        wx.hideLoading();
        wx.showToast({ title: '生成失败', icon: 'none' });
        return;
      }
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const dpr = wx.getWindowInfo().pixelRatio;
      const W = 750;
      const rowH = 96;
      const headerH = 160;
      const dateH = 56;
      const groups = {};
      all.forEach(e => { (groups[e.date || '未排期'] = groups[e.date || '未排期'] || []).push(e); });
      const dates = Object.keys(groups).sort();
      const H = headerH + dates.length * dateH + all.length * rowH + 60;
      if (H > 3800) {
        wx.hideLoading();
        wx.showToast({ title: '事件过多，请按天导出（日历视图导出单日）', icon: 'none' });
        return;
      }
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = '#fbfaf6';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#075b43';
      ctx.font = 'bold 40px sans-serif';
      ctx.fillText(this.data.name || '行程', 40, 70);
      ctx.fillStyle = '#5a6472';
      ctx.font = '24px sans-serif';
      ctx.fillText(`${dates.length} 天 · 共 ${all.length} 个事件`, 40, 112);
      let y = headerH;
      dates.forEach(date => {
        ctx.fillStyle = '#075b43';
        ctx.font = 'bold 30px sans-serif';
        ctx.fillText(date, 40, y + 36);
        y += dateH;
        groups[date].forEach(ev => {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(40, y, W - 80, rowH - 16);
          ctx.fillStyle = '#1f2733';
          ctx.font = 'bold 28px sans-serif';
          ctx.fillText(`${ev.start || '--:--'}${ev.end ? `-${ev.end}` : ''}`, 56, y + 44);
          ctx.fillStyle = '#1f2733';
          ctx.font = '28px sans-serif';
          ctx.fillText(String(ev.title || '').slice(0, 20), 220, y + 44);
          const ri = ev.routeInfo;
          const detail = [
            ev.type === 'drive' && ri ? ri.distanceText : '',
            ev.weather ? `${ev.weather.text}${ev.weather.temp ? ` ${ev.weather.temp}°` : ''}` : '',
            ev.price ? `¥${ev.price}` : '',
          ].filter(Boolean).join(' · ').slice(0, 30);
          if (detail) {
            ctx.fillStyle = '#8892a0';
            ctx.font = '22px sans-serif';
            ctx.fillText(detail, 220, y + 74);
          }
          y += rowH;
        });
      });
      wx.canvasToTempFilePath({
        canvas,
        success: tmp => {
          wx.hideLoading();
          wx.saveImageToPhotosAlbum({
            filePath: tmp.tempFilePath,
            success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
            fail: () => wx.showToast({ title: '保存失败（需相册权限）', icon: 'none' }),
          });
        },
        fail: () => {
          wx.hideLoading();
          wx.showToast({ title: '生成失败', icon: 'none' });
        },
      });
    });
  },

  // 事件移动菜单（长按触发）：前后移一天 / 时间±1小时 / 编辑 / 复制 / 删除
  eventActions(e) {
    if (!this.data.isEditable) return;
    const index = e.currentTarget.dataset.index;
    const ev = this.schedule[index];
    if (!ev) return;
    wx.showActionSheet({
      itemList: ['编辑', '前移一天', '后移一天', '时间前移 1 小时', '时间后移 1 小时', '复制事件', '删除'],
      success: res => {
        const schedule = this.schedule.slice();
        const action = res.tapIndex;
        if (action === 0) {
          wx.navigateTo({ url: `/pages/event-edit/event-edit?id=${this.data.id}&date=${ev.date || ''}&index=${index}` });
          return;
        }
        if (action === 1 || action === 2) {
          const d = new Date(`${ev.date || '2026-01-01'}T00:00:00`);
          d.setDate(d.getDate() + (action === 1 ? -1 : 1));
          schedule[index] = { ...ev, date: d.toISOString().slice(0, 10) };
        } else if (action === 3 || action === 4) {
          const delta = action === 3 ? -60 : 60;
          const shift = t => {
            const [h, m] = String(t || '00:00').split(':').map(Number);
            const total = (((h || 0) * 60 + (m || 0) + delta) % 1440 + 1440) % 1440;
            return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
          };
          schedule[index] = { ...ev, start: shift(ev.start), end: ev.end ? shift(ev.end) : ev.end };
        } else if (action === 5) {
          this.clipboard = JSON.parse(JSON.stringify(ev));
          wx.showToast({ title: '已复制事件', icon: 'none' });
          return;
        } else if (action === 6) {
          wx.showModal({
            title: '删除事件',
            content: '确定删除这个事件？',
            success: async r => {
              if (!r.confirm) return;
              await this.putSchedule(this.schedule.filter((_, i) => i !== index));
            },
          });
          return;
        }
        this.putSchedule(schedule);
      },
    });
  },

  // ---------- 地图工具：全览 / 定位 ----------
  fitMap() {
    const points = this.data.mapPoints;
    if (!points.length) {
      wx.showToast({ title: '暂无地点可全览', icon: 'none' });
      return;
    }
    const ctx = wx.createMapContext('tripMap', this);
    ctx.includePoints({ points, padding: [70, 50, 70, 50] });
  },

  locateMe() {
    wx.getLocation({
      type: 'gcj02',
      success: res => {
        const ctx = wx.createMapContext('tripMap', this);
        ctx.moveToLocation({ latitude: res.latitude, longitude: res.longitude });
        wx.showToast({ title: '已定位', icon: 'none' });
      },
      fail: () => wx.showToast({ title: '定位失败，请在设置中允许位置权限', icon: 'none' }),
    });
  },

  // 事件多选批量操作（替代拖拽/框选）
  toggleMulti() {
    this.setData({ multiMode: !this.data.multiMode, selectedEvents: [] });
  },

  toggleEventSelect(e) {
    if (!this.data.multiMode) return;
    const index = e.currentTarget.dataset.index;
    const selected = this.data.selectedEvents.slice();
    const idx = selected.indexOf(index);
    if (idx >= 0) selected.splice(idx, 1);
    else selected.push(index);
    this.setData({ selectedEvents: selected });
  },

  async batchMoveEvents(e) {
    const dayDelta = Number(e.currentTarget.dataset.delta || 0);
    const { selectedEvents } = this.data;
    if (!selectedEvents.length) return;
    const schedule = this.schedule.slice();
    selectedEvents.forEach(index => {
      const ev = schedule[index];
      if (!ev) return;
      const d = new Date(`${ev.date || '2026-01-01'}T00:00:00`);
      d.setDate(d.getDate() + dayDelta);
      schedule[index] = { ...ev, date: d.toISOString().slice(0, 10) };
    });
    await this.putSchedule(schedule);
    this.setData({ multiMode: false, selectedEvents: [] });
  },

  async batchDeleteEvents() {
    const { selectedEvents } = this.data;
    if (!selectedEvents.length) return;
    wx.showModal({
      title: '批量删除',
      content: `确定删除选中的 ${selectedEvents.length} 个事件？`,
      success: async res => {
        if (!res.confirm) return;
        await this.putSchedule(this.schedule.filter((_, i) => !selectedEvents.includes(i)));
        this.setData({ multiMode: false, selectedEvents: [] });
      },
    });
  },

  // 事件复制 / 粘贴（对齐 web 剪贴板）
  copyEvent(e) {
    const index = e.currentTarget.dataset.index;
    const ev = this.schedule[index];
    if (!ev) return;
    this.clipboard = JSON.parse(JSON.stringify(ev));
    this.clipboard._start = ev.start;
    wx.showToast({ title: '已复制事件', icon: 'none' });
  },

  pasteEvent() {
    if (!this.clipboard) {
      wx.showToast({ title: '剪贴板为空，先复制事件', icon: 'none' });
      return;
    }
    const date = this.data.activeDate || this.clipboard.date;
    // 时间偏移 +1 小时避免重叠
    const shift = t => {
      const [h, m] = String(t || '09:00').split(':').map(Number);
      const total = (((h || 0) * 60 + (m || 0) + 60) % 1440 + 1440) % 1440;
      return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    };
    const copy = { ...this.clipboard, date, start: shift(this.clipboard.start), end: this.clipboard.end ? shift(this.clipboard.end) : this.clipboard.end, _start: undefined };
    delete copy._start;
    this.putSchedule([...this.schedule, copy]);
  },

  // 地点排序（长按菜单：上移/下移/删除）
  locationActions(e) {
    const locationId = e.currentTarget.dataset.id;
    const idx = this.allLocations.findIndex(l => l.id === locationId);
    if (idx < 0) return;
    wx.showActionSheet({
      itemList: ['上移', '下移', '删除'],
      success: async res => {
        const list = this.allLocations.slice();
        if (res.tapIndex === 0 && idx > 0) {
          [list[idx - 1], list[idx]] = [list[idx], list[idx - 1]];
        } else if (res.tapIndex === 1 && idx < list.length - 1) {
          [list[idx], list[idx + 1]] = [list[idx + 1], list[idx]];
        } else if (res.tapIndex === 2) {
          wx.showModal({
            title: '删除地点',
            content: '确定删除该地点？',
            success: async r => {
              if (!r.confirm) return;
              this.allLocations = list.filter(l => l.id !== locationId);
              await this.saveLocations();
              this.renderLocations();
            },
          });
          return;
        } else {
          return;
        }
        this.allLocations = list;
        await this.saveLocations();
        this.renderLocations();
        wx.showToast({ title: '已调整顺序', icon: 'none' });
      },
    });
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
