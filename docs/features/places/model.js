export const normalizePlaceLookup = value => String(value || '').replace(/[\s()（）·,，。\-—_/]/g, '').toLowerCase();

export function normalizeCategoryColor(value, fallback = '#2f73a9') {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback;
}

export function mapDisplayType(type) {
  if (['flight', 'transport'].includes(type)) return 'transport';
  if (['service', 'fuel', 'supply'].includes(type)) return 'supply';
  return type;
}

export function suggestedPlaceName(address, resolvedName, fallback = '未命名地点') {
  const value = String(address || '').trim();
  const looksLikePoiName = value && value.length <= 32 && !/[省自治区自治州地区市县区镇乡村路街道巷弄号]/.test(value);
  return (looksLikePoiName ? value : (resolvedName || fallback)).replace(/[()（）]/g, '');
}

export function findMatchingLocation(locations, address, name = '', resolvedLocation = '') {
  const addressKey = normalizePlaceLookup(address), nameKey = normalizePlaceLookup(name);
  return (locations || []).find(place => {
    if (resolvedLocation && place.resolved?.location === resolvedLocation) return true;
    const keys = [place.address, place.resolved?.address].map(normalizePlaceLookup).filter(Boolean);
    if (addressKey && keys.includes(addressKey)) return true;
    return nameKey && normalizePlaceLookup(place.name) === nameKey && (!addressKey || keys.includes(addressKey));
  });
}

export function syncPlaceToUniversal(place, universalLocations = []) {
  if (!place) return place;
  const existing = findMatchingLocation(universalLocations, place.address, place.name, place.resolved?.location);
  if (existing) Object.assign(existing, structuredClone({ ...place, id: existing.id }));
  else universalLocations.push(structuredClone(place));
  return place;
}

export function createPlaceTypeCatalog({ state, typeNames, markerColors, escapeHtml }) {
  const customCategories = () => (state.placeCategories || []).filter(category => category?.id && category?.name);
  const categoryMeta = type => customCategories().find(category => category.id === type);
  const typeName = type => categoryMeta(type)?.name || typeNames[type] || '地点';
  const typeColor = type => normalizeCategoryColor(categoryMeta(type)?.color, markerColors[mapDisplayType(type)] || markerColors.spot);
  const optionsHtml = (includeDrive = false) => {
    const defaults = Object.entries(typeNames).filter(([type]) => includeDrive || type !== 'drive');
    return [...defaults, ...customCategories().map(category => [category.id, category.name])].map(([type, label]) => `<option value="${escapeHtml(type)}">${escapeHtml(label)}</option>`).join('');
  };
  return { customCategories, categoryMeta, typeName, typeColor, optionsHtml };
}
