// Browser persistence is intentionally the sole LocalStorage boundary.
export function createPersistence({ runtime, api, onSaveStatus = () => {} }) {
  let timer;
  let enabled = false;
  const editable = !runtime.shareMode;

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
  function disableAutoSave() { enabled = false; clearTimeout(timer); }

  function queueFileSave(buildPayload, delay = 300) {
    if (!enabled) return;
    clearTimeout(timer);
    onSaveStatus('等待写入本地文件…');
    timer = setTimeout(async () => {
      try {
        const result = await api.savePlannerData(buildPayload());
        onSaveStatus(`已写入本地文件 · ${new Date(result.savedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`);
      } catch { onSaveStatus('本地文件写入失败'); }
    }, delay);
  }

  return { read, readRaw, write, remove, readFlag, writeFlag, enableAutoSave, disableAutoSave, queueFileSave, get autoSaveEnabled() { return enabled; }, editable };
}
