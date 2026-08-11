export function createPersistence({ runtime, store, saveFile }) {
  let timer;
  const editable = !runtime.shareMode;

  function read(key, fallback = null) {
    if (!editable) return fallback;
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; }
  }

  function write(key, value) {
    if (editable) localStorage.setItem(key, JSON.stringify(value));
  }

  function queueSave(buildPayload, delay = 300) {
    if (!editable) return;
    clearTimeout(timer);
    timer = setTimeout(() => saveFile?.(buildPayload()), delay);
  }

  function saveSnapshot(key, snapshot) { write(key, snapshot); }
  function readSnapshot(key) { return read(key); }
  return { read, write, queueSave, saveSnapshot, readSnapshot, editable, store };
}
