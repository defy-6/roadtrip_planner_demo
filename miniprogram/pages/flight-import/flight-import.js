// 航班导入：一键把航班信息创建为 flight 事件（对齐 web 导入航班）
const { request } = require('../../utils/request');

Page({
  data: {
    id: '',
    form: { date: '', depTime: '09:00', arrTime: '11:40', flightNumber: '', depAirport: '', arrAirport: '', depTerminal: '', arrTerminal: '', stopover: '', arrDate: '' },
    saving: false,
    error: '',
  },

  onLoad(options) {
    this.setData({ id: options.id || '', 'form.date': new Date().toISOString().slice(0, 10) });
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

  onArrDateChange(e) {
    this.setData({ 'form.arrDate': e.detail.value });
  },

  async save() {
    const { id, form, saving } = this.data;
    if (saving) return;
    if (!form.flightNumber.trim() || !form.depAirport.trim() || !form.arrAirport.trim()) {
      wx.showToast({ title: '请填写航班号与起降机场', icon: 'none' });
      return;
    }
    this.setData({ saving: true, error: '' });
    try {
      const [schRes, locRes] = await Promise.all([
        request(`/api/trips/${id}/schedule`),
        request(`/api/trips/${id}/locations`),
      ]);
      const schedule = schRes.schedule || [];
      const dep = (form.depAirport || '').trim();
      const arr = (form.arrAirport || '').trim();
      const stopover = (form.stopover || '').trim();
      schedule.push({
        date: form.date,
        start: form.depTime,
        end: form.arrTime,
        title: `${form.flightNumber.trim()} ${dep} → ${arr}${stopover ? `（经停 ${stopover}）` : ''}`,
        type: 'flight',
        detail: [form.depTerminal && `出发 ${form.depTerminal}`, form.arrTerminal && `到达 ${form.arrTerminal}`, stopover && `经停 ${stopover}`].filter(Boolean).join(' · '),
        address: dep,
        flightInfo: {
          flightNumber: form.flightNumber.trim(),
          departureAirport: dep,
          arrivalAirport: arr,
          departureTerminal: form.depTerminal || '',
          arrivalTerminal: form.arrTerminal || '',
          stopovers: stopover ? [stopover] : [],
          arrivalDate: form.arrDate || form.date,
        },
      });
      // 机场自动关联：起降/经停机场加入地点库（flight 类型，若不存在）
      const locations = (locRes.locations || []).slice();
      const airports = [dep, arr, stopover].filter(Boolean);
      airports.forEach(a => {
        if (!locations.some(l => l.name === a)) {
          locations.push({ id: `loc-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, type: 'flight', name: a, address: a, note: '航班机场' });
        }
      });
      if (locations.length !== (locRes.locations || []).length) {
        await request(`/api/trips/${id}/locations`, { method: 'PUT', data: { locations } });
      }
      await request(`/api/trips/${id}/schedule`, { method: 'PUT', data: { schedule } });
      wx.showToast({ title: '已导入航班', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (err) {
      this.setData({ saving: false, error: err.message });
    }
  },
});
