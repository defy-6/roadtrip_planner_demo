// Private local recovery, never an automatic replay queue. No tokens are stored.
const clone = value => JSON.parse(JSON.stringify(value));
function key(page, tripId) {
  const user = wx.getStorageSync('roadtrip-user');
  const actor = user && (user.id || user._id || user.username);
  if (!actor || !tripId || !page?.route) return null;
  return `roadtrip-draft-v1:${actor}:${tripId}:${page.route}:${page.data?.locationId || page.data?.index || ''}`;
}
function retain(page, tripId, request) {
  try {
    const storageKey = key(page, tripId);
    if (!storageKey) return false;
    const draft = clone({ request, data: page.data, revisions: page.__tripReadVersions,
      sources: Object.fromEntries(['schedule', 'scheduleEvents', 'expenses', 'locations', 'eventOptions']
        .filter(name => page[name] !== undefined).map(name => [name, page[name]])) });
    const encoded = JSON.stringify(draft);
    wx.setStorageSync(storageKey, encoded);
    page.__retainedDraft = { storageKey, encoded, path: request.path, method: request.method };
    return wx.getStorageSync(storageKey) === encoded;
  } catch { return false; }
}
function acknowledge(page, request) {
  if (page) page.__draftDirty = false;
  const draft = page?.__retainedDraft;
  if (!draft || draft.path !== request.path || draft.method !== request.method) return;
  try {
    if (wx.getStorageSync(draft.storageKey) === draft.encoded) wx.removeStorageSync(draft.storageKey);
    delete page.__retainedDraft;
  } catch { /* keep recoverable draft */ }
}
function offerRestore(page, tripId) {
  try {
    const storageKey = key(page, tripId);
    const encoded = storageKey && wx.getStorageSync(storageKey);
    if (!encoded || typeof encoded !== 'string') return;
    const draft = JSON.parse(encoded);
    if (!draft.data || !draft.request || !draft.revisions) return;
    wx.showModal({ title: '发现未提交的本机草稿',
      content: '恢复会采用草稿原来的读取版本，不会自动上传或覆盖云端。取消会继续保留草稿。',
      confirmText: '恢复草稿', cancelText: '暂不恢复',
      success: result => {
        if (!result.confirm) return;
        Object.assign(page, clone(draft.sources || {}));
        page.__tripReadVersions = clone(draft.revisions);
        page.__retainedDraft = { storageKey, encoded, path: draft.request.path, method: draft.request.method };
        page.setData({ ...clone(draft.data), saving: false, busy: false, error: '已恢复本机草稿；云端已变化时保存仍会提示冲突' });
      } });
  } catch { /* malformed drafts are left intact, never uploaded */ }
}
function withDraftLifecycle(definition, domain) {
  // Persist on navigation/backgrounding, not on every keystroke. A local-only
  // draft has no replay behavior and keeps the page's original read baseline.
  for (const name of Object.keys(definition)) {
    if (!/^onInput$|^on.*Change$|^(add|remove)Price/.test(name) || typeof definition[name] !== 'function') continue;
    const handler = definition[name];
    definition[name] = function (...args) { this.__draftDirty = true; return handler.apply(this, args); };
  }
  for (const name of ['onHide', 'onUnload']) {
    const handler = definition[name];
    definition[name] = function (...args) {
      if (this.__draftDirty && this.data?.id) {
        const durable = retain(this, this.data.id, {
          path: `/api/trips/${this.data.id}/${domain}`, method: 'PUT', localOnly: true });
        if (!durable) wx.showToast?.({ title: '草稿保存失败，请返回并保留备份', icon: 'none' });
      }
      return handler?.apply(this, args);
    };
  }
  return definition;
}
module.exports = { retain, acknowledge, offerRestore, withDraftLifecycle };
