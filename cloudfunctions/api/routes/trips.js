// 行程接口：trips CRUD / join（分享码协作）/ share（owner 开关分享）/ members。
// 权限模型：owner 全权；editor 可读可改；未加入者 403。统一返回 { statusCode, data }。
'use strict';

const crypto = require('node:crypto');

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
    updated_at: trip.updated_at,
    role,
  };
}

function createTripsRoutes({ store }) {
  async function findMember(tripId, userId) {
    return store.findOne('trip_members', { trip_id: tripId, user_id: userId });
  }

  async function list(userId) {
    const members = await store.find('trip_members', { user_id: userId });
    const mine = [];
    const shared = [];
    for (const m of members) {
      const trip = await store.findOne('trips', { _id: m.trip_id });
      if (!trip) continue;
      if (m.role === 'owner') mine.push(tripSummary(trip, 'owner'));
      else shared.push(tripSummary(trip, 'editor'));
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
      data: data && typeof data === 'object' ? data : {},
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

  async function get(userId, tripId) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权访问该行程' } };
    return { statusCode: 200, data: { ok: true, trip: publicTrip(trip, member.role) } };
  }

  async function update(userId, tripId, { name, data }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    const patch = { updated_at: new Date().toISOString() };
    if (name !== undefined) {
      if (!String(name).trim()) return { statusCode: 400, data: { ok: false, error: '行程名称不能为空' } };
      patch.name = String(name).trim();
    }
    if (data !== undefined) {
      if (!data || typeof data !== 'object') return { statusCode: 400, data: { ok: false, error: '行程数据格式错误' } };
      patch.data = data;
    }
    const saved = await store.update('trips', { _id: tripId }, patch);
    return { statusCode: 200, data: { ok: true, trip: publicTrip(saved, member.role) } };
  }

  async function remove(userId, tripId) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member || member.role !== 'owner') {
      return { statusCode: 403, data: { ok: false, error: '仅创建者可删除行程' } };
    }
    await store.remove('trips', { _id: tripId });
    await store.remove('trip_members', { trip_id: tripId });
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
        role: 'editor',
        joined_at: new Date().toISOString(),
      });
    }
    return { statusCode: 200, data: { ok: true, trip: publicTrip(trip, member.role) } };
  }

  async function share(userId, tripId, { enabled }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member || member.role !== 'owner') {
      return { statusCode: 403, data: { ok: false, error: '仅创建者可管理分享' } };
    }
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
    const saved = await store.update('trips', { _id: tripId }, { share_code: shareCode, share_enabled: wantEnabled });
    return { statusCode: 200, data: { ok: true, trip: publicTrip(saved, member.role) } };
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
        nickname: u ? u.nickname : '未知用户',
        role: row.role,
        joined_at: row.joined_at,
      });
    }
    return { statusCode: 200, data: { ok: true, members: list } };
  }

  // 轻量时间表：只返回 activeVersion 与其 schedule（避免小程序端回传大体积 data）
  async function getSchedule(userId, tripId) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权访问该行程' } };
    const data = trip.data || {};
    const versions = data.versions || {};
    const activeVersion = data.activeVersion || Object.keys(versions)[0] || null;
    const schedule = activeVersion && versions[activeVersion] ? versions[activeVersion].schedule || [] : [];
    return {
      statusCode: 200,
      data: {
        ok: true, name: trip.name, role: member.role, activeVersion, schedule,
        share_code: trip.share_code || null, share_enabled: !!trip.share_enabled,
        updated_at: trip.updated_at,
      },
    };
  }

  async function updateSchedule(userId, tripId, { schedule }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    if (!Array.isArray(schedule)) return { statusCode: 400, data: { ok: false, error: '时间表数据格式错误' } };
    const data = trip.data || {};
    const versions = data.versions || {};
    const activeVersion = data.activeVersion || Object.keys(versions)[0];
    if (!activeVersion || !versions[activeVersion]) {
      return { statusCode: 400, data: { ok: false, error: '行程数据异常（无活动计划）' } };
    }
    versions[activeVersion].schedule = schedule;
    versions[activeVersion].updatedAt = new Date().toISOString();
    const saved = await store.update('trips', { _id: tripId }, { data, updated_at: new Date().toISOString() });
    return { statusCode: 200, data: { ok: true, updated_at: saved.updated_at, count: schedule.length } };
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

  async function switchPlan(userId, tripId, { activeVersion }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    const data = trip.data || {};
    if (!activeVersion || !(data.versions || {})[activeVersion]) {
      return { statusCode: 400, data: { ok: false, error: '计划不存在' } };
    }
    await store.update('trips', { _id: tripId }, { data: { ...data, activeVersion }, updated_at: new Date().toISOString() });
    return { statusCode: 200, data: { ok: true, activeVersion } };
  }

  async function createPlan(userId, tripId, { name }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
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
    await store.update('trips', { _id: tripId }, { data: newData, updated_at: new Date().toISOString() });
    return { statusCode: 200, data: { ok: true, activeVersion: id, plans: plans.map(p => ({ id: p.id, name: p.name })) } };
  }

  async function copyPlan(userId, tripId) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    const data = trip.data || {};
    const versions = data.versions || {};
    const av = activeVersionOf(data);
    if (!av || !versions[av]) return { statusCode: 400, data: { ok: false, error: '无活动计划' } };
    const base = versions[av];
    const id = planIdFromName(`${base.name} 副本`);
    versions[id] = { ...JSON.parse(JSON.stringify(base)), name: `${base.name} 副本`, planKey: id, updatedAt: new Date().toISOString() };
    const plans = [...(data.plans || []), { id, name: `${base.name} 副本` }];
    const newData = { ...data, activeVersion: id, plans, versions };
    await store.update('trips', { _id: tripId }, { data: newData, updated_at: new Date().toISOString() });
    return { statusCode: 200, data: { ok: true, activeVersion: id, plans: plans.map(p => ({ id: p.id, name: p.name })) } };
  }

  async function removePlan(userId, tripId, { id }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    const data = trip.data || {};
    const plans = (data.plans || []).filter(p => p.id !== id);
    if (plans.length === 0) return { statusCode: 400, data: { ok: false, error: '至少保留一个计划' } };
    const versions = { ...(data.versions || {}) };
    delete versions[id];
    const newData = {
      ...data, plans, versions,
      activeVersion: data.activeVersion === id ? plans[0].id : data.activeVersion,
    };
    await store.update('trips', { _id: tripId }, { data: newData, updated_at: new Date().toISOString() });
    return { statusCode: 200, data: { ok: true, activeVersion: newData.activeVersion, plans: plans.map(p => ({ id: p.id, name: p.name })) } };
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
      data: { ok: true, activeVersion: av, locations: locations.map(l => ({ id: l.id, type: l.type, name: l.name, address: l.address || '', note: l.note || '', resolved: l.resolved || null })) },
    };
  }

  async function updateLocations(userId, tripId, { locations }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    if (!Array.isArray(locations)) return { statusCode: 400, data: { ok: false, error: '地点数据格式错误' } };
    const data = trip.data || {};
    const versions = data.versions || {};
    const av = activeVersionOf(data);
    if (!av || !versions[av]) return { statusCode: 400, data: { ok: false, error: '行程数据异常（无活动计划）' } };
    // 保留原有 photo/poiDetails 等大字段
    const previous = versions[av].locations || [];
    const merged = locations.map(l => {
      const old = previous.find(p => p.id === l.id) || {};
      return { ...old, ...l, resolved: l.resolved || old.resolved || null };
    });
    versions[av].locations = merged;
    versions[av].updatedAt = new Date().toISOString();
    await store.update('trips', { _id: tripId }, { data, updated_at: new Date().toISOString() });
    return { statusCode: 200, data: { ok: true, count: merged.length } };
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

  async function updateExpenses(userId, tripId, { expenses }) {
    const trip = await store.findOne('trips', { _id: tripId });
    if (!trip) return { statusCode: 404, data: { ok: false, error: '行程不存在' } };
    const member = await findMember(tripId, userId);
    if (!member) return { statusCode: 403, data: { ok: false, error: '无权编辑该行程' } };
    if (!Array.isArray(expenses)) return { statusCode: 400, data: { ok: false, error: '账目数据格式错误' } };
    const data = trip.data || {};
    const versions = data.versions || {};
    const av = activeVersionOf(data);
    if (!av || !versions[av]) return { statusCode: 400, data: { ok: false, error: '行程数据异常（无活动计划）' } };
    versions[av].expenses = expenses;
    versions[av].updatedAt = new Date().toISOString();
    await store.update('trips', { _id: tripId }, { data, updated_at: new Date().toISOString() });
    return { statusCode: 200, data: { ok: true, count: expenses.length } };
  }

  return { list, create, get, update, remove, join, share, members, getSchedule, updateSchedule, getPlan, switchPlan, createPlan, copyPlan, removePlan, getLocations, updateLocations, getExpenses, updateExpenses };
}

module.exports = { createTripsRoutes };
