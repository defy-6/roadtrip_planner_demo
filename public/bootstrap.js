import { runtime } from './shared/runtime.js';
import { createApi } from './services/api.js?v=fix-time-locations-20260820-1';
import { createPersistence } from './storage/persistence.js?v=serialized-save-20260824-1';
import { createPlannerCache } from './storage/planner-cache.js';
import { createPlannerMigrations, migratePlannerData } from './storage/migrations.js';
import { createAccount } from './services/account.js';
import { bindAccountUI } from './account-ui.js';
import { createConfirmationDialog } from './features/dialogs/confirmation.js';
import { startRuntime } from './features/runtime.js?v=map-photo-connectors-20260825-1';
import { createMobileNavigation } from './features/mobile/navigation.js';
import { createMobileShell } from './features/mobile/shell.js';

// token 失效（登录过期等）：清登录态，回到本地模式。
let unauthorizedReloading = false;
function handleUnauthorized() {
  if (unauthorizedReloading) return;
  unauthorizedReloading = true;
  try {
    localStorage.removeItem('roadtrip-token');
    localStorage.removeItem('roadtrip-active-trip');
    sessionStorage.setItem('roadtrip-session-notice', '登录已过期，请重新登录。');
  } catch { /* 忽略 */ }
  window.location.reload();
}

const localHostnames = new Set(['localhost', '127.0.0.1', '::1']);
const defaultCloudApiBase = 'https://cloud1-d0giwgf98368c9398-1468220648.ap-shanghai.app.tcloudbase.com';
const configuredApiBase = (() => {
  const cloudPreview = new URLSearchParams(window.location.search).get('cloud') === '1';
  if (runtime.shareMode || (localHostnames.has(window.location.hostname) && !cloudPreview)) return '';
  try { return window.__API_BASE__ || defaultCloudApiBase; } catch { return defaultCloudApiBase; }
})();
const api = createApi({
  storage: localStorage,
  onUnauthorized: handleUnauthorized,
  // localhost 保持同源联调；正式 Web 默认连接腾讯云开发，仍允许部署时覆盖。
  apiBase: configuredApiBase,
});
const isCloud = Boolean(configuredApiBase) && !localHostnames.has(window.location.hostname);
// 手机/桌面版式：URL ?preview=mobile|desktop 优先（静态托管无端口区分）；否则按原逻辑
const urlPreview = new URLSearchParams(window.location.search).get('preview');
const preview = urlPreview === 'mobile' || urlPreview === 'desktop'
  ? { mode: urlPreview }
  : (runtime.shareMode || isCloud
    ? { mode: 'mobile' }
    : await api.getPreviewMode().catch(() => ({ mode: 'desktop' })));
