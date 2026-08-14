// 行程账本：独立账目列表 + 添加/编辑/删除
const { request } = require('../../utils/request');

const CATEGORIES = ['餐饮', '住宿', '交通', '门票', '加油', '停车', '购物', '其他'];

Page({
  data: {
    id: '',
    groups: [],
    total: '0.00',
    showForm: false,
    editId: '',
    categories: CATEGORIES,
    categoryIndex: 0,
    form: { date: '', category: '餐饮', note: '', amount: '' },
    saving: false,
    error: '',
  },

  onLoad(options) {
    this.expenses = [];
    this.setData({ id: options.id || '' });
    this.load();
  },

  async load() {
    try {
      const res = await request(`/api/trips/${this.data.id}/expenses`);
      this.expenses = res.expenses || [];
      this.render();
    } catch (err) {
      this.setData({ error: err.message });
    }
  },

  render() {
    const sorted = [...this.expenses].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const map = {};
    sorted.forEach(e => { (map[e.date] = map[e.date] || []).push(e); });
    const groups = Object.entries(map).map(([date, items]) => ({
      date,
      items,
      total: items.reduce((s, i) => s + Number(i.amount || 0), 0).toFixed(2),
    }));
    const total = sorted.reduce((s, e) => s + Number(e.amount || 0), 0).toFixed(2);
    this.setData({ groups, total });
  },

  showAdd() {
    this.setData({
      showForm: true,
      editId: '',
      categoryIndex: 0,
      'form.date': new Date().toISOString().slice(0, 10),
      'form.category': '餐饮',
      'form.note': '',
      'form.amount': '',
    });
  },

  cancelForm() {
    this.setData({ showForm: false, editId: '' });
  },

  onInput(e) {
    this.setData({ [`form.${e.currentTarget.dataset.field}`]: e.detail.value });
  },

  onDateChange(e) {
    this.setData({ 'form.date': e.detail.value });
  },

  onCategoryChange(e) {
    const i = Number(e.detail.value);
    this.setData({ categoryIndex: i, 'form.category': CATEGORIES[i] });
  },

  edit(e) {
    const itemId = e.currentTarget.dataset.id;
    const item = this.expenses.find(x => x.id === itemId);
    if (!item) return;
    const categoryIndex = Math.max(0, CATEGORIES.indexOf(item.category));
    this.setData({
      showForm: true,
      editId: itemId,
      categoryIndex,
      form: {
        date: item.date || '',
        category: item.category || '餐饮',
        note: item.note || '',
        amount: String(item.amount != null ? item.amount : ''),
      },
    });
  },

  async save() {
    const { id, editId, form, saving } = this.data;
    if (saving) return;
    const amount = Number(form.amount);
    if (!form.date || !form.note.trim() || !(amount > 0)) {
      wx.showToast({ title: '请完整填写（金额需大于 0）', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    const expenses = [...this.expenses];
    const record = { date: form.date, category: form.category, note: form.note.trim(), amount };
    if (editId) {
      const idx = expenses.findIndex(x => x.id === editId);
      if (idx >= 0) expenses[idx] = { ...expenses[idx], ...record };
    } else {
      expenses.push({ id: `exp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, ...record });
    }
    try {
      await request(`/api/trips/${id}/expenses`, { method: 'PUT', data: { expenses } });
      this.expenses = expenses;
      this.setData({ saving: false, showForm: false, editId: '' });
      this.render();
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (err) {
      this.setData({ saving: false, error: err.message });
    }
  },

  remove(e) {
    const itemId = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除账目',
      content: '确定删除这笔开销？',
      success: async res => {
        if (!res.confirm) return;
        const expenses = this.expenses.filter(x => x.id !== itemId);
        try {
          await request(`/api/trips/${this.data.id}/expenses`, { method: 'PUT', data: { expenses } });
          this.expenses = expenses;
          this.render();
          wx.showToast({ title: '已删除', icon: 'success' });
        } catch (err) {
          this.setData({ error: err.message });
        }
      },
    });
  },
});
