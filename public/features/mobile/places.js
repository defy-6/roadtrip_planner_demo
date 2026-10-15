const click = selector => document.querySelector(selector)?.click();

export function createMobilePlaces(panel) {
  if (!panel || panel.querySelector('.mobile-place-tabs')) return;
  const heading = panel.querySelector('.aside-head h3');
  if (heading?.firstChild?.nodeType === Node.TEXT_NODE) heading.firstChild.textContent = '地点库 ';
  const chrome = document.createElement('div'); chrome.className = 'mobile-place-tabs';
  chrome.innerHTML = '<div class="mobile-segmented" role="group" aria-label="地点范围"><button type="button" class="is-selected" aria-pressed="true">当前行程</button><button type="button" data-place-action="universal" aria-haspopup="dialog" aria-controls="universalPlaceDialog" aria-pressed="false">我的地点库 ↗</button></div><div class="mobile-category-chips" role="group" aria-label="地点类别"></div><div class="mobile-place-selection-actions" hidden><span data-place-selection-count>已选 0 项</span><button type="button" data-place-batch="all">全选结果</button><button type="button" data-place-batch="resolve">查询位置</button><button type="button" data-place-batch="photos">获取图片</button><button type="button" data-place-batch="delete" class="danger">删除</button></div>';
  const select = document.querySelector('#placeTypeFilter');
  const chips = chrome.querySelector('.mobile-category-chips');
  let selectionEnabled = false;
  const escapeHtml = value => String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const renderChips = () => {
    const selected = select?.value || '';
    const options = [...(select?.options || [])].filter(option => option.value && option.value !== 'drive');
    chips.innerHTML = `<button type="button" data-type="" aria-pressed="${!selected}" class="${selected ? '' : 'is-selected'}">全部</button>${options.map(option => `<button type="button" data-type="${escapeHtml(option.value)}" aria-pressed="${selected === option.value}" class="${selected === option.value ? 'is-selected' : ''}">${escapeHtml(option.textContent)}</button>`).join('')}<button type="button" data-place-action="selection" aria-pressed="${selectionEnabled}" class="${selectionEnabled ? 'is-selected' : ''}">${selectionEnabled ? '完成' : '多选'}</button><button type="button" data-place-action="cleanup" class="mobile-cleanup-places" aria-label="清除未关联地点">清除未关联</button>`;
  };
  chrome.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.placeAction === 'universal') {
      button.focus({ preventScroll: true });
      return click('#placeLibraryBtn');
    }
    if (button.dataset.placeAction === 'category') return click('#addPlaceCategoryBtn');
    if (button.dataset.placeAction === 'cleanup') return click('#cleanupUnusedPlaces');
    if (button.dataset.placeAction === 'selection') return click('#togglePlaceSelection');
    const batchTargets = { all: '#selectAllPlaces', resolve: '#resolveSelectedPlaces', photos: '#fetchSelectedPhotos', delete: '#deleteSelectedPlaces' };
    if (button.dataset.placeBatch) return click(batchTargets[button.dataset.placeBatch]);
    if (button.hasAttribute('data-type')) { const select = document.querySelector('#placeTypeFilter'); select.value = button.dataset.type; select.dispatchEvent(new Event('change', { bubbles: true })); chrome.querySelectorAll('[data-type]').forEach(item => item.classList.toggle('is-selected', item === button)); }
  });
  panel.querySelector('.aside-head')?.insertAdjacentElement('afterend', chrome);
  select?.addEventListener('change', renderChips);
  if (select) new MutationObserver(renderChips).observe(select, { childList: true });
  window.addEventListener('places:selectionchange', event => {
    selectionEnabled = Boolean(event.detail?.enabled);
    chrome.querySelector('.mobile-place-selection-actions').hidden = !selectionEnabled;
    const button = chrome.querySelector('[data-place-action="selection"]');
    if (button) { button.textContent = selectionEnabled ? '完成' : '多选'; button.setAttribute('aria-pressed', String(selectionEnabled)); button.classList.toggle('is-selected', selectionEnabled); }
  });
  window.addEventListener('places:selectionupdate', event => {
    const count = chrome.querySelector('[data-place-selection-count]');
    if (count) count.textContent = `已选 ${Number(event.detail?.count || 0)} 项`;
  });
  renderChips();
}
