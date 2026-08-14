const click = selector => document.querySelector(selector)?.click();

export function createMobilePlaces(panel) {
  if (!panel || panel.querySelector('.mobile-place-tabs')) return;
  const chrome = document.createElement('div'); chrome.className = 'mobile-place-tabs';
  chrome.innerHTML = '<div class="mobile-segmented"><button type="button" class="is-selected">当前计划</button><button type="button" data-place-action="universal">通用地点库</button></div><div class="mobile-category-chips"><button type="button" data-type="" class="is-selected">全部</button><button type="button" data-type="spot">⛰ 景点</button><button type="button" data-type="food">♨ 餐饮</button><button type="button" data-type="hotel">▰ 住宿</button><button type="button" data-place-action="category">＋ 分类</button></div>';
  chrome.addEventListener('click', event => { const button = event.target.closest('button'); if (!button) return; if (button.dataset.placeAction === 'universal') return click('#placeLibraryBtn'); if (button.dataset.placeAction === 'category') return click('#addPlaceCategoryBtn'); if (button.hasAttribute('data-type')) { const select = document.querySelector('#placeTypeFilter'); select.value = button.dataset.type; select.dispatchEvent(new Event('change', { bubbles: true })); chrome.querySelectorAll('[data-type]').forEach(item => item.classList.toggle('is-selected', item === button)); } });
  panel.querySelector('.aside-head')?.insertAdjacentElement('afterend', chrome);
}
