import { createPlacesLibrary } from '../places/library.js';

export function createRuntimePlaces({
  state,
  $,
  escapeHtml,
  customPlaceCategories,
  placeTypeName,
  placeTypeColor,
  placeTypeOptionsHtml,
  onShowPlace,
  onEditPlace,
  onImportPlace,
  onImported,
  createLibrary = createPlacesLibrary,
  documentRef = globalThis.document,
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) {
  const selectedPlaceIds = new Set();
  let searchText = '';
  let typeFilter = '';
  let selectionMode = false;
  let draggingPlaceId = '';
  let clearDragTimer;

  const clearDraggingPlace = () => {
    clearTimer(clearDragTimer);
    draggingPlaceId = '';
  };
  const library = createLibrary({
    state, $, escapeHtml, selectedPlaceIds, customPlaceCategories,
    placeTypeName, placeTypeColor, placeTypeOptionsHtml,
    getUiState: () => ({ searchText, typeFilter, selectionMode }),
    setTypeFilter: value => { typeFilter = value; },
    onShowPlace,
    onEditPlace,
    onImportPlace,
    onDragStart: placeId => {
      clearTimer(clearDragTimer);
      draggingPlaceId = placeId;
    },
    onDragEnd: card => {
      clearDragTimer = setTimer(() => {
        draggingPlaceId = '';
        card.classList.remove('dragging-place');
        documentRef.querySelectorAll('.calendar-day.drop-target,.calendar-drop-preview')
          .forEach(item => item.classList.remove('drop-target') || item.remove());
      }, 180);
    },
    onImported
  });

  return {
    selectedPlaceIds,
    renderLocations: library.renderLocations,
    renderUniversalPlaces: library.renderUniversalPlaces,
    getTypeFilter: () => typeFilter,
    setTypeFilter: value => { typeFilter = value; },
    getSelectionMode: () => selectionMode,
    setSelectionMode: value => { selectionMode = value; },
    setSearchText: value => { searchText = value; },
    getDraggingPlaceId: () => draggingPlaceId,
    clearDraggingPlace,
    destroy: clearDraggingPlace
  };
}
