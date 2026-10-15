// 行程接口：trips CRUD / join（分享码协作）/ share（owner 开关分享）/ members。
// 权限模型：owner 全权；editor 可读可改；未加入者 403。统一返回 { statusCode, data }。
'use strict';

const crypto = require('node:crypto');
const backupFormat = require('../backup-format');
const { nextRevision, versionConflict, guardVersion, libraryChange, supportedSchema, hasPlannerData } = require('../trip-write-safety');

const SHARE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 排除 0/O/1/I
const SHARE_CODE_LEN = 8;

function generateShareCode() {
  const bytes = crypto.randomBytes(SHARE_CODE_LEN);
  let code = '';
  for (let i = 0; i < SHARE_CODE_LEN; i += 1) {
    code += SHARE_CODE_ALPHABET[bytes[i] % SHARE_CODE_ALPHABET.length];
  }
  return code;
}

function publicTrip(trip, role) {
  return {
    _id: trip._id,
    name: trip.name,
    owner_id: trip.owner_id,
    data: trip.data || {},
    share_code: trip.share_code || null,
    share_enabled: !!trip.share_enabled,
    share_readonly: !!trip.share_readonly,
    created_at: trip.created_at,
    updated_at: trip.updated_at,
    role,
  };
}

// 列表专用瘦身投影：不携带大体积 data（图片 Base64 可达 MB 级）
function tripSummary(trip, role) {
  return {
    _id: trip._id,
    name: trip.name,
    share_code: trip.share_code || null,
    share_enabled: !!trip.share_enabled,
    share_readonly: !!trip.share_readonly,
    updated_at: trip.updated_at,
    role,
  };
}

