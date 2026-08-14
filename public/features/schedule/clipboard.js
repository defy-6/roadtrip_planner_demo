export function createScheduleClipboardController({
  state,
  selectedIndexes,
  clockToMinute,
  minuteToClock,
  getTarget,
  getTargetId,
  getPasteAnchor,
  setSelectionAnchor,
  save,
  render
}) {
  let clipboard = '';

  function copy() {
    if (!selectedIndexes.size) return false;
    clipboard = JSON.stringify([...selectedIndexes].sort((a, b) => a - b).map(index => state.schedule[index]).filter(Boolean));
    navigator.clipboard?.writeText(clipboard).catch(() => {});
    return true;
  }

  async function paste() {
    let raw = clipboard;
    if (!raw) { try { raw = await navigator.clipboard.readText(); } catch { return false; } }
    let copied;
    try { copied = JSON.parse(raw); } catch { return false; }
    if (!Array.isArray(copied) || !copied.length) return false;
    const target = getTarget();
    const sourceStart = copied[0]?.start ? clockToMinute(copied[0].start) : 0;
    const targetStart = target?.start ? clockToMinute(target.start) : sourceStart;
    const timeDelta = target ? targetStart - sourceStart : 0;
    const clones = copied.map(entry => {
      const clone = { ...entry, routeLinks: entry.routeLinks ? structuredClone(entry.routeLinks) : undefined, flightInfo: entry.flightInfo ? { ...entry.flightInfo } : undefined, sharedId: entry.date < '2026-08-20' ? `shared-paste-${crypto.randomUUID()}` : undefined };
      if (target?.date) {
        clone.date = target.date;
        if (clone.start) clone.start = minuteToClock(Math.max(0, Math.min(1435, clockToMinute(clone.start) + timeDelta)));
        if (clone.end) clone.end = minuteToClock(Math.max(5, Math.min(1439, clockToMinute(clone.end) + timeDelta)));
      }
      if (clone.date < '2026-08-20') clone.sharedId = `shared-paste-${crypto.randomUUID()}`;
      return clone;
    });
    const targetId = getTargetId();
    const targetIndex = targetId ? state.schedule.findIndex(entry => entry.sharedId === targetId) : -1;
    const anchor = getPasteAnchor();
    const insertAt = targetIndex >= 0 ? targetIndex : (Number.isInteger(anchor) ? anchor : (selectedIndexes.size ? Math.max(...selectedIndexes) + 1 : state.schedule.length));
    state.schedule.splice(insertAt, 0, ...clones);
    selectedIndexes.clear();
    clones.forEach((_, offset) => selectedIndexes.add(insertAt + offset));
    setSelectionAnchor(insertAt);
    save();
    render();
    return true;
  }

  return { copy, paste };
}
