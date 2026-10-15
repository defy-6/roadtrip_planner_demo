import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntimePlaces } from '../public/features/runtime/places.js';

test('runtime places owns filtering, selection and drag state around the place library', () => {
  let libraryOptions;
  let timerCallback;
  const cleared = [];
  const removed = [];
  const runtimePlaces = createRuntimePlaces({
    state: { locations: [] },
    $: () => null,
    escapeHtml: value => value,
    customPlaceCategories: () => [],
    placeTypeName: value => value,
    placeTypeColor: () => '#000000',
    placeTypeOptionsHtml: () => '',
    onShowPlace() {}, onEditPlace() {}, onImportPlace() {}, onImported() {},
    createLibrary: options => {
      libraryOptions = options;
      return { renderLocations() {}, renderUniversalPlaces() {} };
    },
    documentRef: {
      querySelectorAll: () => [{
        classList: { remove: value => { removed.push(value); } },
        remove: () => { removed.push('node'); }
      }]
    },
    setTimer: callback => { timerCallback = callback; return 42; },
    clearTimer: id => cleared.push(id)
  });

  runtimePlaces.setSearchText(' 天门 ');
  runtimePlaces.setTypeFilter('spot');
  runtimePlaces.setSelectionMode(true);
  assert.deepEqual(libraryOptions.getUiState(), { searchText: ' 天门 ', typeFilter: 'spot', selectionMode: true });
  assert.equal(runtimePlaces.selectedPlaceIds.size, 0);

  libraryOptions.onDragStart('place-1');
  assert.equal(runtimePlaces.getDraggingPlaceId(), 'place-1');
  const card = { classList: { remove: value => { removed.push(value); } } };
  libraryOptions.onDragEnd(card);
  assert.equal(runtimePlaces.getDraggingPlaceId(), 'place-1', 'drag source stays available until the drop event settles');
  timerCallback();
  assert.equal(runtimePlaces.getDraggingPlaceId(), '');
  assert.deepEqual(removed, ['dragging-place', 'drop-target', 'node']);

  libraryOptions.onDragStart('place-2');
  runtimePlaces.destroy();
  assert.equal(runtimePlaces.getDraggingPlaceId(), '');
  assert.ok(cleared.includes(42));
});

test('runtime places forwards imported places without taking over persistence', () => {
  let libraryOptions;
  const imported = [];
  createRuntimePlaces({
    state: { locations: [] }, $: () => null, escapeHtml: value => value,
    customPlaceCategories: () => [], placeTypeName: value => value,
    placeTypeColor: () => '#000000', placeTypeOptionsHtml: () => '',
    onShowPlace() {}, onEditPlace() {}, onImportPlace() {},
    onImported: place => imported.push(place),
    createLibrary: options => {
      libraryOptions = options;
      return { renderLocations() {}, renderUniversalPlaces() {} };
    }
  });
  const place = { id: 'place-1', name: '阿图什天门' };
  libraryOptions.onImported(place);
  assert.deepEqual(imported, [place]);
});
