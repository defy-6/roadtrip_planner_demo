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

Page({
  data: {
    id: '',
    index: -1,
    isNew: true,
    types: TYPES,
    typeIndex: 0,
    form: { date: '', start: '09:00', end: '10:00', title: '', detail: '', address: '', type: 'spot' },
    saving: false,
    error: '',
  },

  onLoad(options) {
    const id = options.id || '';
    const date = options.date || '';
    const index = Number(options.index ?? -1);
    this.schedule = [];
    this.setData({ id, index, isNew: index < 0, 'form.date': date });
    this.load();
  },

  async load() {
    try {
      const res = await request(`/api/trips/${this.data.id}/schedule`);
      this.schedule = res.schedule || [];
      if (!this.data.isNew) {
        const ev = this.schedule[this.data.index];
        if (ev) {
          const typeIndex = Math.max(0, TYPES.findIndex(t => t.value === ev.type));
          this.setData({
            typeIndex,
            form: {
              date: ev.date || this.data.form.date,
              start: ev.start || '',
              end: ev.end || '',
              title: ev.title || '',
              detail: ev.detail || '',
              address: ev.address || '',
              type: ev.type || 'spot',
            },
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
    this.setData({ saving: true, error: '' });
    const schedule = [...this.schedule];
    const record = { ...form, title: form.title.trim() };
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