if (preview.mode === 'mobile') {
  const viewport = document.querySelector('meta[name="viewport"]');
  viewport?.setAttribute('content', 'width=device-width,initial-scale=1,viewport-fit=cover');
  if (urlPreview === 'mobile') {
    const previewDevice = new URLSearchParams(window.location.search).get('device');
    if (previewDevice !== 'auto') document.documentElement.dataset.previewDevice = previewDevice || 'iphone15-pro-web';
  }
}
// index.html 已在解析首屏时按版式注入样式；这里只保留独立入口缺失样式时的非阻塞兜底。
if (preview.mode === 'mobile') {
  if (!document.querySelector('link[href*="mobile.css"]')) {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet'; stylesheet.href = './mobile.css?v=map-photo-connectors-20260825-1';
    document.head.append(stylesheet);
  }
  if (!document.querySelector('link[href*="mobile-layout.css"]')) {
    const layoutStylesheet = document.createElement('link');
    layoutStylesheet.rel = 'stylesheet'; layoutStylesheet.href = './mobile-layout.css?v=map-photo-connectors-20260825-1';
    document.head.append(layoutStylesheet);
  }
} else if (!document.querySelector('link[href*="desktop.css"]')) {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet'; stylesheet.href = './desktop.css?v=isolated-desktop-20260901';
  document.head.append(stylesheet);
}
// 手机版式只读只针对本地手机预览（localhost:3001）与分享版；
// 云端正式部署（isCloud）即使在手机版式下也必须可编辑保存，
// 否则登录后所有自动/手动保存都会静默失效（编辑不落盘、刷新即恢复）。
const localRuntime = { ...runtime, editable: runtime.editable && (preview.mode !== 'mobile' || isCloud) };
// 版式由本地服务端端口决定：3000 为桌面工作台，3001 为手机预览，
// 不再仅根据浏览器窗口宽度猜测，避免桌面浏览器误落入移动排版。
document.documentElement.dataset.previewMode = preview.mode;
document.body.dataset.previewMode = preview.mode;
const saveStatus = document.querySelector('#fileSaveStatus');
if (saveStatus) {
  saveStatus.setAttribute('role', 'status');
  saveStatus.setAttribute('aria-live', 'polite');
  saveStatus.setAttribute('aria-atomic', 'true');
}
// 初始化读取失败时的安全重试入口：成功读取前不会进入保存流程。
// 仅在读取失败状态可见；重试成功（planner:ready 转为 ready）后自动收起。
const retryLoadButton = document.createElement('button');
retryLoadButton.type = 'button';
retryLoadButton.id = 'retryLoadBtn';
retryLoadButton.className = 'ghost';
retryLoadButton.hidden = true;
retryLoadButton.textContent = '重试读取';
retryLoadButton.title = '重新读取行程数据';
if (saveStatus) saveStatus.insertAdjacentElement('afterend', retryLoadButton);
const pendingButtons = ['export', 'discard'].map(action => {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'ghost'; button.hidden = true;
  button.id = `pending${action}Btn`;
  button.textContent = action === 'export' ? '导出待同步备份' : '放弃队列并读取云端';
  button.addEventListener('click', () => window.dispatchEvent(new CustomEvent(`planner:pending${action}`)));
  retryLoadButton.insertAdjacentElement('afterend', button);
  return button;
});
const READ_FAILURE_STATUSES = new Set(['offline', 'preset', 'error', 'draft', 'pending-conflict', 'pending-offline']);
retryLoadButton.addEventListener('click', () => {
  retryLoadButton.disabled = true;
  retryLoadButton.textContent = '正在重试…';
  window.dispatchEvent(new CustomEvent('planner:retry'));
});
const updateReadActions = event => {
  retryLoadButton.hidden = !READ_FAILURE_STATUSES.has(event.detail?.dataStatus);
  retryLoadButton.disabled = false;
  retryLoadButton.textContent = '重试读取';
  pendingButtons.forEach(button => { button.hidden = !String(event.detail?.dataStatus).startsWith('pending-'); });
};
window.addEventListener('planner:ready', updateReadActions);
window.addEventListener('planner:saveblocked', updateReadActions);
const routeError = document.querySelector('#routeError');
if (routeError) {
  routeError.setAttribute('role', 'alert');
  routeError.setAttribute('aria-live', 'assertive');
  routeError.setAttribute('aria-atomic', 'true');
  routeError.hidden = !routeError.textContent.trim();
}
const routeDetail = document.querySelector('#routeDetail');
if (routeDetail) {
  routeDetail.setAttribute('role', 'status');
  routeDetail.setAttribute('aria-live', 'polite');
  routeDetail.setAttribute('aria-atomic', 'true');
}
let bootFallbackTimer = null;
function revealPlanner({ timedOut = false } = {}) {
  if (bootFallbackTimer) clearTimeout(bootFallbackTimer);
  document.documentElement.classList.add('planner-ready');
  document.body.classList.remove('mobile-planner-loading', 'planner-booting');
  document.querySelector('#plannerBootScreen')?.remove();
  if (timedOut) {
    const status = document.querySelector('#fileSaveStatus');
    if (status) status.textContent = '初始化超时，正在尝试恢复';
  }
}
window.addEventListener('planner:ready', () => revealPlanner(), { once: true });
// 登录恢复、IndexedDB 或云端请求即使被 Safari 挂起，也不能永久遮住页面。
bootFallbackTimer = setTimeout(() => revealPlanner({ timedOut: true }), 12_000);
if (preview.mode === 'mobile') {
  const schedule = document.querySelector('#schedule');
  if (schedule && !schedule.children.length) schedule.innerHTML = '<div class="mobile-schedule-skeleton" aria-label="正在加载当前行程方案"><span></span><span></span><span></span></div>';
  document.body.classList.add('mobile-planner-loading');
}
// 用户界面统一使用“行程方案”；底层字段名继续保留 plan 以兼容既有数据和接口。
const planSelect = document.querySelector('#planSelect');
planSelect?.setAttribute('aria-label', '行程方案');
const planButtonLabels = [
  ['#newPlanBtn', '新建行程方案'], ['#copyPlanBtn', '复制当前行程方案'], ['#deletePlanBtn', '删除当前行程方案'],
];
planButtonLabels.forEach(([selector, label]) => { const button = document.querySelector(selector); if (button) button.title = label; });
const plansTab = document.querySelector('.mobile-tabbar [data-mobile-view="plans"]');
if (plansTab?.lastChild) plansTab.lastChild.textContent = '行程方案';
const placeLibraryButton = document.querySelector('#placeLibraryBtn');
if (placeLibraryButton) { placeLibraryButton.title = '打开我的地点库'; if (placeLibraryButton.lastChild) placeLibraryButton.lastChild.textContent = '我的地点库'; }
// 保存状态浮层（手机端顶栏隐藏时也能看到保存反馈）
let saveToastTimer = null;
function showSaveToast(text, tone = 'success') {
  let toast = document.querySelector('#saveToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'saveToast';
    toast.className = 'save-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.setAttribute('aria-atomic', 'true');
    document.body.append(toast);
  }
  toast.hidden = false;
  toast.textContent = text;
  toast.dataset.tone = tone;
  clearTimeout(saveToastTimer);
  saveToastTimer = setTimeout(() => { toast.textContent = ''; toast.hidden = true; delete toast.dataset.tone; }, tone === 'error' ? 5200 : 3000);
}
window.showSaveToast = showSaveToast;
try {
  const sessionNotice = sessionStorage.getItem('roadtrip-session-notice');
  if (sessionNotice) {
    sessionStorage.removeItem('roadtrip-session-notice');
    setTimeout(() => showSaveToast(sessionNotice, 'warning'), 700);
  }
} catch { /* sessionStorage 不可用时仍可正常启动 */ }
const persistence = createPersistence({ runtime: localRuntime, api, onSaveStatus: (text, tone = 'success') => {
  const node = document.querySelector('#fileSaveStatus');
  if (node) { node.textContent = text; node.dataset.tone = tone; }
  showSaveToast(text, tone);
}, onSaveBlocked: dataStatus => window.dispatchEvent(new CustomEvent('planner:saveblocked', { detail: { dataStatus } })) });
const { confirmAction } = createConfirmationDialog();

