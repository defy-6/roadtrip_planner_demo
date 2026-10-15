'use strict';

function nextRevision(previous) {
  const prior = Date.parse(previous || '');
  return new Date(Math.max(Date.now(), Number.isFinite(prior) ? prior + 1 : 0)).toISOString();
}

function versionConflict(trip) {
  return { statusCode: 409, data: { ok: false, code: 'VERSION_CONFLICT',
    error: '云端数据已更新，本次修改未写入，请保留本地修改并核对后重试',
    current_updated_at: trip?.updated_at || '' } };
}

function guardVersion(trip, baseline) {
  if (!supportedSchema(trip.data || {})) return { statusCode: 409, data: { ok: false,
    code: 'SCHEMA_UNSUPPORTED', error: '当前客户端不支持该行程版本，已禁止降级写入' } };
  if (typeof baseline !== 'string' || !baseline.trim()) {
    return { statusCode: 428, data: { ok: false, code: 'VERSION_REQUIRED',
      error: '缺少读取时的版本，请升级客户端并重新读取；本次修改未写入' } };
  }
  return baseline !== trip.updated_at ? versionConflict(trip) : null;
}

function libraryChange(user, locations) {
  return { collection: 'users', query: { _id: user._id, place_library_revision: user.place_library_revision },
    patch: { place_library: JSON.parse(JSON.stringify(locations)),
      place_library_revision: Number(user.place_library_revision || 0) + 1 } };
}

function supportedSchema(data) {
  const supported = value => value?.schemaVersion === undefined
    || (Number.isInteger(Number(value.schemaVersion)) && Number(value.schemaVersion) >= 0 && Number(value.schemaVersion) <= 4);
  return supported(data) && Object.values(data?.versions || {}).every(supported);
}

function hasPlannerData(data) {
  const snapshot = value => value && (Array.isArray(value.schedule) || Array.isArray(value.items));
  return Boolean(snapshot(data) || Object.values(data?.versions || {}).some(snapshot));
}

module.exports = { nextRevision, versionConflict, guardVersion, libraryChange, supportedSchema, hasPlannerData };
