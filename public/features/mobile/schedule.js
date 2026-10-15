export function createMobileSchedule(panel) {
  if (!panel || panel.querySelector('.mobile-date-strip')) return;
  panel.classList.add('is-expanded');
  const strip = document.createElement('div');
  strip.className = 'mobile-date-strip';
  strip.innerHTML = `<div class="mobile-calendar-head"><b data-week-title></b></div><div class="mobile-weekdays" aria-label="行程日期"></div><div class="mobile-view-switch" role="tablist" aria-label="时间表视图"><button type="button" role="tab" aria-controls="schedule" aria-selected="false" aria-pressed="false">列表</button><button type="button" role="tab" class="is-selected" aria-controls="schedule" aria-selected="true" aria-pressed="true">时间轴</button></div>`;
  panel.querySelector('.aside-head')?.insertAdjacentElement('afterend', strip);
  const dayFilter = document.querySelector('#dayFilter');
  const weekdays = strip.querySelector('.mobile-weekdays');
  let lastSingleDate = dayFilter.value || '';
  let weatherBackgroundsEnabled = localStorage.getItem('roadtrip-weather-backgrounds') === '1';
  document.body.classList.toggle('weather-backgrounds-enabled', weatherBackgroundsEnabled);
  const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  let positionRequest = 0;
  let programmaticPositioning = false;
  const positionTimeline = ({ force = false } = {}) => {
    const request = ++positionRequest;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (request !== positionRequest || panel.classList.contains('mobile-list-view')) return;
      const scroll = panel.querySelector('.schedule-scroll');
      if (!scroll || (!force && scroll.dataset.positionedDate === dayFilter.value)) return;
      const today = iso(new Date());
      const selected = dayFilter.value;
      let target = selected === today ? scroll.querySelector('.current-time-line') : scroll.querySelector('.calendar-block');
      if (!target && selected === today) target = scroll.querySelector('.calendar-block');
      const top = target ? Math.max(0, target.offsetTop - scroll.clientHeight * (selected === today ? .34 : .16)) : 0;
      programmaticPositioning = true;
      scroll.scrollTo({ top, left: 0, behavior: force ? 'smooth' : 'auto' });
      setTimeout(() => { programmaticPositioning = false; }, force ? 420 : 40);
      scroll.dataset.positionedDate = selected;
    }));
  };
  const renderDates = () => {
    const dates = [...dayFilter.options].map(option => option.value).filter(Boolean);
    if (!dates.length) {
      strip.querySelector('[data-week-title]').textContent = '暂无行程日期';
      weekdays.replaceChildren();
      lastSingleDate = '';
      return;
    }
    const first = new Date(`${dates[0]}T00:00:00`), last = new Date(`${dates[dates.length - 1]}T00:00:00`);
    strip.querySelector('[data-week-title]').textContent = `${first.getMonth() + 1}月${first.getDate()}日 — ${last.getMonth() + 1}月${last.getDate()}日`;
    weekdays.innerHTML = dates.map(value => { const date = new Date(`${value}T00:00:00`); return `<button type="button" data-date="${iso(date)}" aria-label="${value} 星期${'日一二三四五六'[date.getDay()]}" aria-pressed="${dayFilter.value === value}" class="${dayFilter.value === value ? 'is-selected' : ''}"><small>${'日一二三四五六'[date.getDay()]}</small><b>${date.getDate()}</b></button>`; }).join('');
    weekdays.querySelector('.is-selected')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  };
  weekdays.addEventListener('click', event => {
    const button = event.target.closest('[data-date]'); if (!button) return;
    dayFilter.value = button.dataset.date; dayFilter.dispatchEvent(new Event('change', { bubbles: true }));
    renderDates(); positionTimeline({ force: true });
  });
  const syncDateControls = () => {
    if (dayFilter.value) lastSingleDate = dayFilter.value;
    renderDates();
    const controls = timelineControls();
    controls?.classList.toggle('is-all-dates', !dayFilter.value);
    const dateSelect = controls?.querySelector('.mobile-timeline-date');
    if (dateSelect) dateSelect.value = dayFilter.value;
    const allDatesBtn = controls?.querySelector('.mobile-all-dates-btn');
    allDatesBtn?.classList.toggle('is-active', !dayFilter.value);
    allDatesBtn?.setAttribute('aria-pressed', String(!dayFilter.value));
  };
  dayFilter.addEventListener('change', syncDateControls);
  [...strip.querySelectorAll('.mobile-view-switch button')].forEach((button, index, switches) => button.addEventListener('click', () => {
    panel.classList.toggle('mobile-list-view', index === 0);
    switches.forEach(item => {
      item.classList.toggle('is-selected', item === button);
      item.setAttribute('aria-selected', String(item === button));
      item.setAttribute('aria-pressed', String(item === button));
    });
    positionTimeline({ force: true });
    window.dispatchEvent(new CustomEvent('schedule:viewmodechange'));
    if (index === 0) panel.querySelector('.schedule-scroll')?.scrollTo({ top: 0, left: 0 });
  }));
  // 多选模式：进入后点击事件盒可勾选；长按已选事件可整组拖动；退出时清空选择。
  const timelineControls = () => panel.querySelector('.mobile-timeline-controls');
  const setMultiselect = on => {
    document.body.classList.toggle('mobile-multiselect', on);
    const controls = timelineControls();
    const multiselectBtn = controls?.querySelector('.mobile-multiselect-btn');
    const selectCount = controls?.querySelector('.mobile-select-count');
    const selectDone = controls?.querySelector('.mobile-select-done');
    multiselectBtn?.classList.toggle('is-active', on);
    multiselectBtn?.setAttribute('aria-pressed', String(on));
    if (selectCount) selectCount.hidden = !on;
    if (selectDone) selectDone.hidden = !on;
    window.dispatchEvent(new CustomEvent('mobile:multiselect', { detail: { on } }));
  };
  const mountTimelineControls = () => {
    if (panel.classList.contains('mobile-list-view')) return;
    const heads = [...panel.querySelectorAll('.calendar-head')];
    const head = heads.find(item => item.dataset.date === dayFilter.value) || heads[0];
    if (!head) { panel.querySelector('.mobile-timeline-controls')?.remove(); return; }
    if (panel.querySelector('.mobile-timeline-controls')) return;
    const originalLabel = [head.querySelector('b')?.textContent, head.querySelector('small')?.textContent].filter(Boolean).join(' ');
    const controls = document.createElement('div');
    controls.className = `mobile-timeline-controls${dayFilter.value ? '' : ' is-all-dates'}`;
    controls.innerHTML = `<span class="mobile-timeline-date-fallback">${originalLabel}</span><select class="mobile-timeline-date" aria-label="选择时间表日期"><option value="">选择日期</option>${[...dayFilter.options].filter(option => option.value).map(option => `<option value="${option.value}">${option.textContent}</option>`).join('')}</select><button type="button" class="mobile-weather-background-btn" aria-pressed="${weatherBackgroundsEnabled}" title="切换天气背景">天气背景</button><button type="button" class="mobile-all-dates-btn" aria-pressed="${!dayFilter.value}">全部日期</button><button type="button" class="mobile-multiselect-btn" aria-pressed="false">多选</button><span class="mobile-select-count" hidden>已选 0 项</span><button type="button" class="mobile-select-done" hidden>完成</button>`;
    strip.append(controls);
    const dateSelect = controls.querySelector('.mobile-timeline-date');
    dateSelect.value = dayFilter.value;
    dateSelect.addEventListener('change', () => {
      if (!dateSelect.value) return;
      dayFilter.value = dateSelect.value;
      dayFilter.dispatchEvent(new Event('change', { bubbles: true }));
      positionTimeline({ force: true });
    });
    const weatherBackgroundBtn = controls.querySelector('.mobile-weather-background-btn');
    weatherBackgroundBtn.classList.toggle('is-active', weatherBackgroundsEnabled);
    weatherBackgroundBtn.addEventListener('click', () => {
      weatherBackgroundsEnabled = !weatherBackgroundsEnabled;
      localStorage.setItem('roadtrip-weather-backgrounds', weatherBackgroundsEnabled ? '1' : '0');
      document.body.classList.toggle('weather-backgrounds-enabled', weatherBackgroundsEnabled);
      weatherBackgroundBtn.classList.toggle('is-active', weatherBackgroundsEnabled);
      weatherBackgroundBtn.setAttribute('aria-pressed', String(weatherBackgroundsEnabled));
    });
    const allDatesBtn = controls.querySelector('.mobile-all-dates-btn');
    allDatesBtn.classList.toggle('is-active', !dayFilter.value);
    allDatesBtn.addEventListener('click', () => {
      if (dayFilter.value) {
        lastSingleDate = dayFilter.value;
        dayFilter.value = '';
      } else {
        const availableDates = [...dayFilter.options].map(option => option.value).filter(Boolean);
        const today = iso(new Date());
        dayFilter.value = availableDates.includes(lastSingleDate) ? lastSingleDate : availableDates.includes(today) ? today : availableDates[0] || '';
      }
      dayFilter.dispatchEvent(new Event('change', { bubbles: true }));
      positionTimeline({ force: true });
    });
    controls.querySelector('.mobile-multiselect-btn').addEventListener('click', () => setMultiselect(!document.body.classList.contains('mobile-multiselect')));
    controls.querySelector('.mobile-select-done').addEventListener('click', () => setMultiselect(false));
    setMultiselect(document.body.classList.contains('mobile-multiselect'));
  };
  // 更新已选计数
  window.addEventListener('mobile:selectionchange', () => {
    if (document.body.classList.contains('mobile-multiselect')) {
      const selectCount = timelineControls()?.querySelector('.mobile-select-count');
      if (selectCount) selectCount.textContent = `已选 ${document.querySelectorAll('.calendar-block.batch-selected').length} 项`;
    }
  });
  window.addEventListener('mobile:viewchange', event => {
    if (event.detail?.view === 'schedule') return;
    // 切走视图时自动退出多选模式
    if (document.body.classList.contains('mobile-multiselect')) setMultiselect(false);
  });
  window.addEventListener('mobile:viewchange', event => {
    document.body.classList.remove('mobile-header-collapsed');
    if (event.detail?.view === 'schedule') positionTimeline();
  });
  new MutationObserver(() => { mountTimelineControls(); syncDateControls(); syncWeatherLabel(); }).observe(dayFilter, { childList: true });
  new MutationObserver(mountTimelineControls).observe(panel.querySelector('#schedule'), { childList: true, subtree: true });
  const syncWeatherLabel = () => { const value = dayFilter.value; const date = value ? new Date(`${value}T00:00:00`) : null; const button = document.querySelector('#updateScheduleWeather'); if (button) button.textContent = date ? `更新 ${date.getMonth() + 1}月${date.getDate()}日天气` : '更新全部日期天气'; };
  dayFilter.addEventListener('change', syncWeatherLabel); syncWeatherLabel();
  const bindScrollCollapse = () => {
    const scroll = panel.querySelector('.schedule-scroll');
    if (!scroll || scroll.dataset.collapseBound) return;
    scroll.dataset.collapseBound = '1';
    scroll.addEventListener('scroll', () => {
      if (programmaticPositioning || document.body.dataset.mobileView !== 'schedule') return;
      document.body.classList.toggle('mobile-header-collapsed', scroll.scrollTop > 36);
    }, { passive: true });
  };
  new MutationObserver(() => { bindScrollCollapse(); positionTimeline(); }).observe(panel.querySelector('#schedule'), { childList: true });
  window.addEventListener('schedule:autoposition', () => positionTimeline({ force: true }));
  renderDates(); mountTimelineControls(); bindScrollCollapse(); positionTimeline();
}
