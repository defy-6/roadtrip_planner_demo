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
  // 通用库保存与计划内一致的地点元数据（含图片）。
  // 图片同步策略（保守）：
  //  - 通用库某地点若已有图（网络 URL 或 base64），保留通用库原图，不被计划内覆盖；
  //  - 通用库某地点尚无图时，用计划内的图片补齐（这样「修改计划内地点图片」能补到通用库）。
  // 网络 URL 原样保留；本地上传的 base64 也允许写入通用库（总量由 savePlannerData 防线兜底）。
  const stripped = { ...place };
  const existing = findMatchingLocation(universalLocations, place.address, place.name, place.resolved?.location);
  if (existing) {
    const keptPhoto = existing.photo || null;
    Object.assign(existing, structuredClone({ ...stripped, id: existing.id }));
    // 通用库原本有图则保留原图（避免把高德清晰 URL 覆盖成压缩 base64）；无图才用计划内图补齐。
    if (keptPhoto) existing.photo = keptPhoto;
  } else {
    universalLocations.push(structuredClone(stripped));
  }
  return place;
}

export function createPlaceTypeCatalog({ state, typeNames, markerColors, escapeHtml }) {
  const customCategories = () => (state.placeCategories || []).filter(category => category?.id && category?.name);
  const categoryMeta = type => customCategories().find(category => category.id === type);
  const typeName = type => categoryMeta(type)?.name || typeNames[mapDisplayType(type)] || '地点';
  const typeColor = type => normalizeCategoryColor(categoryMeta(type)?.color, markerColors[mapDisplayType(type)] || markerColors.spot);
  const optionsHtml = (includeDrive = false) => {
    const seen = new Set();
    const defaults = Object.entries(typeNames).map(([type, label]) => {
      const displayType = mapDisplayType(type);
      return [displayType, typeNames[displayType] || label];
    }).filter(([type]) => (includeDrive || type !== 'drive') && !seen.has(type) && seen.add(type));
    return [...defaults, ...customCategories().map(category => [category.id, category.name])].map(([type, label]) => `<option value="${escapeHtml(type)}">${escapeHtml(label)}</option>`).join('');
  };
  return { customCategories, categoryMeta, typeName, typeColor, optionsHtml };
}
