export function startRuntimeLifecycle({
  createInitializer,
  initMap,
  getMap,
  showDayOverview,
  fitOverview,
  bindMobileEvents,
  mobileEventOptions,
  cleanupControllers = [],
  statusNode,
  showToast,
  eventTarget = window,
  setTimer = setTimeout,
  logger = console
}) {
  let mapReadyPromise = null;

  function ensureMapReady() {
    if (getMap()) return Promise.resolve(true);
    mapReadyPromise ||= (async () => {
      if (!(await initMap())) return false;
      await showDayOverview('');
      setTimer(() => {
        getMap()?.invalidateSize({ animate: false, pan: false });
        fitOverview();
      }, 240);
      return true;
    })();
    return mapReadyPromise;
  }

  const initializePlanner = createInitializer(ensureMapReady);
  let readyDetail = { dataStatus: 'ready' };
  let activeRun = null;

  // 一次初始化运行：无论成功或失败都会派发 planner:ready；
  // 读取失败时初始化器自身不会进入保存流程，重试成功后才恢复正常保存。
  function runInitialization() {
    if (activeRun) return activeRun;
    // 同步启动初始化，保持首屏读取先于地图按需初始化的既有顺序；
    // 非 async 初始化器若同步抛错也按失败处理。
    let run;
    try { run = Promise.resolve(initializePlanner()); }
    catch (error) { run = Promise.reject(error); }
    activeRun = run
      .then(result => { readyDetail = result || readyDetail; return result; })
      .catch(error => {
        readyDetail = { dataStatus: 'error' };
        logger.error('Planner initialization failed', error);
        const status = statusNode?.();
        if (status) status.textContent = '初始化未完成，请刷新或重新登录';
        showToast?.('初始化遇到问题，已进入可操作界面');
      })
      .finally(() => {
        activeRun = null;
        eventTarget.dispatchEvent(new CustomEvent('planner:ready', { detail: readyDetail }));
      });
    return activeRun;
  }

  const plannerReady = runInitialization();
  // 安全重试：同一时刻只运行一次，成功后会再次派发 planner:ready 供界面刷新。
  const retryInitialization = () => runInitialization();
  eventTarget.addEventListener('planner:retry', retryInitialization);

  const mobileEvents = bindMobileEvents({
    ...mobileEventOptions,
    plannerReady,
    ensureMapReady
  });
  const onPageHide = () => {
    mobileEvents.destroy();
    cleanupControllers.forEach(controller => controller?.destroy?.());
  };
  eventTarget.addEventListener('pagehide', onPageHide);

  return {
    ensureMapReady,
    plannerReady,
    retry: retryInitialization,
    destroy() {
      eventTarget.removeEventListener('planner:retry', retryInitialization);
      eventTarget.removeEventListener('pagehide', onPageHide);
      onPageHide();
    }
  };
}
