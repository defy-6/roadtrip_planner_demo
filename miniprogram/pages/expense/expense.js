// 行程账本：独立账目列表 + 添加/编辑/删除
const { request, resetTripRevision } = require('../../utils/request');
const { isVersionConflict, resolveVersionConflict } = require('../../utils/conflict');
const { offerRestore, withDraftLifecycle } = require('../../utils/drafts');

const CATEGORIES = ['餐饮', '住宿', '交通', '门票', '加油', '停车', '购物', '其他'];

Page(withDraftLifecycle({
  data: {
    id: '',
    groups: [],
    total: '0.00',
    grandTotal: '0.00',
    eventsPrice: '0.00',
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
    this.eventOptions = [{ index: -1, title: '不关联，保存为独立账目' }];
    this.setData({ id: options.id || '', eventOptions: this.eventOptions, eventSel: 0 });
    this.load().then(() => offerRestore(this, this.data.id));
  },

  // 冲突处置：保留冲突码，交由用户显式选择重新加载（丢弃本地）或保留本地，绝不静默覆盖。
  async handleConflict(err) {
    if (!isVersionConflict(err)) return false;
    this.setData({ saving: false, error: '' });
    const reloaded = await resolveVersionConflict({ error: err, onReload: () => this.load() });
    wx.showToast({ title: reloaded ? '已加载云端最新数据' : '已保留本次改动，请重试', icon: 'none' });
    return true;
  },

  async load() {
    resetTripRevision(this.data.id);
    try {
      const [expRes, schRes] = await Promise.all([
        request(`/api/trips/${this.data.id}/expenses`),
        request(`/api/trips/${this.data.id}/schedule`),
      ]);
      this.expenses = expRes.expenses || [];
      const schedule = schRes.schedule || [];
      this.scheduleEvents = schedule;
      this.eventsPrice = schedule.reduce((s, e) => s + Number(e.price || 0), 0);
      this.eventOptions = [
        { index: -1, title: '不关联，保存为独立账目' },
        ...schedule.map((e, i) => ({ index: i, title: e.title || `事件 ${i + 1}` })),
      ];
      this.setData({ eventOptions: this.eventOptions, eventSel: 0 });
      this.render();
      return true;
    } catch (err) {
      this.setData({ error: err.message });
      return false;
    }
  },

  render() {
    // 独立账目 + 事件内嵌费用（按日期归组混排，事件行标注来源）
    const eventRows = (this.scheduleEvents || [])
      .filter(e => Number(e.price) > 0)
      .map(e => ({
        id: `ev-${e.date}-${e.start || ''}-${e.title}`,
        date: e.date,
        note: e.title || '事件费用',
        amount: Number(e.price),
        category: '事件费用',
        source: 'event',
      }));
    const sorted = [...this.expenses.map(e => ({ ...e, source: 'expense' })), ...eventRows]
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const map = {};
    sorted.forEach(e => { (map[e.date] = map[e.date] || []).push(e); });
    const groups = Object.entries(map).map(([date, items]) => ({
      date,
      items,
      total: items.reduce((s, i) => s + Number(i.amount || 0), 0).toFixed(2),
    }));
    const total = sorted.reduce((s, e) => s + Number(e.amount || 0), 0);
    this.setData({ groups, total: total.toFixed(2), grandTotal: total.toFixed(2), eventsPrice: Number(this.eventsPrice || 0).toFixed(2) });
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

  onEventChange(e) {
    this.setData({ eventSel: Number(e.detail.value) });
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
    const { id, editId, form, saving, eventSel } = this.data;
    if (saving) return;
    const amount = Number(form.amount);
    if (!form.date || !form.note.trim() || !(amount > 0)) {
      wx.showToast({ title: '请完整填写（金额需大于 0）', icon: 'none' });
      return;
    }
    const selected = this.eventOptions[eventSel] || this.eventOptions[0];
    this.setData({ saving: true });
    const expenses = [...this.expenses];
    const record = {
      date: form.date, category: form.category, note: form.note.trim(), amount,
      linkedEventId: selected.index >= 0 ? `event-${selected.index}` : '',
      linkedEventTitle: selected.index >= 0 ? selected.title : '',
    };
    if (editId) {
      const idx = expenses.findIndex(x => x.id === editId);
      if (idx >= 0) expenses[idx] = { ...expenses[idx], ...record };
    } else {
      expenses.push({ id: `exp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, ...record });
    }
    try {
      // Commit the expense and associated event in one versioned server operation.
      // Never compensate a partial save by overwriting another client's expenses.
      let schedule;
      if (selected.index >= 0) {
          schedule = JSON.parse(JSON.stringify(this.scheduleEvents || []));
          const ev = schedule[selected.index];
          if (ev) {
            ev.priceInfo = ev.priceInfo || { perPersonItems: [], sharedItems: [] };
            ev.priceInfo.sharedItems = ev.priceInfo.sharedItems || [];
            ev.priceInfo.sharedItems.push({ note: record.category, amount });
            ev.price = Number(ev.price || 0) + amount;
          }
      }
      await request(`/api/trips/${id}/expenses`, { method: 'PUT', data: { expenses, ...(schedule ? { schedule } : {}) } });
      if (schedule) this.scheduleEvents = schedule;
      this.expenses = expenses;
      this.setData({ saving: false, showForm: false, editId: '', eventSel: 0 });
      this.render();
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (err) {
      if (await this.handleConflict(err)) return;
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
          if (await this.handleConflict(err)) return;
          this.setData({ error: err.message });
        }
      },
    });
  },
}, 'expenses'));
