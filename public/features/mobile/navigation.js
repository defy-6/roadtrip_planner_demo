import { localToday } from '../../core/utils.js';

const MOBILE_VIEWS = new Set(['schedule', 'map', 'places', 'plans']);

function viewFromHash() {
  const value = window.location.hash.replace(/^#\/?/, '');
  return MOBILE_VIEWS.has(value) ? value : 'schedule';
}

export function createMobileNavigation({ previewMode }) {
  if (previewMode !== 'mobile') return { initialize() {}, destroy() {} };

  const nav = document.querySelector('.mobile-tabbar');
  const links = [...nav.querySelectorAll('[data-mobile-view]')];

  function render() {
    const view = viewFromHash();
    document.body.dataset.mobileView = view;
    links.forEach(link => {
      const active = link.dataset.mobileView === view;
      link.classList.toggle('is-active', active);
      link.toggleAttribute('aria-current', active);
    });
    // 切回时间表/地图时默认显示当日：仅当当前未筛选（或为全部）且今天在行程日期内时设为今天；
    // 用户已手动选择某天则保留。地图筛选跟随 dayFilter，一并生效。
    if (view === 'schedule' || view === 'map') {
      const dayFilter = document.querySelector('#dayFilter');
      if (dayFilter && !dayFilter.value) {
        const today = localToday();
        if ([...dayFilter.options].some(option => option.value === today)) {
          dayFilter.value = today;
          dayFilter.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }
    if (view === 'map') setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
    window.dispatchEvent(new CustomEvent('mobile:viewchange', { detail: { view } }));
    document.scrollingElement?.scrollTo(0, 0);
    document.querySelector('main')?.scrollTo(0, 0);
  }

  function initialize() {
    if (!MOBILE_VIEWS.has(window.location.hash.replace(/^#\/?/, ''))) {
      history.replaceState(null, '', '#schedule');
    }
    window.addEventListener('hashchange', render);
    window.addEventListener('pageshow', render);
    render();
  }

  function destroy() { window.removeEventListener('hashchange', render); window.removeEventListener('pageshow', render); }
  return { initialize, destroy };
}
