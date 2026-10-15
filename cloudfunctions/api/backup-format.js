// 旅行备份格式（纯规则）：不访问数据库、网络、DOM 或 wx，便于在 node --test 中直接验证。
//
// 备份范围（完整行程，而非"当前方案 JSON"）：
//   - 行程文档 trip.data（全部方案 plans/versions、事件 schedule、费用 expenses、
//     方案地点 locations 及其 photo/poiDetails、路线 routes、偏好 preferences、自定义类别 placeCategories）
//   - 账号通用地点库 place_library（跨行程复用，且携带 photo/poiDetails 等大字段）
//   - 资源清单 assets（明确区分"已内嵌图片"与"仅网络 URL"，不得把网络链接说成已完整保存图片）
//
// 完整性：integrity = sha256(stableStringify({ data, place_library }))，键排序后序列化，
// 因此备份在不同存储/不同字段顺序下仍能校验一致。
'use strict';

const crypto = require('node:crypto');
const { supportedSchema } = require('./trip-write-safety');

// 备份信封格式版本。恢复时若遇到更高版本一律拒绝，禁止降级重写。
const BACKUP_FORMAT_VERSION = 1;

function stableStringify(value) {
  const seen = new WeakSet();
  const walk = input => {
    if (input === null || typeof input !== 'object') return input;
    if (seen.has(input)) return null;
    seen.add(input);
    if (Array.isArray(input)) return input.map(walk);
    return Object.keys(input).sort().reduce((acc, key) => { acc[key] = walk(input[key]); return acc; }, {});
  };
  return JSON.stringify(walk(value));
}