function createTripsRoutes({ store }) {
  const canonicalEventCategory = type => ({ service: 'supply', fuel: 'supply', flight: 'transport' }[type] || type || 'spot');

  function normalizeEventCategories(data) {
    if (!data || typeof data !== 'object') return { data, changed: false };
    const next = JSON.parse(JSON.stringify(data));
    let changed = next.eventCategoryVersion !== 1;
    const normalizeList = list => {
      if (!Array.isArray(list)) return;
      list.forEach(event => {
        if (!event || typeof event !== 'object') return;
        const category = canonicalEventCategory(event.type);
        if (event.category !== category) { event.category = category; changed = true; }
      });
    };
    normalizeList(next.schedule);
    normalizeList(next.items);
    Object.values(next.versions || {}).forEach(version => {
      normalizeList(version?.schedule);
      normalizeList(version?.items);
    });
    next.eventCategoryVersion = 1;
    return { data: next, changed };
  }

  async function migrateTripEventCategories(trip) {
    if (!supportedSchema(trip?.data || {})) return trip;
    const normalized = normalizeEventCategories(trip?.data || {});
    if (!trip || !normalized.changed) return trip;
    // 目录迁移是尽力而为的内部修复：条件更新失败（并发写入抢先）不报错，下次读取再迁移。
    const migration = await store.updateIfMatches('trips', { _id: trip._id, updated_at: trip.updated_at }, { data: normalized.data, updated_at: nextRevision(trip.updated_at) });
    return migration.doc || { ...trip, data: normalized.data };
  }

  async function accountPlaceLibrary(userId, legacyLocations = [], attempt = 0) {
    const user = await store.findOne('users', { _id: userId });
    if (!user) return [];
    // 账号本人每次打开旧行程时增量承接该行程遗留的顶层地点，支持多个旧行程逐步迁移；
    // 协作者传入空数组，因此不会继承行程所有者的私有库。
    const library = JSON.parse(JSON.stringify(Array.isArray(user.place_library) ? user.place_library : []));
    const ids = new Set(library.map(place => place?.id).filter(Boolean));
    let changed = !Array.isArray(user.place_library);
    (legacyLocations || []).forEach(place => {
      if (!place?.id || ids.has(place.id)) return;
      library.push(JSON.parse(JSON.stringify(place))); ids.add(place.id); changed = true;
    });
    let revision = Number(user.place_library_revision || 0);
    if (changed) {
      const change = libraryChange(user, library);
      const saved = await store.updateIfMatches('users', change.query, change.patch);
      if (!saved.updated) {
        if (attempt < 3) return accountPlaceLibrary(userId, legacyLocations, attempt + 1);
        throw new Error('地点库正在更新，请重试读取');
      }
      revision = change.patch.place_library_revision;
    }
    Object.defineProperty(library, 'revision', { value: revision });
    return library;
  }

  async function findMember(tripId, userId) {
    return store.findOne('trip_members', { trip_id: tripId, user_id: userId });
  }

  // ---------- 版本前置条件与冲突契约（网页 / 小程序 / 后端一致） ----------
  // 业务码 VERSION_CONFLICT + HTTP 409；所有写入入口都必须带可核对的版本前置条件。
  // 关键字：
  //   - 不能只靠客户端"先 GET 再 PUT"：服务端把"版本检查 + 写入"合并为一次条件更新（原子）。
  //   - 客户端带 baseUpdatedAt 时，与当前版本不一致即冲突（检测"基于旧版本覆盖"）。
  //   - 旧客户端不带读取基线必须拒绝（428），不能用服务端当前版本替旧草稿背书。
  async function commitTrip(tripId, expectedUpdatedAt, patch, related = []) {
    return store.updateIfMatches(
      'trips',
      { _id: tripId, updated_at: expectedUpdatedAt },
      { ...patch, updated_at: nextRevision(expectedUpdatedAt) },
      related,
    );
  }

  // 统一的版本前置条件入口：先快速失败，再用条件更新保证原子。

  async function list(userId) {
    const members = await store.find('trip_members', { user_id: userId });
    const mine = [];
    const shared = [];
    for (const m of members) {
      const trip = await store.findOne('trips', { _id: m.trip_id });
      if (!trip) continue;
      if (m.role === 'owner') mine.push(tripSummary(trip, 'owner'));
      else shared.push(tripSummary(trip, m.role));
    }
    const byUpdated = (a, b) => String(b.updated_at).localeCompare(String(a.updated_at));
    mine.sort(byUpdated);
    shared.sort(byUpdated);
    return { statusCode: 200, data: { ok: true, trips: { mine, shared } } };
  }

  async function create(userId, { name, data }) {
    name = String(name || '').trim();
    if (!name) return { statusCode: 400, data: { ok: false, error: '行程名称不能为空' } };
    const now = new Date().toISOString();
    const trip = await store.insert('trips', {
      name,
      owner_id: userId,
      data: normalizeEventCategories(data && typeof data === 'object' ? data : {}).data,
      share_code: null,
      share_enabled: false,
      created_at: now,
      updated_at: now,
    });
    await store.insert('trip_members', {
      trip_id: trip._id,
      user_id: userId,
      role: 'owner',
      joined_at: now,
    });
    return { statusCode: 200, data: { ok: true, trip: publicTrip(trip, 'owner') } };
  }

  // 递归把 data 中所有 photo URL 转 https（web 端通过 GET /trips/:id 加载完整 data，Mixed Content 修复）
  function sanitizePhotos(data) {
    if (!data || typeof data !== 'object') return data;
    if (Array.isArray(data)) { data.forEach(sanitizePhotos); return data; }
    Object.entries(data).forEach(([k, v]) => {
      if (k === 'photo' && typeof v === 'string') data[k] = v.replace(/^http:\/\//, 'https://');
      else if (v && typeof v === 'object') sanitizePhotos(v);
    });
    return data;
  }

  async function get(userId, tripId) {
    let trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权访问该行程' } };
    trip = await migrateTripEventCategories(trip);
    const tripOut = publicTrip(trip, member.role);
    // publicTrip 与底层 store 共享 data 引用；本地 JSON store 的 findOne 返回的是活对象，
    // 直接改写会把"注入给客户端的通用地点库"回写进行程文档。这里先深拷贝再加工。
    tripOut.data = JSON.parse(JSON.stringify(tripOut.data || {}));
    tripOut.data = sanitizePhotos(tripOut.data);
    tripOut.data.locations = await accountPlaceLibrary(userId, member.role === 'owner' ? tripOut.data.locations : []);
    tripOut.place_library_revision = tripOut.data.locations.revision;
    return { statusCode: 200, data: { ok: true, trip: tripOut } };
  }

  async function update(userId, tripId, { name, data, preserve_large_fields: preserveLargeFields, baseUpdatedAt, baseLibraryRevision }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    if (member && member.role === 'viewer') return { statusCode: 403, data: { ok: false, error: '只读分享，无法编辑' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;

    const patch = {};
    const related = [];
    if (name !== undefined) {
      if (!String(name).trim()) return { statusCode: 400, data: { ok: false, error: '行程名称不能为空' } };
      patch.name = String(name).trim();
    }
    if (data !== undefined) {
      if (!data || typeof data !== 'object') return { statusCode: 400, data: { ok: false, error: '行程数据格式错误' } };
      if (!supportedSchema(data) || (hasPlannerData(trip.data) && !hasPlannerData(data))) return { statusCode: 400,
        data: { ok: false, code: 'INVALID_PLANNER_DATA', error: '写入会丢失方案或使用不支持的数据版本，已拒绝' } };
      const accountLocations = Array.isArray(data.locations) ? data.locations : null;
      if (accountLocations) {
        const user = await store.findOne('users', { _id: userId });
        if (!user || baseLibraryRevision !== Number(user.place_library_revision || 0)) return versionConflict(trip);
        related.push(libraryChange(user, accountLocations));
      }
      delete data.locations;
      if (preserveLargeFields) {
        const previousData = trip.data || {};
        data.routes = previousData.routes || [];
        Object.entries(data.versions || {}).forEach(([versionId, version]) => {
          const previous = previousData.versions?.[versionId] || {};
          version.schedule = previous.schedule || [];
          version.locations = previous.locations || [];
          version.routes = previous.routes || [];
          version.expenses = previous.expenses || [];
          version.placeCategories = previous.placeCategories || [];
        });
      }
      patch.data = normalizeEventCategories(data).data;
    }
    const saved = await commitTrip(tripId, baseUpdatedAt, patch, related);
    if (!saved.updated) return versionConflict(trip);
    return { statusCode: 200, data: { ok: true, trip: publicTrip(saved.doc, member.role),
      ...(related.length ? { place_library_revision: related[0].patch.place_library_revision } : {}) } };
  }

  async function remove(userId, tripId, { baseUpdatedAt, base_updated_at: baseUpdatedAtSnake } = {}) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member || member.role !== 'owner') {
      return { statusCode: 403, data: { ok: false, error: '仅创建者可删除行程' } };
    }
    // 删除同样受版本前置条件约束：基于旧版本的删除不得静默执行。
    const conflict = guardVersion(trip, baseUpdatedAt || baseUpdatedAtSnake);
    if (conflict) return conflict;
    const removed = await store.removeIfMatches('trips', { _id: tripId, updated_at: baseUpdatedAt || baseUpdatedAtSnake });
    if (!removed) return versionConflict(await store.findOne('trips', { _id: tripId }) || trip);
    await store.remove('trip_members', { trip_id: tripId });
    await store.remove('trip_backups', { trip_id: tripId });
    return { statusCode: 200, data: { ok: true } };
  }

  async function join(userId, { share_code }) {
    share_code = String(share_code || '').trim().toUpperCase();
    if (!share_code) return { statusCode: 400, data: { ok: false, error: '请输入分享码' } };
    const trip = await store.findOne('trips', { share_code, share_enabled: true });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '分享码无效或已关闭' } };
    let member = await findMember(trip._id, userId);
    if (!member) {
      member = await store.insert('trip_members', {
        trip_id: trip._id,
        user_id: userId,
        role: trip.share_readonly ? 'viewer' : 'editor',
        joined_at: new Date().toISOString(),
      });
    }
    return { statusCode: 200, data: { ok: true, trip: publicTrip(trip, member.role) } };
  }

  async function share(userId, tripId, { enabled, readonly, baseUpdatedAt }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member || member.role !== 'owner') {
      return { statusCode: 403, data: { ok: false, error: '仅创建者可管理分享' } };
    }
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;
    const wantEnabled = !!enabled;
    let shareCode = trip.share_code;
    if (wantEnabled) {
      for (let i = 0; i < 5 && !shareCode; i += 1) {
        const candidate = generateShareCode();
        const dup = await store.findOne('trips', { share_code: candidate });
        if (!dup) shareCode = candidate;
      }
      if (!shareCode) return { statusCode: 500, data: { ok: false, error: '分享码生成失败，请重试' } };
    } else {
      shareCode = null;
    }
    // 新分享码默认只读；拥有者可在协作者加入后单独授予编辑权限。
    const saved = await commitTrip(tripId, baseUpdatedAt || trip.updated_at, { share_code: shareCode, share_enabled: wantEnabled, share_readonly: wantEnabled ? readonly !== false : false });
    if (!saved.updated) return versionConflict(trip);
    return { statusCode: 200, data: { ok: true, trip: publicTrip(saved.doc, member.role), updated_at: saved.doc.updated_at } };
  }

  async function members(userId, tripId) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权访问该行程' } };
    const rows = await store.find('trip_members', { trip_id: tripId });
    const list = [];
    for (const row of rows) {
      const u = await store.findOne('users', { _id: row.user_id });
      list.push({
        user_id: row.user_id,
        nickname: u ? (u.nickname || u.username) : '未知用户',
        username: u ? u.username : '',
        role: row.role,
        joined_at: row.joined_at,
      });
    }
    return { statusCode: 200, data: { ok: true, members: list } };
  }

  async function updateMember(userId, tripId, { user_id: targetUserId, role, baseUpdatedAt }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const owner = await findMember(tripId, userId);
    if (!owner || owner.role !== 'owner') return { statusCode: 403, data: { ok: false, error: '仅创建者可管理协作者权限' } };
    if (!['editor', 'viewer'].includes(role)) return { statusCode: 400, data: { ok: false, error: '权限只能设置为可编辑或只读' } };
    const target = await findMember(tripId, String(targetUserId || ''));
    if (!target) return { statusCode: 404, data: { ok: false, error: '协作者不存在' } };
    if (target.role === 'owner') return { statusCode: 400, data: { ok: false, error: '不能修改创建者权限' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;
    const saved = await commitTrip(tripId, baseUpdatedAt, {}, [{ collection: 'trip_members',
      query: { _id: target._id, role: target.role }, patch: { role } }]);
    if (!saved.updated) return versionConflict(trip);
    return { statusCode: 200, data: { ok: true, member: { user_id: target.user_id, role }, updated_at: saved.doc.updated_at } };
  }

  async function removeMember(userId, tripId, { user_id: targetUserId, baseUpdatedAt }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const owner = await findMember(tripId, userId);
    if (!owner || owner.role !== 'owner') return { statusCode: 403, data: { ok: false, error: '仅创建者可移除协作者' } };
    const target = await findMember(tripId, String(targetUserId || ''));
    if (!target) return { statusCode: 404, data: { ok: false, error: '协作者不存在' } };
    if (target.role === 'owner') return { statusCode: 400, data: { ok: false, error: '不能移除创建者' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;
    const saved = await commitTrip(tripId, baseUpdatedAt, {}, [{ collection: 'trip_members',
      query: { _id: target._id, role: target.role }, action: 'remove' }]);
    if (!saved.updated) return versionConflict(trip);
    return { statusCode: 200, data: { ok: true, updated_at: saved.doc.updated_at } };
  }

  // ---------- 旅行备份（完整行程，而非"当前方案 JSON"） ----------
  // 备份只写入 trip_backups 集合（仅行程成员可读），不写入任何公开目录/静态资源。
  // 完整范围 = trip.data（全部方案/事件/费用/方案地点/路线/偏好/类别）+ 账号通用地点库 + 资源清单。
  async function nextBackupSequence(tripId) {
    const rows = await store.find('trip_backups', { trip_id: tripId });
    return Math.max(0, ...rows.map(row => Number(row.sequence || 0))) + 1;
  }

  async function insertBackupEnvelope({ tripId, userId, trip, library, now }) {
    const data = JSON.parse(JSON.stringify(trip.data || {}));
    const active = data.activeVersion && data.versions?.[data.activeVersion];
    const envelope = backupFormat.buildBackupEnvelope({
      data,
      placeLibrary: Array.isArray(library) ? library : [],
      createdBy: userId,
      createdAt: now,
      tripName: trip.name || '',
      planName: active?.name || '',
      sequence: await nextBackupSequence(tripId),
      tripUpdatedAt: trip.updated_at || '',
    });
    return store.insert('trip_backups', { trip_id: tripId, ...envelope });
  }

  async function pruneBackups(tripId, keep = 3) {
    const rows = await store.find('trip_backups', { trip_id: tripId });
    const newest = rows.sort((a, b) => Number(b.sequence || 0) - Number(a.sequence || 0) || String(b.created_at).localeCompare(String(a.created_at)));
    for (const stale of newest.slice(keep)) await store.remove('trip_backups', { _id: stale._id });
    return newest.slice(0, keep);
  }

  async function listBackups(userId, tripId) {
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权访问该行程' } };
    const rows = await store.find('trip_backups', { trip_id: tripId });
    const backups = rows.sort((a, b) => Number(b.sequence || 0) - Number(a.sequence || 0) || String(b.created_at).localeCompare(String(a.created_at))).slice(0, 3).map(row => ({
      _id: row._id,
      created_at: row.created_at,
      created_by: row.created_by,
      plan_name: row.plan_name || '',
      trip_name: row.trip_name || '',
      format_version: Number(row.format_version || 0),
      source_updated_at: (row.source && row.source.updated_at) || '',
      assets: row.assets || null,
    }));
    return { statusCode: 200, data: { ok: true, backups } };
  }

  async function createBackup(userId, tripId) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member || member.role === 'viewer') return { statusCode: 403, data: { ok: false, error: '无权备份该行程' } };
    const now = new Date().toISOString();
    // 账号通用地点库只随"本人"归档：协作者不应把行程遗留地点并入自己的库。
    const library = member.role === 'owner' ? await accountPlaceLibrary(userId, trip.data?.locations) : [];
    const backup = await insertBackupEnvelope({ tripId, userId, trip, library, now });
    await pruneBackups(tripId, 3);
    const warnings = [];
    if (member.role !== 'owner') warnings.push('由协作者创建的备份不包含行程创建者的通用地点库');
    return {
      statusCode: 200,
      data: {
        ok: true,
        backup: {
          _id: backup._id,
          created_at: backup.created_at,
          plan_name: backup.plan_name,
          format_version: backup.format_version,
          source: backup.source,
          assets: backup.assets,
        },
        warnings,
      },
    };
  }

  async function restoreBackup(userId, tripId, { backup_id: backupId, allow_missing_links: allowMissingLinks, baseUpdatedAt } = {}) {
    const owner = await findMember(tripId, userId);
    if (!owner || owner.role !== 'owner') return { statusCode: 403, data: { ok: false, error: '仅创建者可恢复备份' } };
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;
    const backup = await store.findOne('trip_backups', { _id: String(backupId || ''), trip_id: tripId });
    if (!backup) return { statusCode: 404, data: { ok: false, error: '备份不存在' } };

    // 1) 信封校验：格式版本可识别 + 完整性匹配；未知更高版本禁止降级重写。
    const envelope = backupFormat.verifyBackupEnvelope(backup);
    if (!envelope.ok) return { statusCode: 409, data: { ok: false, code: 'BACKUP_UNVERIFIED', error: envelope.reason } };

    // 2) 结构与关联校验：损坏备份一律拒绝；关联缺失需用户显式确认后才可忽略。
    const content = backupFormat.validateBackupContent(backup.data || {}, backup.place_library || []);
    if (content.errors.length) {
      return { statusCode: 409, data: { ok: false, code: 'BACKUP_INVALID', error: `备份校验未通过：${content.errors.slice(0, 2).join('；')}`, errors: content.errors } };
    }
    if (content.linkIssues.length && !allowMissingLinks) {
      return { statusCode: 409, data: { ok: false, code: 'BACKUP_LINK_MISSING', error: `备份中存在关联缺失：${content.linkIssues.slice(0, 2).join('；')}。请确认后再恢复。`, link_issues: content.linkIssues } };
    }

    // 3) 恢复前保护当前数据：先落一份"恢复前快照"，任何失败都不会破坏原数据且可回退。
    const now = new Date().toISOString();
    const currentLibrary = await accountPlaceLibrary(userId, trip.data?.locations);
    const guard = await insertBackupEnvelope({ tripId, userId, trip, library: currentLibrary, now });

    // 4) 应用备份：store.update 仅在找到记录时写入；失败时原数据保持不变。
    const patch = { data: JSON.parse(JSON.stringify(backup.data || {})) };
    if (backup.trip_name) patch.name = backup.trip_name;
    let saved;
    try {
      const user = await store.findOne('users', { _id: userId });
      const related = Array.isArray(backup.place_library) && user && backup.created_by === userId ? [libraryChange(user, backup.place_library)] : [];
      const committed = await commitTrip(tripId, baseUpdatedAt, patch, related);
      if (!committed.updated) return versionConflict(await store.findOne('trips', { _id: tripId }) || trip);
      saved = committed.doc;
    } catch (error) {
      return { statusCode: 500, data: { ok: false, code: 'RESTORE_FAILED', error: `恢复失败，原行程数据保持不变：${error.message}`, guard_backup_id: guard._id } };
    }

    // 5) 通用地点库单独恢复；失败只降级为警告，并如实反馈（部分成功不谎报全成功）。
    const warnings = [...(content.warnings || [])];
    if (backup.created_by !== userId) warnings.push('该备份由其他协作者创建，仅恢复共享行程，不替换本人的私人地点库');
    if (content.linkIssues.length) warnings.push(...content.linkIssues.map(issue => `已按确认忽略：${issue}`));
    await pruneBackups(tripId, 3);
    return { statusCode: 200, data: { ok: true, trip: publicTrip(saved, owner.role), guard_backup_id: guard._id, warnings } };
  }

  // 轻量时间表：只返回 activeVersion 与其 schedule（避免小程序端回传大体积 data）
  async function getSchedule(userId, tripId) {
    let trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权访问该行程' } };
    trip = await migrateTripEventCategories(trip);
    const data = trip.data || {};
    const versions = data.versions || {};
    const activeVersion = data.activeVersion || Object.keys(versions)[0] || null;
    let schedule = activeVersion && versions[activeVersion] ? versions[activeVersion].schedule || [] : [];
    // 轨迹 polyline 降采样（避免大行程超 callFunction 限制）
    schedule = schedule.map(e => {
      const pl = e.routeInfo && Array.isArray(e.routeInfo.polyline) ? e.routeInfo.polyline : null;
      if (!pl || pl.length <= 240) return e;
      const sampled = pl.filter((_, i) => i % 10 === 0 || i === pl.length - 1);
      return { ...e, routeInfo: { ...e.routeInfo, polyline: sampled } };
    });
    return {
      statusCode: 200,
      data: {
        ok: true, name: trip.name, role: member.role, activeVersion, schedule,
        share_code: trip.share_code || null, share_enabled: !!trip.share_enabled, share_readonly: !!trip.share_readonly,
        updated_at: trip.updated_at,
      },
    };
  }

  async function updateSchedule(userId, tripId, { schedule, baseUpdatedAt }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    // 读取后立即固化版本字符串：LocalStore 的 findOne 返回活对象，任何 await 后的再次读取
    // 都可能已被并发写入改写，导致"基于旧版本写入"被误判为可写。
    const expectedUpdatedAt = String(baseUpdatedAt || trip.updated_at || '');
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    if (member && member.role === 'viewer') return { statusCode: 403, data: { ok: false, error: '只读分享，无法编辑' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;

    if (!Array.isArray(schedule)) return { statusCode: 400, data: { ok: false, error: '时间表数据格式错误' } };
    const data = JSON.parse(JSON.stringify(trip.data || {}));
    const versions = data.versions || {};
    const activeVersion = data.activeVersion || Object.keys(versions)[0];
    if (!activeVersion || !versions[activeVersion]) {
      return { statusCode: 400, data: { ok: false, error: '行程数据异常（无活动计划）' } };
    }
    versions[activeVersion].schedule = schedule.map(event => ({ ...event, category: canonicalEventCategory(event?.type) }));
    data.eventCategoryVersion = 1;
    versions[activeVersion].updatedAt = new Date().toISOString();
    const saved = await commitTrip(tripId, expectedUpdatedAt, { data });
    if (!saved.updated) return versionConflict(trip);
    return { statusCode: 200, data: { ok: true, updated_at: saved.doc.updated_at, count: schedule.length } };
  }

  // 轻量 plan 数据：locations 去照片/详情大字段，route polyline 降采样（防 callFunction 超限）
  function downsamplePolyline(str, step = 10) {
    if (typeof str !== 'string' || !str) return '';
    const parts = str.split(';');
    if (parts.length <= 240) return str;
    const sampled = [];
    for (let i = 0; i < parts.length; i += step) sampled.push(parts[i]);
    const last = parts[parts.length - 1];
    if (sampled[sampled.length - 1] !== last) sampled.push(last);
    return sampled.join(';');
  }
  const sanitizeLocation = loc => ({ id: loc.id, type: loc.type, name: loc.name, resolved: loc.resolved || null });
  const sanitizeRoute = r => ({
    id: r.id,
    name: r.name,
    amap: {
      distance: r.amap && r.amap.distance || 0,
      duration: r.amap && r.amap.duration || 0,
      tolls: r.amap && r.amap.tolls || 0,
      steps: ((r.amap && r.amap.steps) || []).map(s => ({ polyline: downsamplePolyline(s.polyline) })),
    },
  });
  function planIdFromName(name) {
    const slug = String(name || 'plan').trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '') || 'plan';
    return `${slug}-${crypto.randomBytes(4).toString('hex')}`;
  }
  function activeVersionOf(data) {
    const versions = data.versions || {};
    return data.activeVersion && versions[data.activeVersion] ? data.activeVersion : Object.keys(versions)[0] || null;
  }

  async function getPlan(userId, tripId) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权访问该行程' } };
    const data = trip.data || {};
    const versions = data.versions || {};
    const av = activeVersionOf(data);
    const plan = av ? versions[av] : null;
    return {
      statusCode: 200,
      data: {
        ok: true,
        name: trip.name,
        role: member.role,
        activeVersion: av,
        plans: (data.plans || []).map(p => ({ id: p.id, name: p.name })),
        plan: plan ? {
          name: plan.name || '',
          locations: (plan.locations || []).map(sanitizeLocation),
          routes: (plan.routes || []).map(sanitizeRoute),
        } : null,
        updated_at: trip.updated_at,
      },
    };
  }

  async function switchPlan(userId, tripId, { activeVersion, baseUpdatedAt }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    if (member && member.role === 'viewer') return { statusCode: 403, data: { ok: false, error: '只读分享，无法编辑' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;

    const data = trip.data || {};
    if (!activeVersion || !(data.versions || {})[activeVersion]) {
      return { statusCode: 400, data: { ok: false, error: '计划不存在' } };
    }
    const saved = await commitTrip(tripId, baseUpdatedAt || trip.updated_at, { data: { ...data, activeVersion } });
    if (!saved.updated) return versionConflict(trip);
    return { statusCode: 200, data: { ok: true, activeVersion, updated_at: saved.doc.updated_at } };
  }

  async function createPlan(userId, tripId, { name, baseUpdatedAt }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    if (member && member.role === 'viewer') return { statusCode: 403, data: { ok: false, error: '只读分享，无法编辑' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;

    name = String(name || '').trim();
    if (!name) return { statusCode: 400, data: { ok: false, error: '计划名称不能为空' } };
    const data = trip.data || {};
    const versions = data.versions || {};
    const av = activeVersionOf(data);
    const id = planIdFromName(name);
    versions[id] = {
      name, items: [], schedule: [], locations: [], routes: [], expenses: {},
      placeCategories: [], preferences: JSON.parse(JSON.stringify((av && versions[av] && versions[av].preferences) || {})),
      placeModelVersion: 1, routeLinkModeVersion: 1, planKey: id, updatedAt: new Date().toISOString(),
    };
    const plans = [...(data.plans || []), { id, name }];
    const newData = { ...data, activeVersion: id, plans, versions };
    const saved = await commitTrip(tripId, baseUpdatedAt || trip.updated_at, { data: newData });
    if (!saved.updated) return versionConflict(trip);
    return { statusCode: 200, data: { ok: true, activeVersion: id, plans: plans.map(p => ({ id: p.id, name: p.name })), updated_at: saved.doc.updated_at } };
  }

  async function copyPlan(userId, tripId, { baseUpdatedAt } = {}) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    if (member && member.role === 'viewer') return { statusCode: 403, data: { ok: false, error: '只读分享，无法编辑' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;

    const data = trip.data || {};
    const versions = data.versions || {};
    const av = activeVersionOf(data);
    if (!av || !versions[av]) return { statusCode: 400, data: { ok: false, error: '无活动计划' } };
    const base = versions[av];
    const id = planIdFromName(`${base.name} 副本`);
    versions[id] = { ...JSON.parse(JSON.stringify(base)), name: `${base.name} 副本`, planKey: id, updatedAt: new Date().toISOString() };
    const plans = [...(data.plans || []), { id, name: `${base.name} 副本` }];
    const newData = { ...data, activeVersion: id, plans, versions };
    const saved = await commitTrip(tripId, baseUpdatedAt || trip.updated_at, { data: newData });
    if (!saved.updated) return versionConflict(trip);
    return { statusCode: 200, data: { ok: true, activeVersion: id, plans: plans.map(p => ({ id: p.id, name: p.name })), updated_at: saved.doc.updated_at } };
  }

  async function removePlan(userId, tripId, { id, baseUpdatedAt }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    if (member && member.role === 'viewer') return { statusCode: 403, data: { ok: false, error: '只读分享，无法编辑' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;

    const data = trip.data || {};
    const plans = (data.plans || []).filter(p => p.id !== id);
    if (plans.length === 0) return { statusCode: 400, data: { ok: false, error: '至少保留一个计划' } };
    const versions = { ...(data.versions || {}) };
    delete versions[id];
    const newData = {
      ...data, plans, versions,
      activeVersion: data.activeVersion === id ? plans[0].id : data.activeVersion,
    };
    const saved = await commitTrip(tripId, baseUpdatedAt || trip.updated_at, { data: newData });
    if (!saved.updated) return versionConflict(trip);
    return { statusCode: 200, data: { ok: true, activeVersion: newData.activeVersion, plans: plans.map(p => ({ id: p.id, name: p.name })), updated_at: saved.doc.updated_at } };
  }

  // 轻量地点：仅返回编辑所需字段（photo/poiDetails 大字段不传输，更新时按 id 保留）
  async function getLocations(userId, tripId) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权访问该行程' } };
    const data = trip.data || {};
    const versions = data.versions || {};
    const av = activeVersionOf(data);
    const locations = av && versions[av] ? versions[av].locations || [] : [];
    return {
      statusCode: 200,
      data: { ok: true, activeVersion: av, locations: locations.map(l => ({ id: l.id, type: l.type, name: l.name, address: l.address || '', note: l.note || '', resolved: l.resolved || null, photo: String(l.photo || '').replace(/^http:\/\//, 'https://'), poiDetails: l.poiDetails || null })) },
    };
  }

  async function updateLocations(userId, tripId, { locations, deleted = [], baseUpdatedAt }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const expectedUpdatedAt = String(baseUpdatedAt || trip.updated_at || '');
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    if (member && member.role === 'viewer') return { statusCode: 403, data: { ok: false, error: '只读分享，无法编辑' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;

    if (!Array.isArray(locations)) return { statusCode: 400, data: { ok: false, error: '地点数据格式错误' } };
    const data = JSON.parse(JSON.stringify(trip.data || {}));
    const versions = data.versions || {};
    const av = activeVersionOf(data);
    if (!av || !versions[av]) return { statusCode: 400, data: { ok: false, error: '行程数据异常（无活动计划）' } };
    // 增量合并：发送来的地点按 id 覆盖/新增，未发送的保留；deleted 中的 id 被移除。
    // 前端可只发“新增/变更”的地点，避免每次保存都全量重传所有地点图片。
    const previous = versions[av].locations || [];
    const byId = new Map(previous.map(p => [p.id, p]));
    const deleteSet = new Set(Array.isArray(deleted) ? deleted.filter(Boolean) : []);
    locations.forEach(l => {
      if (!l?.id || deleteSet.has(l.id)) return;
      const old = byId.get(l.id) || {};
      byId.set(l.id, { ...old, ...l, resolved: l.resolved || old.resolved || null });
    });
    const merged = [...byId.values()].filter(p => !deleteSet.has(p.id));
    versions[av].locations = merged;
    versions[av].updatedAt = new Date().toISOString();
    const saved = await commitTrip(tripId, expectedUpdatedAt, { data });
    if (!saved.updated) return versionConflict(trip);
    return { statusCode: 200, data: { ok: true, updated_at: saved.doc.updated_at, count: merged.length } };
  }

  // 轻量账本：独立账目（versions[av].expenses）
  async function getExpenses(userId, tripId) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权访问该行程' } };
    const data = trip.data || {};
    const versions = data.versions || {};
    const av = activeVersionOf(data);
    const expenses = av && versions[av] ? versions[av].expenses || [] : [];
    return { statusCode: 200, data: { ok: true, activeVersion: av, expenses } };
  }

  async function updateExpenses(userId, tripId, { expenses, schedule, baseUpdatedAt }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const expectedUpdatedAt = String(baseUpdatedAt || trip.updated_at || '');
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    if (member && member.role === 'viewer') return { statusCode: 403, data: { ok: false, error: '只读分享，无法编辑' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;

    if (!Array.isArray(expenses)) return { statusCode: 400, data: { ok: false, error: '账目数据格式错误' } };
    if (schedule !== undefined && !Array.isArray(schedule)) return { statusCode: 400, data: { ok: false, error: '关联事件数据格式错误' } };
    const data = JSON.parse(JSON.stringify(trip.data || {}));
    const versions = data.versions || {};
    const av = activeVersionOf(data);
    if (!av || !versions[av]) return { statusCode: 400, data: { ok: false, error: '行程数据异常（无活动计划）' } };
    versions[av].expenses = expenses;
    if (schedule !== undefined) versions[av].schedule = schedule;
    versions[av].updatedAt = new Date().toISOString();
    const saved = await commitTrip(tripId, expectedUpdatedAt, { data });
    if (!saved.updated) return versionConflict(trip);
    return { statusCode: 200, data: { ok: true, updated_at: saved.doc.updated_at, count: expenses.length } };
  }

  // 我的地点库（users.place_library，账号下跨行程复用且不向协作者公开）
  async function getUniversal(userId, tripId) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权访问该行程' } };
    const universal = await accountPlaceLibrary(userId, member.role === 'owner' ? trip.data?.locations : []);
    return {
      statusCode: 200,
      data: { ok: true, locations: universal.map(l => ({ id: l.id, type: l.type, name: l.name, address: l.address || '' })) },
    };
  }

  // 把账号“我的地点库”地点添加到当前行程方案（保留 photo/poiDetails 等大字段）
  async function addUniversalToPlan(userId, tripId, { locationId, baseUpdatedAt }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const expectedUpdatedAt = String(baseUpdatedAt || trip.updated_at || '');
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    if (member && member.role === 'viewer') return { statusCode: 403, data: { ok: false, error: '只读分享，无法编辑' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;

    const data = JSON.parse(JSON.stringify(trip.data || {}));
    const library = await accountPlaceLibrary(userId, member.role === 'owner' ? data.locations : []);
    const source = library.find(l => l.id === locationId);
    if (!source) return { statusCode: 404, data: { ok: false, error: '我的地点库中不存在该地点' } };
    const versions = data.versions || {};
    const av = activeVersionOf(data);
    if (!av || !versions[av]) return { statusCode: 400, data: { ok: false, error: '行程数据异常（无活动计划）' } };
    const planLocs = versions[av].locations || [];
    if (!planLocs.some(l => l.id === source.id)) {
      planLocs.push({ ...JSON.parse(JSON.stringify(source)) });
      versions[av].locations = planLocs;
      versions[av].updatedAt = new Date().toISOString();
      const saved = await commitTrip(tripId, expectedUpdatedAt, { data });
      if (!saved.updated) return versionConflict(trip);
      return { statusCode: 200, data: { ok: true, updated_at: saved.doc.updated_at } };
    }
    return { statusCode: 200, data: { ok: true, updated_at: trip.updated_at } };
  }

  // 自定义地点类别（versions[av].placeCategories）
  async function getCategories(userId, tripId) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权访问该行程' } };
    const data = trip.data || {};
    const versions = data.versions || {};
    const av = activeVersionOf(data);
    const categories = av && versions[av] ? versions[av].placeCategories || [] : [];
    return { statusCode: 200, data: { ok: true, categories } };
  }

  async function updateCategories(userId, tripId, { categories, baseUpdatedAt }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const expectedUpdatedAt = String(baseUpdatedAt || trip.updated_at || '');
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    if (member && member.role === 'viewer') return { statusCode: 403, data: { ok: false, error: '只读分享，无法编辑' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;

    if (!Array.isArray(categories)) return { statusCode: 400, data: { ok: false, error: '类别数据格式错误' } };
    const data = JSON.parse(JSON.stringify(trip.data || {}));
    const versions = data.versions || {};
    const av = activeVersionOf(data);
    if (!av || !versions[av]) return { statusCode: 400, data: { ok: false, error: '行程数据异常（无活动计划）' } };
    versions[av].placeCategories = categories;
    versions[av].updatedAt = new Date().toISOString();
    const saved = await commitTrip(tripId, expectedUpdatedAt, { data });
    if (!saved.updated) return versionConflict(trip);
    return { statusCode: 200, data: { ok: true, updated_at: saved.doc.updated_at, count: categories.length } };
  }

  // 导出完整 JSON 到云存储（返回 fileID，小程序下载/分享；避免 callFunction 数据量限制）
  async function exportJson(userId, tripId) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权访问该行程' } };
    try {
      const cloud = require('wx-server-sdk');
      cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
      const safeName = String(trip.name || '行程').replace(/[^\w\u4e00-\u9fa5-]+/g, '_');
      const up = await cloud.uploadFile({
        cloudPath: `exports/${tripId}-${Date.now()}-${safeName}.json`,
        fileContent: Buffer.from(JSON.stringify(trip.data || {}, null, 2), 'utf8'),
      });
      return { statusCode: 200, data: { ok: true, fileID: up.fileID } };
    } catch (err) {
      return { statusCode: 500, data: { ok: false, error: `导出失败：${err.message}` } };
    }
  }

  // 轻量路线（web 端保存拆分用，避免单文档超限）
  async function getRoutes(userId, tripId) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权访问该行程' } };
    const data = trip.data || {};
    const versions = data.versions || {};
    const av = activeVersionOf(data);
    const routes = av && versions[av] ? versions[av].routes || [] : [];
    return { statusCode: 200, data: { ok: true, routes } };
  }

  async function updateRoutes(userId, tripId, { routes, baseUpdatedAt }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const expectedUpdatedAt = String(baseUpdatedAt || trip.updated_at || '');
    const member = await findMember(tripId, userId);
    if (!member || member.role === 'viewer') return { statusCode: 403, data: { ok: false, error: member && member.role === 'viewer' ? '只读分享，无法编辑' : '无权编辑该行程' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;
    if (!Array.isArray(routes)) return { statusCode: 400, data: { ok: false, error: '路线数据格式错误' } };
    const data = JSON.parse(JSON.stringify(trip.data || {}));
    const versions = data.versions || {};
    const av = activeVersionOf(data);
    if (!av || !versions[av]) return { statusCode: 400, data: { ok: false, error: '行程数据异常（无活动计划）' } };
    versions[av].routes = routes;
    versions[av].updatedAt = new Date().toISOString();
    const saved = await commitTrip(tripId, expectedUpdatedAt, { data });
    if (!saved.updated) return versionConflict(trip);
    return { statusCode: 200, data: { ok: true, updated_at: saved.doc.updated_at, count: routes.length } };
  }

  async function updateRoute(userId, tripId, { route, baseUpdatedAt }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const expectedUpdatedAt = String(baseUpdatedAt || trip.updated_at || '');
    const member = await findMember(tripId, userId);
    if (!member || member.role === 'viewer') return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;
    if (!route || typeof route !== 'object' || !String(route.id || '').trim()) {
      return { statusCode: 400, data: { ok: false, error: '路线数据格式错误' } };
    }
    const routeId = String(route.id);
    const data = JSON.parse(JSON.stringify(trip.data || {}));
    const av = activeVersionOf(data);
    if (!av || !data.versions?.[av]) return { statusCode: 400, data: { ok: false, error: '行程数据异常（无活动计划）' } };
    const upsert = list => {
      const next = Array.isArray(list) ? [...list] : [];
      const index = next.findIndex(item => String(item?.id) === routeId);
      if (index >= 0) next[index] = route;
      else next.push(route);
      return next;
    };
    data.versions[av].routes = upsert(data.versions[av].routes);
    data.routes = upsert(data.routes);
    const saved = await commitTrip(tripId, expectedUpdatedAt, { data });
    if (!saved.updated) return versionConflict(trip);
    return { statusCode: 200, data: { ok: true, updated_at: saved.doc.updated_at, route_id: routeId } };
  }

  async function syncRoutes(userId, tripId, { routeIds, baseUpdatedAt }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const expectedUpdatedAt = String(baseUpdatedAt || trip.updated_at || '');
    const member = await findMember(tripId, userId);
    if (!member || member.role === 'viewer') return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    const conflict = guardVersion(trip, baseUpdatedAt);
    if (conflict) return conflict;
    if (!Array.isArray(routeIds)) return { statusCode: 400, data: { ok: false, error: '路线 ID 格式错误' } };
    const ids = new Set(routeIds.map(String));
    const data = JSON.parse(JSON.stringify(trip.data || {}));
    const av = activeVersionOf(data);
    if (!av || !data.versions?.[av]) return { statusCode: 400, data: { ok: false, error: '行程数据异常（无活动计划）' } };
    const retain = routes => (routes || []).filter(route => ids.has(String(route?.id)));
    data.versions[av].routes = retain(data.versions[av].routes);
    data.routes = retain(data.routes);
    const saved = await commitTrip(tripId, expectedUpdatedAt, { data });
    if (!saved.updated) return versionConflict(trip);
    return { statusCode: 200, data: { ok: true, updated_at: saved.doc.updated_at, count: ids.size } };
  }

  return { list, create, get, update, remove, join, share, members, updateMember, removeMember, listBackups, createBackup, restoreBackup, getSchedule, updateSchedule, getPlan, switchPlan, createPlan, copyPlan, removePlan, getLocations, updateLocations, getExpenses, updateExpenses, getUniversal, addUniversalToPlan, getCategories, updateCategories, exportJson, getRoutes, updateRoutes, updateRoute, syncRoutes };
}

module.exports = { createTripsRoutes };
