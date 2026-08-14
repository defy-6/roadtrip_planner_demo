import { calculatePriceInfo, normalizedPriceItems } from './model.js';

const money = value => `¥${Number(value || 0).toFixed(2)}`;

export function createExpenseLedger({ state, save, openScheduleEditor, escapeHtml }) {
  const dialog = document.createElement('dialog');
  dialog.id = 'expenseLedger'; dialog.className = 'event-editor expense-ledger';
  dialog.innerHTML = `<section class="editor-form"><h3>每日开销</h3><div class="expense-ledger-toolbar"><div><small>全程总开销</small><b data-ledger-total>¥0.00</b></div><button type="button" data-ledger-add>＋ 记一笔</button></div><form class="expense-entry-form" data-ledger-form hidden><input type="hidden" data-expense-id><label>日期<input type="date" data-expense-date required></label><label>类别<select data-expense-category><option>餐饮</option><option>住宿</option><option>交通</option><option>门票</option><option>加油</option><option>停车</option><option>购物</option><option>其他</option></select></label><label class="expense-event-field">关联安排（可选）<select data-expense-event><option value="">不关联，保存为独立账目</option></select><small>关联后会写入该安排的共同费用，可在事件编辑页继续修改。</small></label><label class="expense-note-field">说明<input data-expense-note required maxlength="80" placeholder="例如：停车费"></label><label>金额<input type="number" data-expense-amount min="0.01" step="0.01" required placeholder="0.00"></label><div class="expense-form-actions"><button type="button" class="ghost" data-ledger-cancel>取消</button><button type="submit">保存账目</button></div></form><div class="expense-day-list" data-ledger-days></div><div class="editor-actions"><button type="button" class="ghost" data-ledger-close>关闭</button></div></section>`;
  document.body.append(dialog);
  const form = dialog.querySelector('[data-ledger-form]');
  const dailyList = dialog.querySelector('[data-ledger-days]');
  const eventTotal = event => {
    const items = normalizedPriceItems(event.priceInfo);
    return items.perPersonItems.reduce((sum, item) => sum + Number(item.amount || 0) * Math.max(1, Number(item.people || 1)), 0)
      + items.sharedItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  };
  const entries = () => [
    ...state.schedule.map((event, index) => { const priceItems = normalizedPriceItems(event.priceInfo); return { id: `event-${index}`, source: 'event', index, date: event.date, category: event.type === 'food' ? '餐饮' : event.type === 'hotel' ? '住宿' : event.type === 'drive' ? '交通' : event.type === 'spot' ? '门票' : '行程', note: event.title, detail: [...priceItems.perPersonItems, ...priceItems.sharedItems].map(item => item.note).filter(Boolean).join('；'), amount: eventTotal(event) }; }).filter(item => item.amount > 0),
    ...(state.expenses || []).map(expense => ({ ...expense, source: 'expense' }))
  ].sort((a, b) => `${a.date}${a.note}`.localeCompare(`${b.date}${b.note}`));
  function render() {
    const all = entries();
    dialog.querySelector('[data-ledger-total]').textContent = money(all.reduce((sum, item) => sum + Number(item.amount || 0), 0));
    const groups = Map.groupBy ? Map.groupBy(all, item => item.date || '未定日期') : all.reduce((map, item) => map.set(item.date || '未定日期', [...(map.get(item.date || '未定日期') || []), item]), new Map());
    dailyList.innerHTML = [...groups].map(([date, items]) => `<details class="expense-day" open><summary><span><b>${escapeHtml(date)}</b><small>${items.length} 笔</small></span><strong>${money(items.reduce((sum, item) => sum + Number(item.amount || 0), 0))}</strong></summary><div>${items.map(item => `<article class="expense-row"><span class="expense-category">${escapeHtml(item.category || '其他')}</span><div><b>${escapeHtml(item.note || '未命名支出')}</b><small>${item.source === 'event' ? `来自时间表安排${item.detail ? ` · ${escapeHtml(item.detail)}` : ''}` : '独立账目'}</small></div><strong>${money(item.amount)}</strong><button type="button" data-expense-edit="${escapeHtml(item.id)}">编辑</button>${item.source === 'expense' ? `<button type="button" class="is-danger" data-expense-delete="${escapeHtml(item.id)}">删除</button>` : ''}</article>`).join('')}</div></details>`).join('') || '<p class="expense-empty">还没有开销记录，点击“记一笔”开始记账。</p>';
  }
  function renderEventOptions(date, selected = '') {
    const select = form.querySelector('[data-expense-event]');
    const options = state.schedule.map((event, index) => ({ event, index })).filter(item => item.event.date === date);
    select.innerHTML = `<option value="">不关联，保存为独立账目</option>${options.map(({ event, index }) => `<option value="${index}">${escapeHtml(event.start ? `${event.start} · ` : '')}${escapeHtml(event.title || '未命名安排')}</option>`).join('')}`;
    select.value = options.some(item => String(item.index) === String(selected)) ? String(selected) : '';
  }
  function showForm(expense = {}) {
    form.hidden = false;
    form.querySelector('[data-expense-id]').value = expense.id || '';
    form.querySelector('[data-expense-date]').value = expense.date || state.dayFilter || state.schedule[0]?.date || new Date().toISOString().slice(0, 10);
    renderEventOptions(form.querySelector('[data-expense-date]').value);
    form.querySelector('[data-expense-category]').value = expense.category || '餐饮';
    form.querySelector('[data-expense-note]').value = expense.note || '';
    form.querySelector('[data-expense-amount]').value = expense.amount || '';
    form.querySelector('[data-expense-note]').focus();
  }
  form.querySelector('[data-expense-date]').addEventListener('change', event => renderEventOptions(event.currentTarget.value));
  dialog.addEventListener('click', event => {
    if (event.target.closest('[data-ledger-close]')) dialog.close();
    if (event.target.closest('[data-ledger-add]')) showForm();
    if (event.target.closest('[data-ledger-cancel]')) form.hidden = true;
    const editId = event.target.closest('[data-expense-edit]')?.dataset.expenseEdit;
    if (editId?.startsWith('event-')) { dialog.close(); openScheduleEditor(Number(editId.slice(6))); return; }
    if (editId) showForm((state.expenses || []).find(item => item.id === editId));
    const deleteId = event.target.closest('[data-expense-delete]')?.dataset.expenseDelete;
    if (deleteId) { state.expenses = (state.expenses || []).filter(item => item.id !== deleteId); save(); render(); }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const id = form.querySelector('[data-expense-id]').value || crypto.randomUUID();
    const expense = { id, date: form.querySelector('[data-expense-date]').value, category: form.querySelector('[data-expense-category]').value, note: form.querySelector('[data-expense-note]').value.trim(), amount: Number(form.querySelector('[data-expense-amount]').value || 0) };
    const linkedEventIndex = Number(form.querySelector('[data-expense-event]').value);
    const existingIndex = (state.expenses || []).findIndex(item => item.id === id);
    if (Number.isInteger(linkedEventIndex) && form.querySelector('[data-expense-event]').value !== '' && state.schedule[linkedEventIndex]) {
      const eventEntry = state.schedule[linkedEventIndex];
      const items = normalizedPriceItems(eventEntry.priceInfo);
      eventEntry.priceInfo = calculatePriceInfo(items.perPersonItems, [...items.sharedItems, { amount: expense.amount, note: `${expense.category} · ${expense.note}` }]);
      if (existingIndex >= 0) state.expenses.splice(existingIndex, 1);
    } else if (existingIndex >= 0) state.expenses[existingIndex] = expense; else (state.expenses ||= []).push(expense);
    save(); form.hidden = true; render();
  });
  const open = () => { form.hidden = true; render(); dialog.showModal(); };
  return { open, render };
}
