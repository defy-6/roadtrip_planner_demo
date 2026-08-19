export function createMobileSchedule(panel) {
  if (!panel || panel.querySelector('.mobile-date-strip')) return;
  panel.classList.add('is-expanded');
  const strip = document.createElement('div');
  strip.className = 'mobile-date-strip';
  strip.innerHTML = `<div class="mobile-calendar-head"><b data-week-title></b></div><div class="mobile-select-toggle-row"><button type="button" class="mobile-multiselect-btn" aria-pressed="false">多选</button><span class="mobile-select-count" hidden>已选 0 项</span><button type="button" class="mobile-select-done" hidden>完成</button></div><div class="mobile-weekdays" aria-label="行程日期"></div><div class="mobile-view-switch" role="group" aria-label="时间表视图"><button type="button">列表</button><button type="button" class="is-selected">时间轴</button></div>`;
  panel.querySelector('.aside-head')?.insertAdjacentElement('afterend', strip);
  const dayFilter = document.querySelector('#dayFilter');
  const weekdays = strip.querySelector('.mobile-weekdays');
  const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const renderDates = () => {
    const dates = [...dayFilter.options].map(option => option.value).filter(Boolean);
    if (!dates.length) return;
    const first = new Date(`${dates[0]}T00:00:00`), last = new Date(`${dates.at(-1)}T00:00:00`);
    strip.querySelector('[data-week-title]').textContent = `${first.getMonth() + 1}月${first.getDate()}日 — ${last.getMonth() + 1}月${last.getDate()}日`;
    weekdays.innerHTML = dates.map(value => { const date = new Date(`${value}T00:00:00`); return `<button type="button" data-date="${iso(date)}" class="${dayFilter.value === value ? 'is-selected' : ''}"><small>${'日一二三四五六'[date.getDay()]}</small><b>${date.getDate()}</b></button>`; }).join('');
    weekdays.querySelector('.is-selected')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  };
  weekdays.addEventListener('click', event => {
    const button = event.target.closest('[data-date]'); if (!button) return;
    dayFilter.value = button.dataset.date; dayFilter.dispatchEvent(new Event('change', { bubbles: true }));
    panel.querySelector('.schedule-scroll')?.scrollTo(0, 0); renderDates();
  });
  dayFilter.addEventListener('change', renderDates);
  [...strip.querySelectorAll('.mobile-view-switch button')].forEach((button, index, switches) => button.addEventListener('click', () => {
    panel.classList.toggle('mobile-list-view', index === 0);
    switches.forEach(item => item.classList.toggle('is-selected', item === button));
    panel.querySelector('.schedule-scroll')?.scrollTo(0, 0);
  }));
  // 多选模式：进入后点击事件盒可勾选；长按已选事件可整组拖动；退出时清空选择。
  const multiselectBtn = strip.querySelector('.mobile-multiselect-btn');
  const selectCount = strip.querySelector('.mobile-select-count');
  const selectDone = strip.querySelector('.mobile-select-done');
  const setMultiselect = on => {
    document.body.classList.toggle('mobile-multiselect', on);
    multiselectBtn.classList.toggle('is-active', on);
    multiselectBtn.setAttribute('aria-pressed', String(on));
    selectCount.hidden = !on;
    selectDone.hidden = !on;
    window.dispatchEvent(new CustomEvent('mobile:multiselect', { detail: { on } }));
  };
  multiselectBtn.addEventListener('click', () => setMultiselect(!document.body.classList.contains('mobile-multiselect')));
  selectDone.addEventListener('click', () => setMultiselect(false));
  // 更新已选计数
  window.addEventListener('mobile:selectionchange', () => {
    if (document.body.classList.contains('mobile-multiselect')) {
      selectCount.textContent = `已选 ${document.querySelectorAll('.calendar-block.batch-selected').length} 项`;
    }
  });
  window.addEventListener('mobile:viewchange', event => {
    if (event.detail?.view === 'schedule') return;
    // 切走视图时自动退出多选模式
    if (document.body.classList.contains('mobile-multiselect')) setMultiselect(false);
  });
  window.addEventListener('mobile:viewchange', event => {
    if (event.detail?.view !== 'schedule') return;
    // 默认当日筛选由 navigation 统一处理；这里只负责滚动归位
    panel.querySelector('.schedule-scroll')?.scrollTo(0, 0);
  });
  new MutationObserver(renderDates).observe(dayFilter, { childList: true });
  const syncWeatherLabel = () => { const value = dayFilter.value; const date = value ? new Date(`${value}T00:00:00`) : null; const button = document.querySelector('#updateScheduleWeather'); if (button) button.textContent = date ? `更新 ${date.getMonth() + 1}月${date.getDate()}日天气` : '更新全部日期天气'; };
  dayFilter.addEventListener('change', syncWeatherLabel); syncWeatherLabel();
  window.addEventListener('mobile:viewchange', event => {
    if (event.detail?.view !== 'schedule') return;
    // 默认当日筛选由 navigation 统一处理；这里只负责滚动归位
    panel.querySelector('.schedule-scroll')?.scrollTo(0, 0);
  });
  renderDates();
}
