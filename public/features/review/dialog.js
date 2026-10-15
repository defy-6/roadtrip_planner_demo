import { reviewDays } from './model.js';
import { createReviewPhotoPreview } from './photo-preview.js';
import { createReviewDateNavigation } from './date-navigation.js';

export function createPlanReview({ state, escapeHtml, getTripName, getPlanName, getExpenseEntries = () => [], canEdit = () => false, editEvent }) {
  const dialog = document.createElement('dialog');
  dialog.id = 'planReviewDialog';
  dialog.className = 'event-editor plan-review-dialog';
  dialog.setAttribute('aria-labelledby', 'planReviewTitle');
  dialog.innerHTML = '<section class="editor-form"><div class="review-header"><h3 id="planReviewTitle">当前方案回顾</h3><select data-review-date aria-label="跳转到回顾日期"></select></div><p class="hint" data-review-context></p><p class="hint">汇总已保存的安排、备注和地点图片；不代表安排已实际完成。</p><div data-review-days></div><div class="editor-actions"><button type="button" class="ghost" data-review-close>关闭</button></div></section>';
  document.body.append(dialog);
  const dateNavigation = createReviewDateNavigation(dialog);
  const photoPreview = createReviewPhotoPreview({ getContext: button => {
    const date = button.closest('.review-day')?.dataset.reviewDate;
    return { tripName: getTripName(), planName: getPlanName(), date: date === 'undated' ? '' : date };
  } });
  dialog.addEventListener('click', event => {
    const button = event.target.closest('[data-review-photo]');
    if (button) photoPreview.open(button);
  });
  dialog.addEventListener('click', async event => {
    const button = event.target.closest('[data-review-edit]');
    if (!button || !canEdit() || !editEvent) return;
    const index = Number(button.dataset.reviewEdit);
    const form = dialog.querySelector('.editor-form');
    const scrollTop = form.scrollTop;
    const photos = [...dialog.querySelectorAll('[data-review-edit]')].map(edit => ({
      index: edit.dataset.reviewEdit,
      button: edit.closest('.review-event').querySelector('[data-review-photo]')
    })).filter(photo => photo.button);
    const expandedDays = [...dialog.querySelectorAll('.review-day')]
      .filter(day => day.querySelector('.review-expenses').open)
      .map(day => day.querySelector('h4').textContent);
    button.disabled = true;
    try {
      const result = await editEvent(index);
      if (!dialog.open) return;
      render();
      if (!result?.deleted) photos.forEach(photo => {
        const replacement = dialog.querySelector(`[data-review-edit="${photo.index}"]`)
          ?.closest('.review-event').querySelector('[data-review-photo]');
        if (replacement?.querySelector('img').getAttribute('src') === photo.button.querySelector('img').getAttribute('src')) replacement.replaceWith(photo.button);
      });
      dialog.querySelectorAll('.review-day').forEach(day => {
        day.querySelector('.review-expenses').open = expandedDays.includes(day.querySelector('h4').textContent);
      });
      form.scrollTop = scrollTop;
      const target = (!result?.deleted && dialog.querySelector(`[data-review-edit="${index}"]`)) || dialog.querySelector('[data-review-close]');
      target.focus({ preventScroll: true });
      if (result?.dateChanged && !result.deleted) {
        const article = target.closest('.review-event');
        article.tabIndex = -1;
        article.focus({ preventScroll: true });
        dateNavigation.jump(article.closest('.review-day'), { focus: false });
      }
    } finally { button.disabled = false; }
  });
  let opener = null;
  const render = () => {
    dialog.querySelector('[data-review-context]').textContent = [getTripName(), getPlanName()].filter(Boolean).join(' · ');
    const days = reviewDays(state.schedule, state.locations, getExpenseEntries());
    dateNavigation.update(days);
    dialog.querySelector('[data-review-days]').innerHTML = days.map(day => `<section class="review-day"><h4>${escapeHtml(day.date || '未设置日期')}</h4>${day.events.map(event => `<article class="review-event"><small>${escapeHtml([event.start, event.end].filter(Boolean).join('–'))}</small><b>${escapeHtml(event.title)}</b>${event.note ? `<p>${escapeHtml(event.note)}</p>` : ''}${event.placeNote && event.placeNote !== event.note ? `<p><span>地点备注：</span>${escapeHtml(event.placeNote)}</p>` : ''}${event.photo ? `<button type="button" class="review-photo-button" data-review-photo aria-haspopup="dialog" aria-label="查看${escapeHtml(event.placeName || event.title)}的地点图片"><img loading="lazy" src="${escapeHtml(event.photo)}" alt="${escapeHtml(event.placeName || event.title)}的地点图片"><span>查看大图</span></button>` : ''}</article>`).join('')}</section>`).join('') || '<p class="hint">当前方案暂无安排，可在时间表中添加。</p>';
    const daySections = dialog.querySelectorAll('.review-day');
    days.forEach((day, index) => {
      daySections[index].dataset.reviewDate = day.date || 'undated';
      const summary = document.createElement('details');
      summary.className = 'review-expenses';
      const heading = document.createElement('summary');
      heading.textContent = day.expenseTotal === null ? '暂无费用记录' : `已记录费用 ¥${day.expenseTotal.toFixed(2)} · ${day.expenses.length} 项`;
      summary.append(heading);
      day.expenses.forEach(entry => {
        const row = document.createElement('p');
        row.textContent = `${entry.category || '其他'} · ${entry.event ? `${entry.event} · ` : ''}${entry.item || '支出'}：¥${entry.amount.toFixed(2)}`;
        summary.append(row);
      });
      daySections[index].querySelector('h4').after(summary);
      if (canEdit() && editEvent) {
        daySections[index].querySelectorAll('.review-event').forEach((article, eventIndex) => {
          const event = day.events[eventIndex];
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'ghost review-edit-button';
          button.dataset.reviewEdit = String(event.eventIndex);
          button.textContent = '编辑安排 / 备注';
          button.setAttribute('aria-label', `编辑安排与备注：${event.title}`);
          article.append(button);
        });
      }
    });
  };
  const open = event => {
    if (dialog.open) return;
    opener = event?.detail?.opener || document.activeElement;
    render();
    dateNavigation.reset();
    dialog.showModal();
    dialog.querySelector('[data-review-close]').focus();
    dialog.querySelector('.editor-form').scrollTop = 0;
  };
  dialog.querySelector('[data-review-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { if (opener?.isConnected) opener.focus(); });
  window.addEventListener('mobile:review', open);
  const handleViewChange = event => {
    if (event.detail?.view !== 'plans' && dialog.open) dialog.close();
  };
  window.addEventListener('mobile:viewchange', handleViewChange);
  return { destroy() { window.removeEventListener('mobile:review', open); window.removeEventListener('mobile:viewchange', handleViewChange); photoPreview.destroy(); dialog.remove(); } };
}