// 账号会话：仅本地/可编辑版启用；只读分享版（GitHub Pages）无后端，跳过。
const account = runtime.shareMode ? null : createAccount({ api, storage: localStorage });
let loggedIn = false;
let cloudTripReady = true;
let restoredUser = null;
if (account) {
  const user = await account.restore();
  restoredUser = user;
  loggedIn = Boolean(user);
  api.setActiveTrip(account.getActiveTripId());
  cloudTripReady = !isCloud || !loggedIn || Boolean(account.getActiveTripId());
  bindAccountUI({ account, api, confirmAction });
} else {
  document.querySelector('#accountBtn')?.remove();
}

const plannerCache = createPlannerCache({ scope: restoredUser?.id || restoredUser?.username || (loggedIn ? 'account' : 'local') });
api.setActorScope?.(plannerCache.scope);
persistence.setOfflineQueue?.(plannerCache, account?.getActiveTripId?.() || 'local');

// 云端模式必须登录：未登录时引导登录，避免请求本地文件接口（云函数无 /api/planner-data）
if (isCloud && !loggedIn) {
  document.querySelector('#cloudLoginHint')?.remove();
  const hint = document.createElement('div');
  hint.id = 'cloudLoginHint';
  hint.style.cssText = 'position:fixed;inset:0;z-index:2000;display:grid;place-items:center;background:#fbfaf6;color:#5a6472;font:14px/1.8 system-ui,sans-serif;cursor:pointer;';
  hint.innerHTML = '<div style="text-align:center"><b style="font-size:18px;color:#075b43">行远途记 · 云端版</b><br><span style="font-size:16px;color:#2f73a9">点击任意位置登录</span><br><small style="color:#8892a0">登录后与小程序/微信数据互通</small></div>';
  // 点击遮罩即打开账号登录面板（右上角按钮被遮罩盖住，这里直接触发）
  hint.addEventListener('click', () => document.querySelector('#accountBtn')?.click());
  document.body.append(hint);
  document.documentElement.classList.add('planner-ready');
  document.body.classList.remove('planner-booting');
  document.querySelector('#plannerBootScreen')?.remove();
}

if (!(isCloud && !loggedIn) && cloudTripReady) {
  startRuntime({
    runtime: localRuntime,
    api,
    persistence,
    plannerCache,
    confirmAction,
    activeTripId: account?.getActiveTripId?.() || 'local',
    migrate: (data, typeForTitle) => migratePlannerData(data, createPlannerMigrations({ typeForTitle, createId: () => crypto.randomUUID(), readFlag: persistence.readFlag, writeFlag: persistence.writeFlag, pendingAddressMigrationKey: 'roadtrip-pending-addresses-v1' }))
  });
}

if (isCloud && loggedIn && !cloudTripReady) {
  const hint = document.createElement('div');
  hint.style.cssText = 'position:fixed;inset:0;z-index:2100;display:grid;place-items:center;padding:24px;background:#fbfaf6;color:#5a6472;font:14px/1.8 system-ui,sans-serif;text-align:center;';
  hint.innerHTML = '<div><b style="font-size:18px;color:#075b43">云端行程尚未创建成功</b><br>当前不会载入本地预设，以免产生无法保存的修改。<br><button type="button" style="margin-top:14px">打开账号并重试</button></div>';
  hint.querySelector('button').onclick = () => { hint.remove(); document.querySelector('#accountBtn')?.click(); };
  document.body.append(hint);
  document.documentElement.classList.add('planner-ready');
}

const mobileNavigation = createMobileNavigation({ previewMode: preview.mode });
createMobileShell({ previewMode: preview.mode }).initialize();
mobileNavigation.initialize();
window.addEventListener('pagehide', () => mobileNavigation.destroy(), { once: true });
