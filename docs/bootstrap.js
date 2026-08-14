import { runtime } from './shared/runtime.js';
import { createApi } from './services/api.js';
import { createPersistence } from './storage/persistence.js';
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

const api = createApi({
  storage: localStorage,
  onUnauthorized: handleUnauthorized,
  // 云端部署时注入 window.__API_BASE__ 指向云函数公用域名；默认空 = 同源（本地 server.js）
  apiBase: (() => { try { return window.__API_BASE__ || ''; } catch { return ''; } })(),
});
const preview = runtime.shareMode
  ? { mode: 'mobile' }
  : await api.getPreviewMode().catch(() => ({ mode: 'desktop' }));
if (preview.mode === 'mobile') {
  await new Promise(resolve => {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet'; stylesheet.href = './mobile.css?v=isolated-mobile-20260815';
    stylesheet.onload = resolve; stylesheet.onerror = resolve;
    document.head.append(stylesheet);
  });
} else {
  await new Promise(resolve => {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet'; stylesheet.href = './desktop.css?v=isolated-desktop-20260815';
    stylesheet.onload = resolve; stylesheet.onerror = resolve;
    document.head.append(stylesheet);
  });
}
const localRuntime = { ...runtime, editable: runtime.editable && preview.mode !== 'mobile' };
// 版式由本地服务端端口决定：3000 为桌面工作台，3001 为手机预览，
// 不再仅根据浏览器窗口宽度猜测，避免桌面浏览器误落入移动排版。
document.documentElement.dataset.previewMode = preview.mode;
document.body.dataset.previewMode = preview.mode;
const persistence = createPersistence({ runtime: localRuntime, api, onSaveStatus: text => { const node = document.querySelector('#fileSaveStatus'); if (node) node.textContent = text; } });

// 账号会话：仅本地/可编辑版启用；只读分享版（GitHub Pages）无后端，跳过。
const account = runtime.shareMode ? null : createAccount({ api, storage: localStorage });
if (account) {
  await account.restore();
  api.setActiveTrip(account.getActiveTripId());
  bindAccountUI({ account, api });
} else {
  document.querySelector('#accountBtn')?.remove();
}

startRuntime({
  runtime: localRuntime,
  api,
  persistence,
  migrate: (data, typeForTitle) => migratePlannerData(data, createPlannerMigrations({ typeForTitle, createId: () => crypto.randomUUID(), readFlag: persistence.readFlag, writeFlag: persistence.writeFlag, pendingAddressMigrationKey: 'roadtrip-pending-addresses-v1' }))
});

const mobileNavigation = createMobileNavigation({ previewMode: preview.mode });
createMobileShell({ previewMode: preview.mode }).initialize();
mobileNavigation.initialize();
window.addEventListener('pagehide', () => mobileNavigation.destroy(), { once: true });
