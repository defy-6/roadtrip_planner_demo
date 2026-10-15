// Browser persistence is intentionally the sole LocalStorage boundary.
export function createPersistence({ runtime, api, onSaveStatus = () => {}, onSaveBlocked = () => {} }) {
  let timer;
  let enabled = false;
  let generation = 0;
  const editable = runtime.editable !== false && !runtime.shareMode;
  let onFileSaved = () => {};
  let offlineQueue = null, offlineTripId = 'local', retrying = false;
  let pendingConflict = false;
  let draftSequence = 0, undurableSequence = 0;
  const memoryPending = new Map();
  const pendingKey = (queue = offlineQueue, tripId = offlineTripId) => `${queue?.scope || api.getActorScope?.() || 'local'}:${tripId}`;
  let saveChain = Promise.resolve();
  const runSaveExclusive = task => {
    const run = saveChain.then(task, task);
    saveChain = run.catch(() => {});
    return run;
  };

  function read(key, fallback = null) {
    if (!editable) return fallback;
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch { return fallback; }
  }

  function readRaw(key) {
    if (!editable) return null;
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function write(key, value) {
    if (editable) localStorage.setItem(key, JSON.stringify(value));
  }

  function remove(key) { if (editable) localStorage.removeItem(key); }
  function readFlag(key) { return editable && localStorage.getItem(key) === 'true'; }
  function writeFlag(key) { if (editable) localStorage.setItem(key, 'true'); }

  function enableAutoSave() { enabled = editable; }
  function disableAutoSave() { enabled = false; generation++; clearTimeout(timer); }

  function queueFileSave(buildPayload, delay = 300, { manual = false } = {}) {
    if (!enabled) return;
    clearTimeout(timer);
    const queuedGeneration = generation;
    const queue = offlineQueue, tripId = offlineTripId;
    const sequence = ++draftSequence;
    undurableSequence = sequence;
    let payload;
    try {
      payload = JSON.parse(JSON.stringify({ ...buildPayload(), sourceTripId: tripId,
        sourceActorScope: queue?.scope, baseLibraryRevision: api.getLibraryRevision?.() }));
    } catch {
      onSaveStatus('无法创建保存快照 · 修改仅在内存，请先保留备份', 'error'); return;
    }
    const memoryKey = pendingKey(queue, tripId);
    memoryPending.set(memoryKey, payload);
    // 仅表示"已受理本次保存"，此时尚未写入本地队列，不得宣称已持久化。
    onSaveStatus('正在保存到本地并同步云端…');
    timer = setTimeout(() => runSaveExclusive(async () => {
      if (!enabled || queuedGeneration !== generation) return;
      // 结果用于区分"已持久化到本地"与"仅在内存"：null 表示无法持久化
      // （IndexedDB 不可用/超时/队列缺失）；其它值表示已写入待同步队列。
      let queuedToLocal = null;
      try { queuedToLocal = queue ? await queue.writePending(tripId, payload) : null; } catch { /* preserve memory warning */ }
      const durable = queuedToLocal === true || typeof queuedToLocal === 'string';
      if (durable && undurableSequence === sequence) undurableSequence = 0;
      if (tripId !== offlineTripId || queue !== offlineQueue) return;
      if (!enabled || queuedGeneration !== generation) return;
      try {
        const result = await api.savePlannerData(payload);
        if (memoryPending.get(memoryKey) === payload) memoryPending.delete(memoryKey);
        if (undurableSequence === sequence) undurableSequence = 0;
        if (tripId !== offlineTripId || queue !== offlineQueue) { await queue?.clearPending(tripId, payload); return; }
        if (manual && api.getActiveTripId?.()) await api.createTripBackup(api.getActiveTripId());
        onFileSaved(result);
        const cleared = await queue?.clearPending(tripId, payload);
        if (cleared === false) { onSaveStatus('本次已同步，另有本地待同步修改仍保留，请核对', 'warning'); return; }
        onSaveStatus(`${manual ? '已手动保存并创建备份' : '已同步云端'} · ${new Date(result.savedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`);
      } catch (err) {
        const conflict = ['VERSION_CONFLICT', 'RESOURCE_CHANGED', 'SESSION_CHANGED'].includes(err?.code);
        if (conflict) {
          pendingConflict = true; disableAutoSave();
          onSaveStatus(`${err.message || '发现云端版本冲突'} · ${durable ? '待同步修改已持久化保留' : '修改仅在内存，请保留导出备份'}，不会自动覆盖云端`, 'error');
          onSaveBlocked('pending-conflict');
        } else if (err?.status >= 400 && err.status < 500) {
          onSaveStatus(`${err.message || '服务器拒绝本次保存'} · ${durable ? '待同步修改已保留' : '修改仅在内存，请导出备份'}`, 'error');
        } else if (!durable) {
          // 无法持久化：修改只在内存里，必须明确告知刷新/关闭会丢失。
          onSaveStatus('网络不可用 · 修改仅在内存中，刷新或关闭页面会丢失，请保留导出备份', 'error');
        } else {
          onSaveStatus('网络不可用 · 修改已保存在待同步队列', 'warning');
        }
      }
    }), delay);
  }

  // 安全重放前提：待同步快照必须基于当前权威版本，否则视为冲突，保留队列、不覆盖任一方。
  // - 载荷记录了基线：必须与当前权威版本一致。
  // - 载荷未记录基线：仅在无法获知权威版本时才放行（旧数据/未接入版本的服务端），
  //   否则同样无法证明是前向修改，按冲突处理，交由用户核对。
  function canReplayPayload(payload) {
    if (api.getActiveTripId && (api.getActiveTripId() || 'local') !== offlineTripId) return false;
    if (payload?.sourceActorScope && api.getActorScope && payload.sourceActorScope !== api.getActorScope()) return false;
    const expected = String(payload?.baseUpdatedAt || '');
    const current = String(api.getRemoteRevision?.() || '');
    if (!expected) return !current;
    return expected === current;
  }

  async function readPendingChanges() {
    const memory = memoryPending.get(pendingKey());
    if (memory) return JSON.parse(JSON.stringify(memory));
    if (!offlineQueue) return null;
    const queue = offlineQueue, tripId = offlineTripId, key = pendingKey();
    const pending = await queue.readPending(tripId);
    // Keep the already-read recovery snapshot available even if later IDB reads
    // fail or Safari suspends storage after a download. Deletion remains a CAS.
    if (pending && !memoryPending.has(key)) memoryPending.set(key, JSON.parse(JSON.stringify(pending)));
    return pending;
  }

  async function discardPendingChanges(expected) {
    if (!editable || !offlineQueue || !expected) return false;
    disableAutoSave();
    return runSaveExclusive(async () => {
      const cleared = await offlineQueue.clearPending(offlineTripId, expected);
      if (cleared !== true) return false;
      const key = pendingKey();
      if (JSON.stringify(memoryPending.get(key)) === JSON.stringify(expected)) memoryPending.delete(key);
      pendingConflict = false;
      return true;
    });
  }

  // 统一重放入口：'none' 无待同步 | 'replayed' 已同步 | 'conflict' 版本冲突 | 'failed' 未同步。
  // 除 'replayed' 外一律保留队列，绝不用本次读取的快照覆盖未同步修改。
  // 注意：这是显式的维护动作（初始化重放 / 重连刷新），不依赖自动保存开关，
  // 因为初始化期间写入门禁是关闭的；是否中止只由代次决定（disableAutoSave 会推进代次）。
  async function replayPendingChanges() {
    if (!editable || !offlineQueue) return 'none';
    if (retrying) return 'failed';
    // 代次必须在异步读取之前捕获：读取途中若发生暂停（disableAutoSave）即视为作废。
    const queuedGeneration = generation;
    const payload = await offlineQueue.readPending(offlineTripId);
    const remembered = memoryPending.get(pendingKey());
    if (remembered && JSON.stringify(remembered) !== JSON.stringify(payload)) {
      onSaveStatus('另有未落盘的本地修改，请先导出待同步备份；不会重放旧队列', 'warning');
      return 'failed';
    }
    if (!payload) { pendingConflict = false; return 'none'; }
    if (!canReplayPayload(payload)) {
      pendingConflict = true;
      onSaveStatus('云端版本已更新 · 本地未同步修改已保留，未自动覆盖，请核对后处理', 'error');
      return 'conflict';
    }
    retrying = true;
    let conflict = false;
    try {
      const replayed = await runSaveExclusive(async () => {
        if (queuedGeneration !== generation) return false;
        onSaveStatus('正在同步待保存修改…');
        try {
          const result = await api.savePlannerData(payload);
          const cleared = await offlineQueue.clearPending(offlineTripId, payload);
          if (cleared === false) { onSaveStatus('本次已同步，另有本地待同步修改仍保留，请核对', 'warning'); return false; }
          const key = pendingKey();
          if (JSON.stringify(memoryPending.get(key)) === JSON.stringify(payload)) memoryPending.delete(key);
          onFileSaved(result);
          onSaveStatus('待保存修改已同步到云端');
          return true;
        } catch (error) {
          conflict = error?.code === 'VERSION_CONFLICT';
          onSaveStatus(
            conflict ? '云端版本冲突 · 待同步修改已保留，未自动覆盖任一方' : '待同步修改仍未同步 · 已保留本地修改',
            conflict ? 'error' : 'warning'
          );
          return false;
        }
      });
      if (replayed) { pendingConflict = false; return 'replayed'; }
      pendingConflict = conflict;
      return conflict ? 'conflict' : 'failed';
    } finally { retrying = false; }
  }

  // 兼容既有调用点（online 事件）：写入门禁关闭时不得刷新队列，避免读取失败后误传旧数据。
  async function flushOfflineQueue() {
    if (!enabled) return false;
    return (await replayPendingChanges()) === 'replayed';
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => flushOfflineQueue());
    window.addEventListener('beforeunload', event => {
      if (!undurableSequence) return;
      event.preventDefault(); event.returnValue = '';
    });
  }

  return { read, readRaw, write, remove, readFlag, writeFlag, enableAutoSave, disableAutoSave, queueFileSave, flushOfflineQueue, replayPendingChanges, readPendingChanges, discardPendingChanges, hasPendingConflict: () => pendingConflict, waitForIdle: () => saveChain, setOfflineQueue: (queue, tripId = 'local') => { offlineQueue = queue; offlineTripId = tripId; pendingConflict = false; }, setOnFileSaved: listener => { onFileSaved = typeof listener === 'function' ? listener : () => {}; }, get autoSaveEnabled() { return enabled; }, editable };
}