function computeIntegrity(payload) {
  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

// 资源清单：递归统计 photo 字段，区分内嵌（data:）与网络链接（http(s):）。
function summarizeAssets(...roots) {
  const photos = { total: 0, embedded: 0, remote: 0, other: 0 };
  const seen = new WeakSet();
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { node.forEach(walk); return; }
    Object.entries(node).forEach(([key, value]) => {
      if (key === 'photo' && typeof value === 'string' && value) {
        photos.total += 1;
        if (value.startsWith('data:')) photos.embedded += 1;
        else if (/^https?:\/\//i.test(value)) photos.remote += 1;
        else photos.other += 1;
      } else if (value && typeof value === 'object') {
        walk(value);
      }
    });
  };
  roots.forEach(walk);
  const notes = [];
  if (photos.remote > 0) notes.push(`${photos.remote} 张地点图片仅保存了网络链接，无法离线还原图片本体`);
  if (photos.other > 0) notes.push(`${photos.other} 张图片引用来源未知`);
  return { photos, notes, images_fully_embedded: photos.remote === 0 && photos.other === 0 };
}

function sourceVersionOf(data = {}, tripUpdatedAt = '') {
  return {
    updated_at: tripUpdatedAt || data.updatedAt || '',
    schema_version: Number(data.schemaVersion || 0) || null,
    event_category_version: Number(data.eventCategoryVersion || 0) || null,
    place_model_version: Number(data.placeModelVersion || 0) || null,
    route_link_mode_version: Number(data.routeLinkModeVersion || 0) || null,
  };
}

// 生成备份信封。data 必须为行程文档数据；placeLibrary 为账号通用地点库。
function buildBackupEnvelope({ data, placeLibrary = [], createdBy = '', createdAt, tripName = '', planName = '', sequence = 0, tripUpdatedAt = '' }) {
  const payload = { data: clone(data) || {}, place_library: clone(placeLibrary) || [] };
  return {
    format_version: BACKUP_FORMAT_VERSION,
    source: sourceVersionOf(payload.data, tripUpdatedAt),
    created_at: createdAt || new Date().toISOString(),
    created_by: createdBy,
    sequence,
    trip_name: tripName,
    plan_name: planName,
    data: payload.data,
    place_library: payload.place_library,
    assets: summarizeAssets(payload.data, payload.place_library),
    integrity: computeIntegrity(payload),
  };
}

// 校验信封本身：格式版本可识别、完整性匹配。
function verifyBackupEnvelope(backup) {
  if (!backup || typeof backup !== 'object') return { ok: false, reason: '备份记录缺失或格式不正确' };
  const version = Number(backup.format_version || 0);
  if (!version) return { ok: false, reason: '该备份缺少格式版本，无法安全校验（可能是旧版或损坏的记录）' };
  if (version > BACKUP_FORMAT_VERSION) {
    return { ok: false, reason: `备份格式版本 ${version} 高于当前支持的 ${BACKUP_FORMAT_VERSION}，禁止降级重写，请先升级应用` };
  }
  if (!backup.integrity) return { ok: false, reason: '该备份缺少完整性校验值，无法确认内容未被破坏' };
  const expected = computeIntegrity({ data: backup.data || {}, place_library: backup.place_library || [] });
  if (expected !== backup.integrity) return { ok: false, reason: '备份完整性校验失败，内容可能已损坏，已拒绝恢复' };
  return { ok: true, format_version: version };
}

const PLACE_REF_KEYS = ['locationId', 'departurePlaceId', 'stopoverPlaceId', 'arrivalPlaceId', 'originPlaceId', 'destinationPlaceId'];
const EVENT_REF_KEYS = ['locationId'];

// 结构 + 关联校验。
// 返回 { ok, errors, linkIssues, warnings }：
//   - errors：结构性问题，任何情况下都禁止恢复（损坏/空方案集/格式错误）。
//   - linkIssues：关联缺失（地点/路线引用悬空），默认禁止恢复，仅在用户显式确认后允许忽略。
function validateBackupContent(data, placeLibrary = []) {
  const errors = [];
  const linkIssues = [];
  const warnings = [];
  if (!supportedSchema(data)) errors.push('当前客户端不支持备份中的行程 schema 版本，禁止降级恢复');
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ['行程数据不是有效对象'], linkIssues, warnings };
  }
  const versions = data.versions;
  if (!versions || typeof versions !== 'object' || Array.isArray(versions)) {
    errors.push('备份缺少方案集合（versions），无法恢复');
  } else if (Object.keys(versions).length === 0) {
    errors.push('备份中的方案集合为空，恢复会清空行程');
  }
  if (data.plans !== undefined && !Array.isArray(data.plans)) errors.push('方案列表（plans）格式错误');
  if (Array.isArray(data.plans)) {
    const ids = new Set(Object.keys(versions || {}));
    const missing = data.plans.map(plan => plan?.id).filter(id => id && !ids.has(id));
    if (missing.length) errors.push(`方案列表引用了不存在的方案快照：${missing.slice(0, 3).join('、')}`);
  }
  if (data.activeVersion && versions && typeof versions === 'object' && !versions[data.activeVersion]) {
    errors.push(`当前方案 ${data.activeVersion} 在备份中不存在`);
  }

  const libraryIds = new Set((Array.isArray(placeLibrary) ? placeLibrary : []).map(place => place?.id).filter(Boolean));

  Object.entries(versions && typeof versions === 'object' ? versions : {}).forEach(([planKey, version]) => {
    if (!version || typeof version !== 'object') { errors.push(`方案 ${planKey} 的快照格式错误`); return; }
    if (version.schedule !== undefined && !Array.isArray(version.schedule)) errors.push(`方案 ${planKey} 的时间表格式错误`);
    if (version.expenses !== undefined && !Array.isArray(version.expenses)) errors.push(`方案 ${planKey} 的费用数据格式错误`);
    if (version.placeCategories !== undefined && !Array.isArray(version.placeCategories)) errors.push(`方案 ${planKey} 的地点类别格式错误`);
    if (version.preferences !== undefined && (typeof version.preferences !== 'object' || Array.isArray(version.preferences))) errors.push(`方案 ${planKey} 的偏好设置格式错误`);
    if (version.routes !== undefined && !Array.isArray(version.routes)) errors.push(`方案 ${planKey} 的路线数据格式错误`);
    if (version.locations !== undefined && !Array.isArray(version.locations)) errors.push(`方案 ${planKey} 的地点数据格式错误`);

    const planLocationIds = new Set((Array.isArray(version.locations) ? version.locations : []).map(place => place?.id).filter(Boolean));
    const known = new Set([...planLocationIds, ...libraryIds]);
    const routeIds = new Set([...(Array.isArray(version.routes) ? version.routes : []), ...(Array.isArray(data.routes) ? data.routes : [])].map(route => route?.id).filter(Boolean));

    const missingLocations = new Set();
    const missingRoutes = new Set();
    (Array.isArray(version.schedule) ? version.schedule : []).forEach(event => {
      if (!event || typeof event !== 'object') return;
      const collect = target => {
        if (!target || typeof target !== 'object') return;
        [
          ...EVENT_REF_KEYS.map(key => target[key]),
          ...PLACE_REF_KEYS.map(key => target.flightInfo?.[key]),
          ...PLACE_REF_KEYS.map(key => target.routeLinks?.[key]),
          ...PLACE_REF_KEYS.map(key => target.routeInfo?.[key]),
        ].forEach(id => { if (id && !known.has(id)) missingLocations.add(String(id)); });
        (target.routeLinks?.viaPlaceIds || []).forEach(id => { if (id && !known.has(id)) missingLocations.add(String(id)); });
        const routeId = target.routeLinks?.routeId;
        if (routeId && !routeIds.has(routeId)) missingRoutes.add(String(routeId));
      };
      collect(event);
    });
    if (missingLocations.size) {
      linkIssues.push(`方案 ${planKey} 有 ${missingLocations.size} 个关联地点在备份中缺失：${[...missingLocations].slice(0, 3).join('、')}`);
    }
    if (missingRoutes.size) {
      linkIssues.push(`方案 ${planKey} 有 ${missingRoutes.size} 条关联路线在备份中缺失：${[...missingRoutes].slice(0, 3).join('、')}`);
    }
  });

  if (!errors.length && !libraryIds.size) warnings.push('备份未包含账号通用地点库，恢复后我的地点库保持原样');
  return { ok: errors.length === 0 && linkIssues.length === 0, errors, linkIssues, warnings };
}

module.exports = { BACKUP_FORMAT_VERSION, stableStringify, computeIntegrity, summarizeAssets, sourceVersionOf, buildBackupEnvelope, verifyBackupEnvelope, validateBackupContent };
