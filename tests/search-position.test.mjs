import assert from 'node:assert/strict';
import test from 'node:test';
import { createSearchPosition } from '../public/features/schedule/search-position.js';

test('search panel follows form and visual viewport movement while hidden panels remain untouched', () => {
  const form = new EventTarget();
  const viewport = Object.assign(new EventTarget(), { offsetTop: 0, height: 640 });
  let top = 420;
  const dialog = { getBoundingClientRect: () => ({ top: 40 }), querySelector: () => ({ getBoundingClientRect: () => ({ top: 550 }) }) };
  const input = {
    ownerDocument: { defaultView: { visualViewport: viewport, innerHeight: 640 }, documentElement: { dataset: { previewMode: 'mobile' } } },
    getBoundingClientRect: () => ({ top, bottom: top + 44 }),
    closest: selector => selector === '.editor-form' ? form : dialog
  };
  const panel = { hidden: false, style: {}, dataset: {} };
  const position = createSearchPosition({ input, panel });
  position.fit();
  assert.equal(panel.dataset.placement, 'above');
  assert.equal(panel.style.top, '52px');
  top -= 30;
  form.dispatchEvent(new Event('scroll'));
  assert.equal(panel.style.top, '22px');
  viewport.offsetTop = 10;
  viewport.dispatchEvent(new Event('scroll'));
  assert.equal(panel.style.top, '22px');
  top = 300;
  form.dispatchEvent(new Event('scroll'));
  assert.equal(panel.dataset.placement, 'below');
  assert.equal(panel.style.top, '304px');
  assert.equal(panel.style.maxHeight, '194px');
  panel.hidden = true;
  top += 80;
  form.dispatchEvent(new Event('scroll'));
  assert.equal(panel.style.top, '304px');
});
