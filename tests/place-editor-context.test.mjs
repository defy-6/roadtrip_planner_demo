import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlaceEditorContext } from '../public/features/places/editor-context.js';

test('place context refreshes named travel/plan fields and preserves existing descriptions without inventing dates', () => {
  const paragraph = { textContent: '', hidden: false };
  const attributes = new Map([['aria-describedby', 'placeHint']]);
  let current = { tripName: '测试旅行 <安全文本>', planName: '第一方案' };
  const dialog = {
    ownerDocument: { createElement: tag => { assert.equal(tag, 'p'); return paragraph; } },
    querySelector: selector => { assert.equal(selector, 'h3'); return { after: node => assert.equal(node, paragraph) }; },
    getAttribute: key => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value)
  };
  const context = createPlaceEditorContext({ dialog, getContext: () => current });
  context.render();
  assert.equal(paragraph.textContent, '所属行程：测试旅行 <安全文本>\n当前方案：第一方案');
  assert.equal(paragraph.hidden, false);
  assert.equal(attributes.get('aria-describedby'), 'placeHint placeEditorContext');
  current = { tripName: '另一旅行', planName: '第二方案' };
  context.render();
  assert.equal(paragraph.textContent, '所属行程：另一旅行\n当前方案：第二方案');
  current = {};
  context.render();
  assert.equal(paragraph.textContent, '');
  assert.equal(paragraph.hidden, true);
});
