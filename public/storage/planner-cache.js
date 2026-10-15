const DB_NAME = 'roadtrip-planner-cache';
const DB_VERSION = 2;
const STORE = 'planner-snapshots';
const QUEUE_STORE = 'pending-saves';

function openDatabase(indexedDb = globalThis.indexedDB, timeoutMs = 2500) {
  if (!indexedDb) return Promise.resolve(null);
  return new Promise(resolve => {
    const request = indexedDb.open(DB_NAME, DB_VERSION);
    let settled = false;
    const finish = value => {
      if (settled) { value?.close?.(); return; }
      settled = true; clearTimeout(timer); resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(QUEUE_STORE)) db.createObjectStore(QUEUE_STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => finish(request.result);
    request.onerror = () => finish(null);
    // Safari 在旧页面仍持有数据库连接时可能只触发 blocked，不再触发成功或失败。
    // 缓存不是启动必需项，直接降级到云端读取，不能阻塞整个应用。
    request.onblocked = () => finish(null);
  });
}

export function createPlannerCache({ indexedDb = globalThis.indexedDB, scope = 'anonymous', operationTimeoutMs = 2500 } = {}) {
  const keyFor = tripId => `${scope}:${tripId || 'local'}`;
  async function transact(mode, callback, storeName = STORE) {
    const db = await openDatabase(indexedDb, operationTimeoutMs).catch(() => null);
    if (!db) return null;
    return new Promise(resolve => {
      const transaction = db.transaction(storeName, mode);
      const request = callback(transaction.objectStore(storeName));
      let settled = false;
      let requestResult = null;
      const finish = value => {
        if (settled) return;
        settled = true; clearTimeout(timer); db.close(); resolve(value);
      };
      const timer = setTimeout(() => { try { transaction.abort(); } catch { /* ignore */ } db.close(); finish(null); }, operationTimeoutMs);
      request.onsuccess = () => { requestResult = request.result ?? null; };
      request.onerror = () => finish(null);
      transaction.onabort = () => finish(null);
      transaction.oncomplete = () => finish(requestResult);
    }).catch(() => null);
  }
  async function clearPendingIfMatches(tripId, expected) {
    const db = await openDatabase(indexedDb, operationTimeoutMs).catch(() => null);
    if (!db) return false;
    return new Promise(resolve => {
      const transaction = db.transaction(QUEUE_STORE, 'readwrite');
      const store = transaction.objectStore(QUEUE_STORE);
      const request = store.get(keyFor(tripId));
      let removed = false, settled = false;
      const finish = value => { if (!settled) { settled = true; clearTimeout(timer); db.close(); resolve(value); } };
      const timer = setTimeout(() => { try { transaction.abort(); } catch { /* already closed */ } finish(false); }, operationTimeoutMs);
      request.onsuccess = () => {
        if (JSON.stringify(request.result?.data) !== JSON.stringify(expected)) return;
        store.delete(keyFor(tripId)); removed = true;
      };
      transaction.oncomplete = () => finish(removed);
      transaction.onabort = transaction.onerror = () => finish(false);
    }).catch(() => false);
  }
  return {
    scope,
    async read(tripId) { return (await transact('readonly', store => store.get(keyFor(tripId))))?.data || null; },
    async write(tripId, data) { return transact('readwrite', store => store.put({ key: keyFor(tripId), data, cachedAt: new Date().toISOString() })); },
    async remove(tripId) { return transact('readwrite', store => store.delete(keyFor(tripId))); },
    async readPending(tripId) { return (await transact('readonly', store => store.get(keyFor(tripId)), QUEUE_STORE))?.data || null; },
    async writePending(tripId, data) { return transact('readwrite', store => store.put({ key: keyFor(tripId), data, queuedAt: new Date().toISOString() }), QUEUE_STORE); },
    async clearPending(tripId, expected) {
      if (expected !== undefined) return clearPendingIfMatches(tripId, expected);
      return transact('readwrite', store => store.delete(keyFor(tripId)), QUEUE_STORE);
    }
  };
}
