export function createHistoryController({ enabled, createSnapshot, restoreSnapshot, onStateChange, limit = 20 }) {
  const undoStack = [], redoStack = [];
  let lastCommitted = null, restoring = false;
  const signature = payload => {
    const { updatedAt, baseUpdatedAt, sharedSchedule, ...rest } = payload;
    return JSON.stringify(rest);
  };
  function commit() {
    if (restoring || !enabled()) return;
    const payload = createSnapshot(), currentSignature = signature(payload);
    if (lastCommitted === null || signature(lastCommitted) === currentSignature) { lastCommitted = payload; return; }
    undoStack.push(JSON.stringify(lastCommitted)); if (undoStack.length > limit) undoStack.shift();
    redoStack.length = 0; lastCommitted = payload; onStateChange(state());
  }
  function restore(raw) {
    restoring = true;
    try { restoreSnapshot(raw); lastCommitted = createSnapshot(); }
    finally { restoring = false; }
    onStateChange(state());
  }
  function undo() {
    const previous = undoStack.pop(); if (!previous) return;
    redoStack.push(JSON.stringify(createSnapshot())); if (redoStack.length > limit) redoStack.shift(); restore(previous);
  }
  function redo() {
    const next = redoStack.pop(); if (!next) return;
    undoStack.push(JSON.stringify(createSnapshot())); if (undoStack.length > limit) undoStack.shift(); restore(next);
  }
  const state = () => ({ canUndo: Boolean(undoStack.length), canRedo: Boolean(redoStack.length), restoring });
  return { commit, undo, redo, state, refresh: () => onStateChange(state()) };
}
