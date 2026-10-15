// 账号 UI：登录/注册表单、行程管理与协作者权限面板。
// 移动端复用通用底部弹层，并按认证状态切换紧凑表单或长列表布局。
import { $, escapeHtml } from './core/utils.js';

const CLOSED_HTML = '<span class="hint">正在初始化账号…</span>';

export function bindAccountUI({ account, api, confirmAction }) {
  const btn = $('#accountBtn');
  const dialog = $('#accountDialog');
  if (!btn || !dialog) return;

  const root = $('#accountPanel');
  if (!root) return;

  function currentUser() { return account.getUser(); }

  function render() {
    const authenticated = Boolean(currentUser());
    dialog.classList.toggle('is-account-auth', !authenticated);
    root.innerHTML = authenticated ? renderTrips() : renderAuthForm();
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
        <span class="account-trip-actions">
          ${trip.role === 'owner' ? `<button type="button" class="ghost share-link" data-share-trip="${trip._id}" data-share-enabled="${trip.share_enabled ? '1' : ''}" data-share-code="${escapeHtml(trip.share_code || '')}">${trip.share_enabled ? '分享码 ' + escapeHtml(trip.share_code) : '分享'}</button>` : ''}
          ${trip.role === 'owner' ? `<button type="button" class="ghost" data-members-trip="${trip._id}">协作者</button><button type="button" class="ghost" data-backups-trip="${trip._id}">备份</button>` : ''}
          ${trip._id === account.getActiveTripId()
            ? '<span class="account-trip-active" aria-current="true">当前行程</span>'
            : `<button type="button" class="ghost" data-open-trip="${escapeHtml(trip._id)}" aria-label="打开行程：${escapeHtml(trip.name)}">打开行程</button>`}
        </span>
        <p class="account-trip-notice" data-share-notice="${trip._id}" role="status" aria-live="polite" hidden></p>
        <div class="account-trip-management" data-management="${trip._id}" hidden></div>
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
    root.querySelectorAll('.account-trip-management').forEach(panel => panel.addEventListener('click', event => event.stopPropagation()));
    root.querySelectorAll('[data-open-trip]').forEach(button => {
      button.addEventListener('click', async () => {
        if (button.disabled) return;
        const id = button.dataset.openTrip;
        button.disabled = true;
        try {
          await api.setActiveTrip(id);
          try { localStorage.setItem('roadtrip-active-trip', id); } catch { /* 忽略 */ }
          location.reload();
        } catch (err) {
          button.disabled = false;
          root.insertAdjacentHTML('beforeend', `<p class="account-error">${escapeHtml(err.message)}</p>`);
        }
      });
    });
    // 分享按钮：未开启则生成分享码，已开启则复制
    root.querySelectorAll('[data-share-trip]').forEach(btn => {
      btn.addEventListener('click', async event => {
        event.stopPropagation();
        const tripId = btn.dataset.shareTrip;
        const enabled = btn.dataset.shareEnabled === '1';
        const code = btn.dataset.shareCode;
        const notice = root.querySelector(`[data-share-notice="${tripId}"]`);
        const showShareNotice = (shareCode, created = false) => {
          notice.innerHTML = `<b>分享码 ${escapeHtml(shareCode)}</b><small>${created ? '已开启只读分享并尝试复制。' : '已尝试复制到剪贴板。'}朋友加入后默认只能查看；共同编辑需在“协作者”中授权。</small>`;
          notice.hidden = false;
        };
        if (enabled && code) {
          try { await navigator.clipboard.writeText(code); } catch { /* 忽略 */ }
          showShareNotice(code);
          return;
        }
        try {
          const { trip } = await api.tripShare(tripId, true);
          btn.dataset.shareEnabled = '1';
          btn.dataset.shareCode = trip.share_code;
          btn.textContent = `分享码 ${trip.share_code}`;
          try { await navigator.clipboard.writeText(trip.share_code); } catch { /* 忽略 */ }
          showShareNotice(trip.share_code, true);
        } catch (err) {
          root.insertAdjacentHTML('beforeend', `<p class="account-error">${escapeHtml(err.message)}</p>`);
        }
      });
    });
    root.querySelectorAll('[data-members-trip]').forEach(btn => {
      btn.addEventListener('click', async event => {
        event.stopPropagation();
        const tripId = btn.dataset.membersTrip;
        const panel = root.querySelector(`[data-management="${tripId}"]`);
        panel.hidden = false; panel.innerHTML = '<small>正在读取协作者…</small>';
        try {
          const { members } = await api.tripMembers(tripId);
          const collaborators = members.filter(member => member.role !== 'owner');
          panel.innerHTML = `<b>协作者与权限</b>${collaborators.length ? collaborators.map(member => `<div class="account-member" data-member="${member.user_id}"><span>${escapeHtml(member.nickname || member.username || '协作者')}<small>${escapeHtml(member.username || '')}</small></span><select aria-label="协作者权限"><option value="editor" ${member.role === 'editor' ? 'selected' : ''}>可编辑</option><option value="viewer" ${member.role === 'viewer' ? 'selected' : ''}>只读</option></select><button type="button" class="ghost danger">移除</button></div>`).join('') : '<p class="hint">尚无协作者。对方通过分享码加入后会显示在这里。</p>'}`;
          panel.querySelectorAll('.account-member').forEach(row => {
            row.querySelector('select').addEventListener('change', async change => {
              await api.updateTripMember(tripId, { user_id: row.dataset.member, role: change.target.value });
              window.showSaveToast?.('协作者权限已更新');
            });
            row.querySelector('button').addEventListener('click', async () => {
              const collaboratorName = row.querySelector('span')?.firstChild?.textContent?.trim() || '这位协作者';
              const confirmed = await confirmAction({
                title: '移除协作者',
                message: `确定移除“${collaboratorName}”吗？`,
                detail: '该成员将无法继续查看或编辑此行程，之后仍可通过分享码重新加入。',
                confirmLabel: '移除协作者'
              });
              if (!confirmed) return;
              await api.removeTripMember(tripId, row.dataset.member); row.remove();
            });
          });
        } catch (err) { panel.innerHTML = `<p class="account-error">${escapeHtml(err.message)}</p>`; }
      });
    });
    root.querySelectorAll('[data-backups-trip]').forEach(btn => {
      btn.addEventListener('click', async event => {
        event.stopPropagation();
        const tripId = btn.dataset.backupsTrip;
        const panel = root.querySelector(`[data-management="${tripId}"]`);
        panel.hidden = false; panel.innerHTML = '<small>正在读取备份…</small>';
        try {
          const { backups } = await api.listTripBackups(tripId);
          panel.innerHTML = `<b>最近三次完整旅行备份</b>${backups.length ? backups.map(backup => `<div class="account-backup"><span>${escapeHtml(new Date(backup.created_at).toLocaleString('zh-CN'))}<small>${escapeHtml(backup.plan_name || '整个行程')}${backup.assets && backup.assets.images_fully_embedded === false ? ' · 含网络图片链接' : ''}</small></span><button type="button" class="ghost" data-restore="${backup._id}">恢复</button></div>`).join('') : '<p class="hint">暂无备份。点击行程方案页的“立即保存整个行程”后生成。</p>'}`;
          panel.querySelectorAll('[data-restore]').forEach(restore => restore.addEventListener('click', async () => {
            const backup = restore.closest('.account-backup');
            const backupTime = backup?.querySelector('span')?.firstChild?.textContent?.trim() || '所选备份';
            const confirmed = await confirmAction({
              title: '恢复完整旅行备份',
              message: `确定用 ${backupTime} 的完整备份覆盖当前行程吗？`,
              detail: '会覆盖全部方案、事件、费用、地点与路线。恢复本人备份还会替换账号通用地点库，影响其他行程使用该库。恢复前自动保留“恢复前快照”；网络图片链接不保证离线可用。',
              confirmLabel: '恢复并覆盖'
            });
            if (!confirmed) return;
            const submitRestore = async allowMissingLinks => {
              try { await api.restoreTripBackup(tripId, restore.dataset.restore, { allowMissingLinks }); return null; }
              catch (err) { return err; }
            };
            let error = await submitRestore(false);
            if (!error) {
              try { localStorage.setItem('roadtrip-active-trip', tripId); } catch { /* 忽略 */ }
              location.reload();
              return;
            }
            if (error.code === 'BACKUP_LINK_MISSING') {
              const forced = await confirmAction({
                title: '备份存在关联缺失',
                message: '该备份中有事件引用的地点或路线在备份里缺失。仍要恢复吗？',
                detail: `${error.message}\n缺失的关联会保持为空，恢复后需要手动补全。`,
                confirmLabel: '仍然恢复'
              });
              if (forced) {
                error = await submitRestore(true);
                if (!error) {
                  try { localStorage.setItem('roadtrip-active-trip', tripId); } catch { /* 忽略 */ }
                  location.reload();
                  return;
                }
              } else return;
            }
            root.insertAdjacentHTML('beforeend', `<p class="account-error">${escapeHtml(error.message || '恢复失败')}</p>`);
          }));
        } catch (err) { panel.innerHTML = `<p class="account-error">${escapeHtml(err.message)}</p>`; }
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
