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
  // 去重大字段：通用库只存轻量元数据，避免地点照片在计划内和通用库各存一份 base64
  // （保存时全量 PUT，重复图片会翻倍撑爆腾讯云 5MB 网关限制，触发 413）。
  // 网络图片 URL（高德 https://...）保留；dataURL base64 照片剥离，指向计划内同 id 地点即可，
  // 载入时 mergeUniversalLocations 会用计划内完整地点（含 photo）回填。
  const stripped = { ...place };
  if (typeof stripped.photo === 'string' && stripped.photo.startsWith('data:')) {
    delete stripped.photo;
    if (stripped.photoSource) delete stripped.photoSource;
  }
  const existing = findMatchingLocation(universalLocations, place.address, place.name, place.resolved?.location);
  if (existing) Object.assign(existing, structuredClone({ ...stripped, id: existing.id }));
  else universalLocations.push(structuredClone(stripped));
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
