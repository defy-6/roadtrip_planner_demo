import { runtime } from './shared/runtime.js';
import { createApi } from './services/api.js?v=incremental-v22-20260927';
import { createPersistence } from './storage/persistence.js?v=incremental-v22-20260927';
import { createPlannerMigrations, migratePlannerData } from './storage/migrations.js';
import { createAccount } from './services/account.js';
import { bindAccountUI } from './account-ui.js';
import { startRuntime } from './features/runtime.js';
import { createMobileNavigation } from './features/mobile/navigation.js';
import { createMobileShell } from './features/mobile/shell.js';

// token 失效（登录过期等）：清登录态，回到本地模式。
function handleUnauthorized() {
  try {
    localStorage.removeItem('roadtrip-token');
    localStorage.removeItem('roadtrip-active-trip');
  } catch { /* 忽略 */ }
  // eslint-disable-next-line no-alert
  window.alert('登录已过期，请重新登录');
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
  await new Promise(resolve => {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet'; stylesheet.href = './mobile.css?v=isolated-mobile-20260901';
    stylesheet.onload = resolve; stylesheet.onerror = resolve;
    document.head.append(stylesheet);
  });
} else {
  await new Promise(resolve => {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet'; stylesheet.href = './desktop.css?v=isolated-desktop-20260901';
    stylesheet.onload = resolve; stylesheet.onerror = resolve;
    document.head.append(stylesheet);
  });
}
// 手机版式只读只针对本地手机预览（localhost:3001）与分享版；
// 云端正式部署（isCloud）即使在手机版式下也必须可编辑保存，
// 否则登录后所有自动/手动保存都会静默失效（编辑不落盘、刷新即恢复）。
const localRuntime = { ...runtime, editable: runtime.editable && (preview.mode !== 'mobile' || isCloud) };
// 版式由本地服务端端口决定：3000 为桌面工作台，3001 为手机预览，
// 不再仅根据浏览器窗口宽度猜测，避免桌面浏览器误落入移动排版。
document.documentElement.dataset.previewMode = preview.mode;
document.body.dataset.previewMode = preview.mode;
// 保存状态浮层（手机端顶栏隐藏时也能看到保存反馈）
let saveToastTimer = null;
function showSaveToast(text) {
  let toast = document.querySelector('#saveToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'saveToast';
    toast.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:3000;background:rgba(7,91,67,.92);color:#fff;padding:9px 18px;border-radius:999px;font:13px/1.5 system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.18);max-width:88vw;text-align:center;';
    document.body.append(toast);
  }
  toast.textContent = text;
  clearTimeout(saveToastTimer);
  saveToastTimer = setTimeout(() => { toast.textContent = ''; }, 2600);
}
window.showSaveToast = showSaveToast;
const persistence = createPersistence({ runtime: localRuntime, api, onSaveStatus: text => { const node = document.querySelector('#fileSaveStatus'); if (node) node.textContent = text; showSaveToast(text); } });

// 账号会话：仅本地/可编辑版启用；只读分享版（GitHub Pages）无后端，跳过。
const account = runtime.shareMode ? null : createAccount({ api, storage: localStorage });
let loggedIn = false;
if (account) {
  const user = await account.restore();
  loggedIn = Boolean(user);
  api.setActiveTrip(account.getActiveTripId());
  bindAccountUI({ account, api });
} else {
  document.querySelector('#accountBtn')?.remove();
}

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
}

if (!(isCloud && !loggedIn)) {
  startRuntime({
    runtime: localRuntime,
    api,
    persistence,
    migrate: (data, typeForTitle) => migratePlannerData(data, createPlannerMigrations({ typeForTitle, createId: () => crypto.randomUUID(), readFlag: persistence.readFlag, writeFlag: persistence.writeFlag, pendingAddressMigrationKey: 'roadtrip-pending-addresses-v1' }))
  });
}

const mobileNavigation = createMobileNavigation({ previewMode: preview.mode });
createMobileShell({ previewMode: preview.mode }).initialize();
mobileNavigation.initialize();
window.addEventListener('pagehide', () => mobileNavigation.destroy(), { once: true });
