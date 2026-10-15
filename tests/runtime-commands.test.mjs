import assert from 'node:assert/strict';
import test from 'node:test';
import { bindRuntimeCommands } from '../public/features/runtime/commands.js';

function node(properties = {}) {
  return Object.assign(new EventTarget(), properties);
}

test('runtime commands delegate filters, categories and export without owning business logic', () => {
  const nodes = {
    '#placeTypeFilter': node({ value: '' }),
    '#placeLibraryBtn': node(),
    '#closeUniversalPlaceDialog': node(),
    '#tripName': node({ value: '测试行程' }),
    '#mapDayFilter': node({ value: '' }),
    '#planSelect': node({ value: '' }),
    '#placeCategoryEditorForm': node(),
    '#newPlaceCategoryName': node({ value: '', focus: () => calls.push('category-name-focus') }),
    '#newPlaceCategoryColor': node({ value: '#123456' }),
    '#placeCategoryEditorCancel': node(),
    '#updateScheduleWeather': node(),
    '#undoBtn': node(),
    '#redoBtn': node()
  };
  const exportButton = node();
  let exported = null;
  let exportedBlob = null;
  const documentRef = {
    querySelector: selector => selector === '#exportBtn' ? exportButton : null,
    createElement: () => ({ click() { exported = this; } })
  };
  const calls = [];
  const state = { schedule: [{ id: 1 }], locations: [], routes: [], preferences: {}, placeCategories: [] };
  const dialog = node({ showModal: () => calls.push('library-open'), close: () => calls.push('library-close') });
  const categoryDialog = node({ showModal: () => calls.push('category-open'), close: () => calls.push('category-close') });
  const target = new EventTarget();
  const categoryButton = node({ isConnected: true, focus: () => calls.push('category-entry-focus') });
  const binding = bindRuntimeCommands({
    eventTarget: target,
    documentRef,
    urlApi: { createObjectURL: () => 'blob:test', revokeObjectURL: value => calls.push(['revoke', value]) },
    BlobCtor: class { constructor(parts, options) { this.parts = parts; this.options = options; exportedBlob = this; } },
    randomUUID: () => 'category-1',
    $: selector => nodes[selector],
    state,
    itemsEl: { children: [{}] },
    values: () => ({ name: '节点' }),
    changeDayFilter: value => calls.push(['day', value]),
    loadPreset: value => calls.push(['plan', value]),
    setPlaceTypeFilter: value => calls.push(['type', value]),
    renderLocations: () => calls.push('locations'),
    renderUniversalPlaces: () => calls.push('library-render'),
    universalPlaceDialog: dialog,
    addPlaceButton: node(),
    addPlaceCategoryButton: categoryButton,
    placeCategoryEditor: categoryDialog,
    openPlaceEditor: value => calls.push(['place', value]),
    save: () => calls.push('save'),
    updateScheduleWeather: () => calls.push('weather'),
    openExpenseLedger: () => calls.push('ledger'),
    undo: () => calls.push('undo'),
    redo: () => calls.push('redo')
  });

  nodes['#placeTypeFilter'].value = 'spot';
  nodes['#placeTypeFilter'].dispatchEvent(new Event('change'));
  nodes['#planSelect'].value = 'plan-b';
  nodes['#planSelect'].dispatchEvent(new Event('change'));
  nodes['#newPlaceCategoryName'].value = '露营';
  nodes['#placeCategoryEditorForm'].dispatchEvent(new Event('submit', { cancelable: true }));
  exportButton.dispatchEvent(new Event('click'));

  assert.equal(state.placeCategories[0].name, '露营');
  assert.equal(state.placeCategories[0].id, 'category-1');
  assert.deepEqual(calls.slice(0, 3), [['type', 'spot'], 'locations', ['plan', 'plan-b']]);
  assert.equal(exported.download, 'roadtrip-plan.json');
  assert.equal(exported.href, 'blob:test');
  const exportedPayload = JSON.parse(exportedBlob.parts[0]);
  assert.equal(exportedPayload.exportScope, 'plan', '方案级导出必须自述范围，避免被误当成完整备份');
  assert.match(exportedPayload.note, /不是完整/);
  assert.deepEqual(exportedPayload.schedule, [{ id: 1 }]);
  categoryButton.dispatchEvent(new Event('click'));
  assert.deepEqual(calls.slice(-2), ['category-open', 'category-name-focus']);
  categoryDialog.dispatchEvent(new Event('close'));
  assert.equal(calls.at(-1), 'category-entry-focus');

  binding.destroy();
  const before = calls.length;
  nodes['#undoBtn'].dispatchEvent(new Event('click'));
  categoryDialog.dispatchEvent(new Event('close'));
  assert.equal(calls.length, before);
});
