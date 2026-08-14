import { calculatePriceInfo, normalizedPriceItems } from './model.js';

export function createCostEditor({ root, totalNode }) {
  const perPersonContainer = () => root.querySelector('#editorPerPersonPrices');
  const sharedContainer = () => root.querySelector('#editorSharedPrices');

  function addLine(kind, item = {}) {
    const target = kind === 'person' ? perPersonContainer() : sharedContainer();
    if (!target) return;
    const line = document.createElement('div');
    line.className = 'editor-price-line';
    line.style.cssText = 'display:grid;grid-template-columns:1fr 86px 1.5fr auto;gap:7px;margin:5px 0';
    if (kind === 'person') line.innerHTML = '<input data-price-amount type="number" min="0" step="0.01" placeholder="单价（元）"><input data-price-people type="number" min="1" step="1" placeholder="人数"><input data-price-note placeholder="例如：学生票"><button type="button" class="danger" data-remove-price>×</button>';
    else { line.style.gridTemplateColumns = '1fr 2fr auto'; line.innerHTML = '<input data-price-amount type="number" min="0" step="0.01" placeholder="金额（元）"><input data-price-note placeholder="例如：酒店两晚 / 晚餐"><button type="button" class="danger" data-remove-price>×</button>'; }
    line.dataset.priceKind = kind;
    line.querySelector('[data-price-amount]').value = item.amount ?? '';
    if (kind === 'person') line.querySelector('[data-price-people]').value = item.people ?? '';
    line.querySelector('[data-price-note]').value = item.note ?? '';
    target.append(line);
  }

  function collect() {
    const perPersonItems = [...perPersonContainer().querySelectorAll('.editor-price-line')].map(line => ({ amount: Number(line.querySelector('[data-price-amount]').value || 0), people: Math.max(1, Number(line.querySelector('[data-price-people]').value || 1)), note: line.querySelector('[data-price-note]').value.trim() })).filter(item => item.amount || item.note);
    const sharedItems = [...sharedContainer().querySelectorAll('.editor-price-line')].map(line => ({ amount: Number(line.querySelector('[data-price-amount]').value || 0), note: line.querySelector('[data-price-note]').value.trim() })).filter(item => item.amount || item.note);
    return calculatePriceInfo(perPersonItems, sharedItems);
  }

  function updateTotal() {
    const info = collect();
    if (totalNode()) totalNode().textContent = info ? `自动汇总：${info.total.toFixed(2)} 元` : '费用可留空；单人费用与共同费用会自动相加。';
  }

  function render(info) {
    perPersonContainer().innerHTML = ''; sharedContainer().innerHTML = '';
    const items = normalizedPriceItems(info);
    (items.perPersonItems.length ? items.perPersonItems : [{}]).forEach(item => addLine('person', item));
    (items.sharedItems.length ? items.sharedItems : [{}]).forEach(item => addLine('shared', item));
    updateTotal();
  }

  root.addEventListener('input', updateTotal);
  root.addEventListener('click', event => {
    const add = event.target.closest('[data-add-price]');
    if (add) { addLine(add.dataset.addPrice); updateTotal(); }
    const remove = event.target.closest('[data-remove-price]');
    if (remove) { remove.closest('.editor-price-line')?.remove(); updateTotal(); }
  });
  return { render, collect, updateTotal };
}
