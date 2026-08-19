// 事件编辑器：新建/编辑时间表事件，保存回云端 schedule
const { request } = require('../../utils/request');

const TYPES = [
  { value: 'spot', label: '景点' },
  { value: 'drive', label: '路程' },
  { value: 'flight', label: '航班' },
  { value: 'transport', label: '交通' },
  { value: 'food', label: '餐饮' },
  { value: 'hotel', label: '住宿' },
  { value: 'service', label: '服务区' },
  { value: 'fuel', label: '加油' },
  { value: 'supply', label: '补给' },
];

const MODES = [
  { value: 'driving', label: '自驾' },
  { value: 'walking', label: '步行' },
  { value: 'bicycling', label: '骑行' },
  { value: 'transit', label: '公交' },
];

const STRATEGIES = [
  { value: '0', label: '推荐' },
  { value: '1', label: '高速优先' },
  { value: '2', label: '速度最快' },
  { value: '3', label: '少收费' },
  { value: '4', label: '不走高速' },
  { value: '6', label: '大路优先' },
];

Page({
    data: {
    id: '',
    index: -1,
    isNew: true,
    types: TYPES,
    typeIndex: 0,
    modes: MODES,
    modeIndex: 0,
    strategies: STRATEGIES,
    strategyIndex: 0,
    form: { date: '', start: '09:00', end: '10:00', title: '', detail: '', address: '', type: 'spot', origin: '', originAddress: '', destination: '', destinationAddress: '', waypointsText: '', mode: 'driving', strategy: '0', transitCity: '', transitCityd: '', flightNumber: '', departureAirport: '', arrivalAirport: '' },
    priceItems: [],
    routeInfo: null,
    calcBusy: false,
    saving: false,
    error: '',
  },

  onLoad(options) {
    const id = options.id || '';
    const date = options.date || '';
    const index = Number(options.index ?? -1);
    this.schedule = [];
    this.setData({ id, index, isNew: index < 0, 'form.date': date });
    // 支持指定初始类型（如地图「新建路程」→ drive）
    if (options.type) {
      const typeIndex = Math.max(0, TYPES.findIndex(t => t.value === options.type));
      this.setData({ typeIndex, 'form.type': options.type });
    }
    this.load();
  },

  async load() {
    try {
      const [schRes, locRes] = await Promise.all([
        request(`/api/trips/${this.data.id}/schedule`),
        request(`/api/trips/${this.data.id}/locations`),
      ]);
      this.schedule = schRes.schedule || [];
      this.locations = locRes.locations || [];
      if (!this.data.isNew) {
        const ev = this.schedule[this.data.index];
        if (ev) {
          const typeIndex = Math.max(0, TYPES.findIndex(t => t.value === ev.type));
          this.setData({
            typeIndex,
            routeInfo: ev.routeInfo || null,
            form: {
              date: ev.date || this.data.form.date,
              start: ev.start || '',
              end: ev.end || '',
              title: ev.title || '',
              detail: ev.detail || '',
              address: ev.address || '',
              type: ev.type || 'spot',
              origin: (ev.originName || ev.origin || ''),
              originAddress: ev.originAddress || ev.origin || '',
              destination: (ev.destinationName || ev.destination || ''),
              destinationAddress: ev.destinationAddress || ev.destination || '',
              waypointsText: (ev.waypoints || []).join('、'),
              mode: ev.mode || 'driving',
              strategy: ev.strategy || '0',
              transitCity: ev.transitCity || '',
              transitCityd: ev.transitCityd || '',
              price: ev.price ? String(ev.price) : '',
              flightNumber: (ev.flightInfo && ev.flightInfo.flightNumber) || '',
              departureAirport: (ev.flightInfo && ev.flightInfo.departureAirport) || '',
              arrivalAirport: (ev.flightInfo && ev.flightInfo.arrivalAirport) || '',
            },
          });
          // 费用明细条目（动态列表）
          const priceItems = [];
          ((ev.priceInfo && ev.priceInfo.perPersonItems) || []).forEach((it, i) => {
            priceItems.push({ key: `per${i}`, kind: 'per', note: it.note || '费用', amount: String(it.amount != null ? it.amount : ''), count: String(it.count || 1) });
          });
          ((ev.priceInfo && ev.priceInfo.sharedItems) || []).forEach((it, i) => {
            priceItems.push({ key: `sh${i}`, kind: 'shared', note: it.note || '共同费用', amount: String(it.amount != null ? it.amount : ''), count: '' });
          });
          this.setData({
            modeIndex: Math.max(0, MODES.findIndex(m => m.value === (ev.mode || 'driving'))),
            strategyIndex: Math.max(0, STRATEGIES.findIndex(s => s.value === (ev.strategy || '0'))),
            priceItems,
          });
        }
      } else if (!this.data.form.date) {
        this.setData({ 'form.date': new Date().toISOString().slice(0, 10) });
      }
    } catch (err) {
      this.setData({ error: err.message });
    }
  },

  onInput(e) {
    this.setData({ [`form.${e.currentTarget.dataset.field}`]: e.detail.value });
  },

  onDateChange(e) {
    this.setData({ 'form.date': e.detail.value });
  },

  onTimeChange(e) {
    this.setData({ [`form.${e.currentTarget.dataset.field}`]: e.detail.value });
  },

  onTypeChange(e) {
    const typeIndex = Number(e.detail.value);
    this.setData({ typeIndex, 'form.type': TYPES[typeIndex].value });
  },

  onModeChange(e) {
    const i = Number(e.detail.value);
    this.setData({ modeIndex: i, 'form.mode': MODES[i].value });
  },

  onStrategyChange(e) {
    const i = Number(e.detail.value);
    this.setData({ strategyIndex: i, 'form.strategy': STRATEGIES[i].value });
  },

  // 途经点：从地点库选择（每次选一个追加，可多次）
  addWaypoint() {
    const names = (this.locations || []).map(l => l.name).filter(Boolean).slice(0, 6);
    if (!names.length) {
      wx.showToast({ title: '地点库为空，请先添加地点', icon: 'none' });
      return;
    }
    wx.showActionSheet({
      itemList: names,
      success: res => {
        const name = names[res.tapIndex];
        const cur = this.data.form.waypointsText;
        this.setData({ 'form.waypointsText': cur ? `${cur}、${name}` : name });
      },
    });
  },

  // 动态费用条目
  addPriceItem() {
    wx.showActionSheet({
      itemList: ['单人费用（×人数）', '共同费用'],
      success: res => {
        const kind = res.tapIndex === 0 ? 'per' : 'shared';
        const items = this.data.priceItems.slice();
        items.push({ key: `p${Date.now()}`, kind, note: '', amount: '', count: kind === 'per' ? '1' : '' });
        this.setData({ priceItems: items });
      },
    });
  },

  removePriceItem(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ priceItems: this.data.priceItems.filter(i => i.key !== key) });
  },

  onPriceInput(e) {
    const { key, field } = e.currentTarget.dataset;
    const items = this.data.priceItems.map(i => (i.key === key ? { ...i, [field]: e.detail.value } : i));
    this.setData({ priceItems: items });
  },

  // 计算驾车路线（调云函数高德转发，drive 类型）
  async calcRoute() {
    const { form, calcBusy } = this.data;
    const originAddr = form.originAddress || form.origin;
    const destAddr = form.destinationAddress || form.destination;
    if (calcBusy || !form.origin || !form.destination) return;
    if (form.mode === 'transit' && !form.transitCity) {
      wx.showToast({ title: '公交路线需要填写起点城市', icon: 'none' });
      return;
    }
    // 路线库复用：相同起终点的已算路线直接回填
    const cached = this.schedule.find(e => e.type === 'drive' && e.routeInfo
      && (e.originAddress || e.origin) === originAddr && (e.destinationAddress || e.destination) === destAddr);
    if (cached && cached.routeInfo && cached.routeInfo.polyline) {
      this.setData({ routeInfo: cached.routeInfo, calcBusy: false });
      wx.showToast({ title: '已复用上次路线', icon: 'none' });
      return;
    }
    this.setData({ calcBusy: true });
    try {
      const waypoints = String(form.waypointsText || '').split(/[,，;；、]/).map(s => s.trim()).filter(Boolean);
      const payload = { origin: originAddr, destination: destAddr, waypoints, strategy: form.strategy, mode: form.mode };
      if (form.mode === 'transit') {
        payload.city = form.transitCity;
        if (form.transitCityd) payload.cityd = form.transitCityd;
      }
      const res = await request('/api/route', {
        method: 'POST',
        data: payload,
      });
      const path = res.route && res.route.paths && res.route.paths[0];
      if (!path) throw new Error('未返回可用路线');
      const distance = Number(path.distance || 0);
      const duration = Number(path.duration || 0);
      // 轨迹 polyline（降采样，供地图绘制）
      const steps = (path.steps || []).map(s => String(s.polyline || ''));
      const polyline = [];
      steps.forEach(step => {
        const pts = step.split(';').filter(Boolean);
        const sampled = pts.length > 240 ? pts.filter((_, i) => i % 10 === 0 || i === pts.length - 1) : pts;
        sampled.forEach(pt => {
          const [lng, lat] = pt.split(',').map(Number);
          if (Number.isFinite(lng) && Number.isFinite(lat)) polyline.push({ latitude: lat, longitude: lng });
        });
      });
      this.setData({
        routeInfo: {
          distance,
          duration,
          tolls: Number(path.tolls || 0),
          polyline,
          distanceText: distance >= 1000 ? `${(distance / 1000).toFixed(1)} 公里` : `${distance} 米`,
          durationText: duration >= 3600
            ? `${Math.floor(duration / 3600)} 小时 ${Math.round(duration % 3600 / 60)} 分`
            : `${Math.round(duration / 60)} 分钟`,
        },
        calcBusy: false,
      });
      wx.showToast({ title: '路线已计算', icon: 'none' });
    } catch (err) {
      this.setData({ calcBusy: false });
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  async save() {
    const { id, index, isNew, form, saving } = this.data;
    if (saving) return;
    if (!form.title.trim()) {
      wx.showToast({ title: '请填写标题', icon: 'none' });
      return;
    }
    if (!form.date) {
      wx.showToast({ title: '请选择日期', icon: 'none' });
      return;
    }
    if (form.type === 'drive' && !form.origin && !form.destination) {
      wx.showToast({ title: '路程事件请填写起点/终点', icon: 'none' });
      return;
    }
    this.setData({ saving: true, error: '' });
    const schedule = [...this.schedule];
    const { priceItems } = this.data;
    const perPersonItems = priceItems
      .filter(i => i.kind === 'per' && Number(i.amount) > 0)
      .map(i => ({ note: i.note || '费用', amount: Number(i.amount), count: Number(i.count) || 1 }));
    const sharedItems = priceItems
      .filter(i => i.kind === 'shared' && Number(i.amount) > 0)
      .map(i => ({ note: i.note || '共同费用', amount: Number(i.amount) }));
    const priceTotal = perPersonItems.reduce((s, i) => s + i.amount * i.count, 0) + sharedItems.reduce((s, i) => s + i.amount, 0);
    const record = {
      ...form, title: form.title.trim(),
      originName: (form.origin || '').trim(),
      originAddress: (form.originAddress || form.origin || '').trim(),
      destinationName: (form.destination || '').trim(),
      destinationAddress: (form.destinationAddress || form.destination || '').trim(),
      waypoints: String(form.waypointsText || '').split(/[,，;；、]/).map(s => s.trim()).filter(Boolean),
      routeInfo: form.type === 'drive' ? (this.data.routeInfo || null) : null,
      price: priceTotal,
      priceInfo: { perPersonItems, sharedItems },
      flightInfo: form.type === 'flight' ? {
        flightNumber: (form.flightNumber || '').trim(),
        departureAirport: (form.departureAirport || '').trim(),
        arrivalAirport: (form.arrivalAirport || '').trim(),
      } : null,
    };
    if (isNew) schedule.push(record);
    else schedule[index] = record;
    try {
      await request(`/api/trips/${id}/schedule`, { method: 'PUT', data: { schedule } });
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (err) {
      this.setData({ saving: false, error: err.message });
    }
  },

  remove() {
    const { id, index, saving } = this.data;
    if (saving || index < 0) return;
    wx.showModal({
      title: '删除事件',
      content: '确定删除这个事件吗？',
      success: async res => {
        if (!res.confirm) return;
        this.setData({ saving: true });
        const schedule = this.schedule.filter((_, i) => i !== index);
        try {
          await request(`/api/trips/${id}/schedule`, { method: 'PUT', data: { schedule } });
          wx.showToast({ title: '已删除', icon: 'success' });
          setTimeout(() => wx.navigateBack(), 500);
        } catch (err) {
          this.setData({ saving: false, error: err.message });
        }
      },
    });
  },
});
