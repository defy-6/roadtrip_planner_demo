// 账号 UI（朴素占位版）：登录/注册表单 + 行程管理面板。
// 仅负责交互装配与流程，视觉等设计稿落地后整体替换。
import { $, escapeHtml } from '../core/utils.js';

const CLOSED_HTML = '<span class="hint">正在初始化账号…</span>';

export function bindAccountUI({ account, api }) {
  const btn = $('#accountBtn');
  const dialog = $('#accountDialog');
  if (!btn || !dialog) return;

  const root = $('#accountPanel');
  if (!root) return;

  function currentUser() { return account.getUser(); }

  function render() {
    root.innerHTML = currentUser() ? renderTrips() : renderAuthForm();
  }

  // ---------- 登录 / 注册 ----------
  function renderAuthForm(mode = 'login', error = '') {
    return `
      <div class="account-auth">
        <h3>${mode === 'login' ? '登录' : '注册'}</h3>
        ${error ? `<p class="account-error">${escapeHtml(error)}</p>` : ''}
        ${mode === 'register' ? '<label>昵称<input id="accNickname" placeholder="选填"></label>' : ''}
        <label>用户名<input id="accUsername" value="${escapeHtml(localStorage.getItem('roadtrip-username') || '')}" placeholder="2-20 位字母/数字/中文"></label>
        <label>密码<input id="accPassword" type="password" placeholder="至少 6 位"></label>
        <div class="account-actions">
          <button type="button" class="primary" id="accSubmit">${mode === 'login' ? '登录' : '注册并登录'}</button>
          <button type="button" class="ghost" id="accToggle">${mode === 'login' ? '没有账号？注册' : '已有账号？登录'}</button>
          <button type="button" class="ghost" id="accSkip">暂不登录，本地模式</button>
        </div>
      </div>`;
  }

  // ---------- 行程管理 ----------
  function renderTrips() {
    const user = currentUser();
    const { mine, shared } = account.getTrips();
    const row = trip => `
      <li class="account-trip" data-trip-id="${trip._id}">
        <div><b>${escapeHtml(trip.name)}</b><small>${trip.role === 'owner' ? '创建者' : '协作者'} · 更新于 ${escapeHtml((trip.updated_at || '').slice(0, 10))}</small></div>
        <span class="account-trip-active">${trip._id === account.getActiveTripId() ? '编辑中' : '打开'}</span>
      </li>`;
    return `
      <div class="account-trips">
        <div class="account-userline"><b>${escapeHtml(user.nickname || user.username)}</b><button type="button" class="ghost" id="accLogout">退出登录</button></div>
        <h4>我的行程</h4>
        ${mine.length ? `<ul>${mine.map(row).join('')}</ul>` : '<p class="hint">还没有行程，新建一个吧</p>'}
        <h4>我协作的行程</h4>
        ${shared.length ? `<ul>${shared.map(row).join('')}</ul>` : '<p class="hint">暂无；输入分享码加入朋友的行程</p>'}
        <details class="account-create">
          <summary>＋ 新建行程</summary>
          <label>名称<input id="accNewTripName" placeholder="例如：川西环线"></label>
          <button type="button" class="primary" id="accCreateTrip">创建</button>
        </details>
        <details class="account-create">
          <summary>⌁ 加入协作（分享码）</summary>
          <label>分享码<input id="accJoinCode" placeholder="8 位字母数字，例如 AB2C3D4E"></label>
          <button type="button" class="primary" id="accJoinTrip">加入</button>
        </details>
        <p class="hint">提示：新建行程时可用“导入本地数据”把当前本地行程搬上云端。</p>
        <button type="button" class="ghost" id="accImportLocal">导入本地行程到云端</button>
      </div>`;
  }

  async function submitAuth(mode) {
    const username = $('#accUsername')?.value.trim();
    const password = $('#accPassword')?.value;
    const nickname = $('#accNickname')?.value.trim();
    try {
      if (mode === 'register') await account.register(username, password, nickname);
      else await account.login(username, password);
      try { localStorage.setItem('roadtrip-username', username); } catch { /* 忽略 */ }
      render();
      location.reload(); // 重新初始化编辑器，切换到云端行程数据
    } catch (err) {
      root.innerHTML = renderAuthForm(mode, err.message);
      wireAuthForm(mode);
    }
  }

  function wireAuthForm(mode) {
    $('#accSubmit')?.addEventListener('click', () => submitAuth(mode));
    $('#accToggle')?.addEventListener('click', () => {
      root.innerHTML = renderAuthForm(mode === 'login' ? 'register' : 'login');
      wireAuthForm(mode === 'login' ? 'register' : 'login');
    });
    $('#accSkip')?.addEventListener('click', () => dialog.close());
  }

  function wireTrips() {
    root.querySelectorAll('.account-trip').forEach(li => {
      li.addEventListener('click', async () => {
        const id = li.dataset.tripId;
        try {
          await api.setActiveTrip(id);
          try { localStorage.setItem('roadtrip-active-trip', id); } catch { /* 忽略 */ }
          location.reload();
        } catch (err) {
          root.insertAdjacentHTML('beforeend', `<p class="account-error">${escapeHtml(err.message)}</p>`);
        }
      });
    });
    $('#accLogout')?.addEventListener('click', async () => {
      await account.logout();
      location.reload();
    });
    $('#accCreateTrip')?.addEventListener('click', async () => {
      const name = $('#accNewTripName')?.value.trim();
      if (!name) return;
      await account.createTrip(name);
      location.reload();
    });
    $('#accJoinTrip')?.addEventListener('click', async () => {
      const code = $('#accJoinCode')?.value.trim();
      if (!code) return;
      try {
        await account.joinTrip(code);
        location.reload();
      } catch (err) {
        root.insertAdjacentHTML('beforeend', `<p class="account-error">${escapeHtml(err.message)}</p>`);
      }
    });
    $('#accImportLocal')?.addEventListener('click', async () => {
      const local = await api.getPlannerData();
      const data = local.data || {};
      const name = data.name || '我的行程';
      await account.createTrip(name, data);
      location.reload();
    });
  }

  function open() {
    render();
    if (currentUser()) wireTrips();
    else wireAuthForm('login');
    dialog.showModal();
  }

  btn.addEventListener('click', open);
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  // 移动端计划面板的账号入口：通过 account:open 事件打开同一面板
  window.addEventListener('account:open', open);

  root.innerHTML = CLOSED_HTML;
  render();
  if (currentUser()) wireTrips();
  else wireAuthForm('login');
}

