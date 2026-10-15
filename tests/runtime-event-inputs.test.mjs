import assert from 'node:assert/strict';
import test from 'node:test';
import { configureRuntimeEventInputs } from '../public/features/runtime/event-inputs.js';

class FakeOption {
  constructor(text, value) {
    this.textContent = text;
    this.value = value;
    this.hidden = false;
  }
}

function select(values) {
  const options = values.map(([text, value]) => new FakeOption(text, value));
  return {
    options,
    append(option) { options.push(option); },
    querySelectorAll(selector) { return selector === 'option' ? options : []; }
  };
}

test('runtime event inputs keep editor and legacy template options compatible', () => {
  const editorType = select([['旧游玩', 'spot'], ['旧服务', 'service'], ['旧补给', 'fuel']]);
  const itemType = select([['旧游玩', 'spot'], ['旧航班', 'flight']]);
  const editorAddress = {};
  const template = { content: { type: itemType, address: {} } };
  const $ = (selector, root) => {
    if (root === template.content) return root[selector.slice(1)];
    return { '#editorType': editorType, '#editorAddress': editorAddress }[selector];
  };

  configureRuntimeEventInputs({
    $, template, OptionCtor: FakeOption,
    eventTypeNames: { spot: '景点', drive: '路程', flight: '航班', transport: '交通' }
  });

  assert.deepEqual(editorType.options.slice(-3).map(option => option.value), ['drive', 'flight', 'transport']);
  assert.deepEqual(itemType.options.slice(-3).map(option => option.value), ['drive', 'flight', 'transport']);
  assert.equal(editorType.options.find(option => option.value === 'spot').textContent, '景点');
  assert.equal(editorType.options.find(option => option.value === 'service').hidden, true);
  assert.equal(editorType.options.find(option => option.value === 'fuel').hidden, true);
  assert.equal(itemType.options.find(option => option.value === 'flight').hidden, true);
  assert.equal(editorAddress.placeholder, '具体地址待定可留空，填写后可定位');
  assert.equal(template.content.address.placeholder, editorAddress.placeholder);
});

test('runtime event input reader preserves legacy node values and photo visibility', () => {
  const editorType = select([]);
  const template = { content: { type: select([]), address: {} } };
  const editorAddress = {};
  const $ = (selector, root) => {
    if (root === template.content) return root[selector.slice(1)];
    if (!root) return { '#editorType': editorType, '#editorAddress': editorAddress }[selector];
    return root[selector.slice(1)];
  };
  const values = configureRuntimeEventInputs({ $, template, eventTypeNames: {}, OptionCtor: FakeOption });
  const node = {
    dataset: { scheduleIndex: '12' },
    type: { value: 'transport' }, date: { value: '2026-08-15' },
    'start-time': { value: '09:05' }, 'end-time': { value: '11:40' },
    name: { value: '前往机场' }, address: { value: '机场路' }, note: { value: '提前出发' },
    preview: { hidden: false, src: 'https://example.test/photo.jpg' }
  };

  assert.deepEqual(values(node), {
    type: 'transport', date: '2026-08-15', startTime: '09:05', endTime: '11:40',
    name: '前往机场', address: '机场路', note: '提前出发',
    photo: 'https://example.test/photo.jpg', scheduleIndex: 12
  });
  node.preview.hidden = true;
  assert.equal(values(node).photo, '');
});
