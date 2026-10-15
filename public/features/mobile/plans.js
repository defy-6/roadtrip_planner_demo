import { mobileIcon } from './icons.js';
import { createTripRenameDialog } from './trip-rename.js';

const click = (selector, opener) => {
  opener?.focus({ preventScroll: true });
  document.querySelector(selector)?.click();
};

export function createMobilePlans(hero) {
  if (!hero || document.querySelector('.mobile-plans-panel')) return;
  const renameDialog = createTripRenameDialog({
    getName: () => document.querySelector('#tripName')?.value || '',
    onRename: name => window.dispatchEvent(new CustomEvent('mobile:triprename', { detail: { name } }))
  });
  const panel = document.createElement('section'); panel.className = 'mobile-plans-panel';
  let requestedPlanFocus = null;
  panel.innerHTML = `
    <section class="mobile-current-plan"><div class="mobile-plan-cover">${mobileIcon('plans')}</div><div><small data-trip-context></small><small data-plan-label>当前方案</small><b data-plan-title>当前行程方案</b><small data-plan-dates>正在载入日期…</small><small data-plan-summary></small></div><p class="mobile-plan-load-status" role="status" data-plan-load-status hidden></p><button type="button" class="mobile-plan-retry" data-plan-retry hidden>重试读取</button><nav class="mobile-plan-browse" aria-label="当前方案查看入口"><a href="#schedule">查看时间表</a><a href="#map">查看地图</a></nav></section>
    <section class="mobile-action-card mobile-plan-list"><h3>行程方案 <small data-plan-count>方案级</small></h3><div data-plan-list></div><button type="button" data-command="#newPlanBtn"><span>＋</span>新建行程方案<i>›</i></button><button type="button" data-command="#copyPlanBtn"><span>▣</span>复制当前方案<i>›</i></button><button type="button" class="is-danger" data-command="#deletePlanBtn"><span>⌫</span>删除当前方案<i>›</i></button></section>
    <section class="mobile-action-card"><h3>方案内容 <small>方案级</small></h3><button type="button" data-accounting><span>¥</span>每日开销<i>›</i></button><button type="button" data-command="#updateScheduleWeather"><span>☁</span>更新可见天气<i>›</i></button><button type="button" data-command="#importFlightBtn"><span>✈</span>导入航班 / 动车<i>›</i></button></section>
    <section class="mobile-action-card"><h3>导出当前方案 <small>方案级 · 非完整备份</small></h3><button type="button" data-command="#exportBtn"><span>⇩</span>导出当前方案 JSON<i>›</i></button><button type="button" data-command="#exportSchedulePng"><span>▧</span>导出时间表 PNG<i>›</i></button><button type="button" data-command="#exportMapPng"><span>▱</span>导出地图 PNG<i>›</i></button></section>
    <section class="mobile-action-card mobile-account-card"><h3>行程空间 <small>行程级</small></h3><button type="button" data-account><span>👤</span><span data-account-label>登录 / 协作</span><i>›</i></button><button type="button" data-save><span>💾</span>立即保存整个行程<i>›</i></button><button type="button" data-triprename><span>✎</span>重命名行程<i>›</i></button></section>`;
  for (const [action, label] of [['export', '导出待同步备份'], ['discard', '放弃队列并读取云端']]) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'mobile-plan-retry';
    button.dataset.pendingAction = action; button.hidden = true; button.textContent = label;
    panel.querySelector('.mobile-current-plan').insertBefore(button, panel.querySelector('.mobile-plan-browse'));
  }
  panel.addEventListener('click', event => {
    const pendingAction = event.target.closest('[data-pending-action]')?.dataset.pendingAction;
    if (pendingAction) { window.dispatchEvent(new CustomEvent(`planner:pending${pendingAction}`)); return; }
    const reviewOpener = event.target.closest('[data-review]');
    if (reviewOpener) { window.dispatchEvent(new CustomEvent('mobile:review', { detail: { opener: reviewOpener } })); return; }
    if (event.target.closest('[data-plan-retry]')) { dataStatus = 'loading'; sync(); window.dispatchEvent(new CustomEvent('planner:retry')); return; }
    if (event.target.closest('button')?.disabled) return;
    if (event.target.closest('[data-save]')) { window.dispatchEvent(new CustomEvent('mobile:save')); return; }
    if (event.target.closest('[data-account]')) { window.dispatchEvent(new CustomEvent('account:open')); return; }
    const renameOpener = event.target.closest('[data-triprename]');
    if (renameOpener) { renameDialog.open(renameOpener); return; }
    const accountingOpener = event.target.closest('[data-accounting]');
    if (accountingOpener) { window.dispatchEvent(new CustomEvent('mobile:accountingopen', { detail: { opener: accountingOpener } })); return; }
    const plan = event.target.closest('[data-plan-value]')?.dataset.planValue;
    if (plan) { requestedPlanFocus = plan; const select = document.querySelector('#planSelect'); select.value = plan; select.dispatchEvent(new Event('change', { bubbles: true })); return; }
    const command = event.target.closest('[data-command]'); if (command) click(command.dataset.command, command);
  });
  const select = document.querySelector('#planSelect'), dayFilter = document.querySelector('#dayFilter');
  const currentPlan = panel.querySelector('.mobile-current-plan');
  currentPlan.tabIndex = -1;
  currentPlan.setAttribute('role', 'region');
  currentPlan.querySelector('[data-plan-title]').id = 'mobile-current-plan-title';
  currentPlan.setAttribute('aria-labelledby', 'mobile-current-plan-title');
  ['trip-context', 'plan-dates', 'plan-summary'].forEach(name => {
    currentPlan.querySelector(`[data-${name}]`).id = `mobile-current-${name}`;
  });
  currentPlan.setAttribute('aria-describedby', 'mobile-current-trip-context mobile-current-plan-dates mobile-current-plan-summary');
  let dataStatus = 'loading';
  const sync = () => {
    const pending = dataStatus === 'loading';
    const unavailable = pending || dataStatus === 'error';
    const overview = panel.querySelector('.mobile-current-plan');
    overview.setAttribute('aria-busy', String(pending));
    const browse = overview.querySelector('.mobile-plan-browse');
    // Set the attribute explicitly. The WebKit runtime used by the release
    // gate does not reliably reflect an `inert` property assignment, which
    // also prevents the CSS fallback from taking effect.
    browse.toggleAttribute('inert', unavailable);
    browse.querySelectorAll('a').forEach(link => { link.tabIndex = unavailable ? -1 : 0; });
    const loadStatus = panel.querySelector('[data-plan-load-status]');
    loadStatus.hidden = dataStatus === 'ready';
    loadStatus.classList.toggle('is-offline', ['offline', 'preset', 'error', 'draft', 'pending-conflict', 'pending-offline'].includes(dataStatus));
    loadStatus.textContent = {
      loading: '正在读取行程数据…', offline: '当前显示离线缓存，最新内容尚未同步。',
      preset: '未能读取行程数据，当前显示本地预设，请刷新重试。', error: '初始化未完成，请刷新或重新登录。',
      draft: '未保存的本地修改已保留，请先导出 JSON，再决定是否放弃并重试。',
      'pending-conflict': '本地待同步修改与云端版本冲突，已保留原队列；请先导出待同步备份，再核对处理。',
      'pending-offline': '本地待同步修改尚未上传，原队列已保留，请重试。'
    }[dataStatus] || '';
    const retry = panel.querySelector('[data-plan-retry]');
    if (retry) retry.hidden = !['offline', 'preset', 'error', 'draft', 'pending-conflict', 'pending-offline'].includes(dataStatus);
    panel.querySelectorAll('[data-pending-action]').forEach(button => { button.hidden = !dataStatus.startsWith('pending-'); });
    const tripName = document.querySelector('#tripName')?.value.trim();
    const tripContext = panel.querySelector('[data-trip-context]');
    tripContext.textContent = tripName ? `${dataStatus === 'preset' ? '本地预设' : '所属行程'}：${tripName}` : '';
    tripContext.hidden = unavailable || !tripName;
    panel.querySelector('[data-plan-label]').textContent = dataStatus === 'preset' ? '本地预设方案' : '当前方案';
    const active = select.selectedOptions[0]; panel.querySelector('[data-plan-title]').textContent = pending ? '正在加载行程…' : dataStatus === 'error' ? '行程尚未就绪' : active?.textContent || '当前行程方案';
    const dates = [...dayFilter.options].map(option => option.value).filter(Boolean), value = dayFilter.value;
    dates.sort();
    panel.querySelector('[data-plan-dates]').textContent = unavailable ? '' : dates.length > 1 ? `${dates[0]} — ${dates[dates.length - 1]}` : dates[0] || '尚未添加日期';
    panel.querySelector('[data-plan-summary]').textContent = unavailable ? '' : dates.length ? `当前方案：${dates.length} 个有安排日期` : '当前方案暂无安排';
    panel.querySelector('[data-plan-count]').textContent = unavailable ? '尚未载入' : `${select.options.length} 个方案`;
    const list = panel.querySelector('[data-plan-list]');
    list.replaceChildren(...[...select.options].filter(option => !option.selected).map(option => {
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.planValue = option.value;
      button.setAttribute('aria-label', `切换到行程方案：${option.textContent}`);
      button.innerHTML = `<span>${mobileIcon('plans')}</span><span class="mobile-plan-option-name"></span><i aria-hidden="true">›</i>`;
      button.querySelector('.mobile-plan-option-name').textContent = option.textContent;
      return button;
    }));
    const weather = panel.querySelector('[data-command="#updateScheduleWeather"]'); if (weather) { const date = value ? new Date(`${value}T00:00:00`) : null; weather.childNodes[1].textContent = date ? `更新 ${date.getMonth() + 1}月${date.getDate()}日天气` : '更新全部日期天气'; }
    const accountLabel = panel.querySelector('[data-account-label]'); if (accountLabel) { let token = null; try { token = localStorage.getItem('roadtrip-token'); } catch { /* 忽略 */ } accountLabel.textContent = token ? '账号 / 行程 / 协作' : '登录 / 注册'; }
  };
  const icons = ['add', 'copy', 'trash', 'wallet', 'weather', 'transport', 'export', 'schedule', 'map', 'account', 'save', 'edit'];
  panel.querySelectorAll('.mobile-action-card > button').forEach((button, index) => {
    button.firstElementChild.innerHTML = mobileIcon(icons[index]);
    button.querySelector('i')?.setAttribute('aria-hidden', 'true');
  });
  const syncCommands = () => {
    panel.querySelectorAll('[data-command]').forEach(button => {
      const source = document.querySelector(button.dataset.command);
      button.disabled = !source || source.disabled;
      if (button.dataset.command === '#deletePlanBtn') {
        let hint = panel.querySelector('[data-delete-hint]');
        if (!hint) {
          hint = document.createElement('p'); hint.dataset.deleteHint = ''; hint.id = 'mobile-plan-delete-hint';
          hint.className = 'mobile-plan-command-hint'; button.after(hint);
          button.setAttribute('aria-describedby', hint.id);
        }
        hint.hidden = !button.disabled;
        hint.textContent = select.options.length <= 1 ? '至少保留一个方案。' : '当前方案暂不可删除，请检查编辑权限。';
      }
    });
  };
  const reviewSection = document.createElement('section');
  reviewSection.className = 'mobile-action-card';
  reviewSection.innerHTML = `<h3>旅行回顾 <small>当前方案</small></h3><button type="button" data-review aria-haspopup="dialog" aria-controls="planReviewDialog"><span>${mobileIcon('schedule')}</span>查看安排与记录<i aria-hidden="true">›</i></button>`;
  panel.querySelector('.mobile-current-plan').after(reviewSection);
  new MutationObserver(syncCommands).observe(document.querySelector('.app-header'), { subtree: true, attributes: true, attributeFilter: ['disabled'], childList: true });
  window.addEventListener('mobile:viewchange', syncCommands);
  window.addEventListener('mobile:viewchange', sync);
  window.addEventListener('planner:ready', event => { dataStatus = event.detail?.dataStatus || 'ready'; sync(); });
  window.addEventListener('planner:saveblocked', event => { dataStatus = event.detail?.dataStatus || 'draft'; sync(); });
  window.addEventListener('mobile:triprename', () => setTimeout(sync));
  select.addEventListener('change', () => setTimeout(() => {
    sync();
    const requested = requestedPlanFocus;
    requestedPlanFocus = null;
    if (requested === select.value && document.body.dataset.mobileView === 'plans' && !document.querySelector('dialog[open]')) {
      currentPlan.focus({ preventScroll: true });
      panel.scrollTop = 0;
    }
  })); dayFilter.addEventListener('change', sync);
  new MutationObserver(sync).observe(select, { childList: true, subtree: true }); new MutationObserver(sync).observe(dayFilter, { childList: true });
  sync(); syncCommands(); document.querySelector('.app-header').insertAdjacentElement('afterend', panel);
}
