// 地点编辑器：新建/编辑行程地点
const { request } = require('../../utils/request');

const TYPES = [
  { value: 'spot', label: '景点' }, { value: 'geography', label: '地名' }, { value: 'food', label: '饮食' },
  { value: 'hotel', label: '住宿' }, { value: 'shopping', label: '购物' }, { value: 'drive', label: '路程' },
  { value: 'flight', label: '机场' }, { value: 'transport', label: '交通' }, { value: 'service', label: '服务区' },
  { value: 'fuel', label: '加油站' }, { value: 'supply', label: '补给' },
];

Page({
  data: {
    id: '',
    locationId: '',
    isNew: true,
    types: TYPES,
    typeIndex: 0,
    form: { type: 'spot', name: '', address: '', note: '' },
    saving: false,
    error: '',
  },

  onLoad(options) {
    const locationId = options.locationId || '';
    this.locations = [];
    this.setData({ id: options.id || '', locationId, isNew: !locationId });
    this.load();
  },

  async load() {
    try {
      const res = await request(`/api/trips/${this.data.id}/locations`);
      this.locations = res.locations || [];
      if (!this.data.isNew) {
        const loc = this.locations.find(l => l.id === this.data.locationId);
        if (loc) {
          const typeIndex = Math.max(0, TYPES.findIndex(t => t.value === loc.type));
          this.setData({
            typeIndex,
            form: { type: loc.type || 'spot', name: loc.name || '', address: loc.address || '', note: loc.note || '' },
          });
        }
      }
    } catch (err) {
      this.setData({ error: err.message });
    }
  },

  onInput(e) {
    this.setData({ [`form.${e.currentTarget.dataset.field}`]: e.detail.value });
  },

  onTypeChange(e) {
    const i = Number(e.detail.value);
    this.setData({ typeIndex: i, 'form.type': TYPES[i].value });
  },

  async save() {
    const { id, locationId, isNew, form, saving } = this.data;
    if (saving) return;
    if (!form.name.trim()) {
      wx.showToast({ title: '请填写名称', icon: 'none' });
      return;
    }
    this.setData({ saving: true, error: '' });
    const locations = [...this.locations];
    if (isNew) {
      locations.push({ id: `loc-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, ...form, name: form.name.trim() });
    } else {
      const idx = locations.findIndex(l => l.id === locationId);
      if (idx < 0) {
        this.setData({ saving: false });
        wx.showToast({ title: '地点不存在', icon: 'none' });
        return;
      }
      locations[idx] = { ...locations[idx], ...form, name: form.name.trim() };
    }
    try {
      await request(`/api/trips/${id}/locations`, { method: 'PUT', data: { locations } });
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (err) {
      this.setData({ saving: false, error: err.message });
    }
  },

  remove() {
    const { id, locationId, saving } = this.data;
    if (saving || !locationId) return;
    wx.showModal({
      title: '删除地点',
      content: '确定删除这个地点？',
      success: async res => {
        if (!res.confirm) return;
        this.setData({ saving: true });
        const locations = this.locations.filter(l => l.id !== locationId);
        try {
          await request(`/api/trips/${id}/locations`, { method: 'PUT', data: { locations } });
          wx.showToast({ title: '已删除', icon: 'success' });
          setTimeout(() => wx.navigateBack(), 500);
        } catch (err) {
          this.setData({ saving: false, error: err.message });
        }
      },
    });
  },
});