// 底部 tabbar 高亮跟随滚动 + 导航滚动（仅 mobile 预览下可见，逻辑无害于桌面）
// 注意：#placesSection 在 CSS 中为 display:none（桌面隐藏节点），移动端地点面板是
// 运行时插入的 .locations-panel，导航与高亮都以它为基准。
function wireTabbarHighlight() {
  if (document.documentElement.dataset.previewMode === 'mobile') return;
  const tabs = Array.from(document.querySelectorAll('.mobile-tabbar a'));
  if (!tabs.length) return;
  const targets = [
    { el: () => document.getElementById('scheduleSection'), tab: 0 },
    { el: () => document.getElementById('mapSection'), tab: 1 },
    { el: () => document.querySelector('.locations-panel'), tab: 2 },
  ];
  const update = () => {
    // 高亮「最后一个顶部进入视口上半屏(40%)的区域」，用视口坐标判定，
    // 与 scrollIntoView 的实际对齐行为一致（不依赖 scrollY 偏移量）
    const cutoff = window.innerHeight * 0.4;
    let active = 0;
    targets.forEach(t => {
      const el = t.el();
      if (el && el.getBoundingClientRect().top <= cutoff) active = t.tab;
    });
    tabs.forEach((tab, i) => tab.classList.toggle('active', i === active));
  };
  // 前三个 tab 负责滚动到对应区域（locations-panel 无锚点 id，统一用 JS 滚动）
  targets.forEach(t => {
    const tab = tabs[t.tab];
    if (!tab) return;
    tab.addEventListener('click', event => {
      const el = t.el();
      if (el) {
        event.preventDefault();
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
}
