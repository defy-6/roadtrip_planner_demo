export function createPlannerInitializer({
  state,
  api,
  persistence,
  plannerCache,
  activeTripId,
  isShareMode,
  shareData,
  defaultPlanId,
  statusNode,
  setPlanCatalog,
  loadFileContainer,
  load,
  loadPreset,
  save,
  renderSchedule,
  renderManualSchedule,
  ensureMapReady,
  renderRouteTotals,
  fileSavePayload,
  getFileRevision,
  setFileRevision,
  getPreviewMode = () => document.documentElement.dataset.previewMode,
  getDraftSnapshot = fileSavePayload,
  confirmDiscardDraft = async () => false
}) {
  let displayed = false;
  let hasCacheDisplay = false;
  let draftBaseline;
  const draftSignature = () => JSON.stringify(getDraftSnapshot(), (key, value) =>
    ['updatedAt', 'baseUpdatedAt', 'savedAt'].includes(key) ? undefined : value);
  const usableSnapshot = value => value && typeof value === 'object' && !Array.isArray(value)
    && (Array.isArray(value.schedule) || Array.isArray(value.items))
    && (value.schedule === undefined || Array.isArray(value.schedule))
    && (value.items === undefined || Array.isArray(value.items));
  const usableContainer = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (Number(value.schemaVersion || 0) > 4 || Object.values(value.versions || {}).some(item => Number(item?.schemaVersion || 0) > 4)) return false;
    if (!value.versions) return usableSnapshot(value);
    if (typeof value.versions !== 'object' || Array.isArray(value.versions)) return false;
    const keys = Array.isArray(value.plans) && value.plans.length
      ? value.plans.map(plan => plan.id) : Object.keys(value.versions);
    return keys.some(key => usableSnapshot(value.versions[key]))
      && keys.every(key => !value.versions[key] || usableSnapshot(value.versions[key]));
  };
  return async function initializePlanner() {
    // Suspend before load(): it may call save(). Wait for already-started writes
    // before replacing state; disabled generations cannot resume after re-enable.
    persistence.disableAutoSave?.();
    if (persistence.waitForIdle) await persistence.waitForIdle();
    let cached = null;
    let freshData = null;
    let dataStatus = 'ready';
    // 只有拿到权威数据（云端成功或分享数据）才算读取成功；
    // 读取失败时不得启用自动保存、不得写入、不得刷新待同步队列，
    // 否则预设/空数据会覆盖既有行程。成功读取（含重试成功）后才恢复正常保存。
    let readVerified = false;

    const setStatus = (text, tone) => {
      const node = statusNode?.();
      if (!node) return;
      node.textContent = text;
      if (tone && node.dataset) node.dataset.tone = tone;
    };

    const retainDraft = protectedBaseline => {
      setStatus('未保存的本地修改已保留 · 请先导出 JSON，再决定是否放弃并重试', 'warning');
      if (!displayed) { displayed = true; draftBaseline = protectedBaseline; }
      return { dataStatus: 'draft' };
    };
    const beforeRead = draftSignature();
    if (displayed && beforeRead !== draftBaseline && !(await confirmDiscardDraft())) return retainDraft(beforeRead);
    // A modal or network wait may allow more edits. Only this exact draft was approved.
    const approvedDraft = draftSignature();
    if (!displayed) setPlanCatalog({});

    const hydrate = fileData => {
      if (!fileData) return;
      cached = null;
      const normalized = loadFileContainer(fileData);
      setFileRevision(fileData.updatedAt || fileData.savedAt || '');
      const activeKey = state.versionKey;
      if (isShareMode) {
        const active = normalized.versions?.[activeKey];
        if (active) cached = structuredClone(active);
        const stamp = fileData.updatedAt
          ? new Date(fileData.updatedAt).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })
          : '';
        statusNode().textContent = `共享只读版${stamp ? ` · 更新于 ${stamp}` : ''}`;
        return;
      }
      const active = normalized.versions?.[activeKey];
      if (active) cached = structuredClone(active);
      statusNode().textContent = persistence.editable ? '已从本地文件载入' : '移动端只读 · 已从本地文件载入';
    };

    let renderedCache = false;
    if (!displayed && !isShareMode && plannerCache) {
      const snapshot = await plannerCache.read(activeTripId);
      if (snapshot) {
        hydrate(snapshot);
        if (cached) {
          const inferredKey = state.plans.some(plan => plan.id === cached.planKey) ? cached.planKey : state.versionKey;
          load(cached, inferredKey);
          state.schedule.length ? renderSchedule(state.schedule) : renderManualSchedule();
          renderedCache = true;
          hasCacheDisplay = true;
          statusNode().textContent = '已显示本地缓存 · 正在同步云端';
        }
      }
    }

    if (isShareMode) {
      hydrate(shareData);
      readVerified = true;
    } else {
      let usable = false;
      try {
        const response = await api.getPlannerData();
        if (response.trip?._id && response.trip._id !== activeTripId) throw new Error('行程上下文已变化，不能采用其他行程的读取结果');
        const fresh = response.data;
        if (displayed && draftSignature() !== approvedDraft) return retainDraft(approvedDraft);
        // 读取调用成功但拿不到可用快照（例如 data 为空容器）同样不可写，
        // 否则会把预设/空数据当成权威数据保存并覆盖云端。
        usable = usableContainer(fresh);
        if (usable) {
          hydrate(fresh);
          // Trip version is server-owned; data.updatedAt is only client metadata.
          setFileRevision(response.trip?.updated_at || response.revision || api.getRemoteRevision?.() || fresh.updatedAt || fresh.savedAt || '');
          usable = Boolean(cached);
        }
        if (usable) {
          freshData = fresh;
          renderedCache = false;
        }
      } catch {
        usable = false;
      }
      readVerified = usable;
      if (!usable) {
        dataStatus = hasCacheDisplay ? 'offline' : 'preset';
        setStatus(
          hasCacheDisplay ? '读取失败，显示离线缓存 · 恢复后可保存' : '读取失败，显示本地预设 · 恢复后可保存',
          'warning'
        );
      }
    }

    if (readVerified) {
      if (cached && !renderedCache) {
        const inferredKey = state.plans.some(plan => plan.id === cached.planKey) ? cached.planKey : state.versionKey;
        load(cached, inferredKey);
        state.schedule.length ? renderSchedule(state.schedule) : renderManualSchedule();
      } else if (!cached) {
        loadPreset(state.versionKey || defaultPlanId);
      }
    } else {
      // 读取失败：只用于展示（缓存或预设），不进入保存流程，等待安全重试。
      persistence.disableAutoSave?.();
      if (!cached && !displayed) loadPreset(state.versionKey || defaultPlanId);
    }

    // Loading the validated response is synchronous. Never leave a cache-write
    // await between approval and load(), where a new edit could be overwritten.
    if (freshData && plannerCache) {
      try { await plannerCache.write(activeTripId, freshData); }
      catch { setStatus('已读取行程 · 本地缓存写入失败，请保留导出备份', 'warning'); }
    }

    // Map/CDN availability must not delay data readiness or replace a read
    // failure with the bootstrap watchdog's generic timeout.
    if (getPreviewMode() !== 'mobile') void Promise.resolve().then(ensureMapReady).catch(() => {});
    renderRouteTotals();
    persistence.setOnFileSaved?.(result => {
      setFileRevision(result.updatedAt || result.savedAt || getFileRevision());
      plannerCache?.write(activeTripId, fileSavePayload());
    });

    if (readVerified) {
      // 有待同步的本地修改时，不得"先刷新旧队列、再用本次读取的快照保存回去"。
      // 安全重放前提：待同步快照基于当前权威版本；否则提示冲突并保留队列，不覆盖任一方。
      // 采用先重放、后启用自动保存的顺序，重放期间 load() 的内建 save() 不会产生写入。
      const pending = await persistence.readPendingChanges?.();
      const beforeReplay = draftSignature();
      let replayOutcome = 'none';
      if (pending) {
        replayOutcome = (await persistence.replayPendingChanges?.()) || 'failed';
        if (replayOutcome === 'replayed') {
          if (draftSignature() !== beforeReplay) return retainDraft(beforeReplay);
          // 采用已重放的快照作为当前状态，避免随后用刚读取的旧快照覆盖；
          // 权威版本已由 onFileSaved 更新，不再回退到待同步载荷里的旧时间戳。
          const normalizedPending = loadFileContainer(pending);
          const pendingKey = state.plans.some(plan => plan.id === pending.activeVersion) ? pending.activeVersion : state.versionKey;
          const activePending = normalizedPending.versions?.[pendingKey];
          if (activePending) {
            load(structuredClone(activePending), pendingKey);
            state.schedule.length ? renderSchedule(state.schedule) : renderManualSchedule();
          }
          await plannerCache?.write(activeTripId, fileSavePayload());
        }
      }
      if (replayOutcome === 'conflict' || replayOutcome === 'failed') {
        dataStatus = replayOutcome === 'conflict' ? 'pending-conflict' : 'pending-offline';
        // 保留队列且不恢复自动保存：避免后续编辑直接覆盖待同步数据，用户需先处理冲突。
        persistence.disableAutoSave?.();
        setStatus(
          replayOutcome === 'conflict'
            ? '云端版本已更新 · 本地未同步修改已保留，未自动覆盖任一方，请核对后重试'
            : '本地未同步修改尚未上传 · 已保留，请稍后重试',
          replayOutcome === 'conflict' ? 'error' : 'warning'
        );
      } else {
        persistence.enableAutoSave();
        if (replayOutcome === 'replayed') {
          setStatus('未同步的本地修改已同步到云端 · 已保留本地修改', 'success');
        } else {
          persistence.flushOfflineQueue?.();
          // 只读分享沿用会话层的 save 防护（isShareMode 时 save() 自身空操作）。
          save();
        }
      }
    }
    if (!displayed || readVerified) draftBaseline = draftSignature();
    displayed = true;
    return { dataStatus };
  };
}
