// 账号接口：register / login / wx-login / me。
// 统一返回 { statusCode, data }，由入口层序列化。
'use strict';

const USERNAME_RE = /^[a-zA-Z0-9_\u4e00-\u9fa5]{2,20}$/;

function publicUser(user) {
  return {
    _id: user._id,
    username: user.username || null,
    nickname: user.nickname || '行远用户',
    created_at: user.created_at,
  };
}

function createAuthRoutes({ store, security, getOpenId }) {
  async function issueSession(userId, provider = 'password') {
    const token = security.generateToken();
    const session = await store.insert('sessions', {
      token,
      user_id: userId,
      provider,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + security.sessionTtlMs()).toISOString(),
    });
    return session.token;
  }

  async function register({ username, password, nickname }) {
    username = String(username || '').trim();
    password = String(password || '');
    if (!USERNAME_RE.test(username)) {
      return { statusCode: 400, data: { ok: false, error: '用户名需为 2-20 位字母、数字、下划线或中文' } };
    }
    if (password.length < 6) {
      return { statusCode: 400, data: { ok: false, error: '密码至少 6 位' } };
    }
    const existing = await store.findOne('users', { username });
    if (existing) {
      return { statusCode: 409, data: { ok: false, error: '用户名已被注册' } };
    }
    const user = await store.insert('users', {
      username,
      openid: null,
      nickname: (nickname || '').trim() || username,
      password_hash: security.hashPassword(password),
      created_at: new Date().toISOString(),
    });
    const token = await issueSession(user._id);
    return { statusCode: 200, data: { ok: true, token, user: publicUser(user) } };
  }

  async function login({ username, password }) {
    username = String(username || '').trim();
    password = String(password || '');
    const user = await store.findOne('users', { username });
    if (!user || !security.verifyPassword(password, user.password_hash)) {
      return { statusCode: 401, data: { ok: false, error: '用户名或密码错误' } };
    }
    const token = await issueSession(user._id);
    return { statusCode: 200, data: { ok: true, token, user: publicUser(user) } };
  }

  async function wxLogin({ code }) {
    if (!code) {
      return { statusCode: 400, data: { ok: false, error: '缺少 code' } };
    }
    const openid = await getOpenId(code);
    if (!openid) {
      return { statusCode: 401, data: { ok: false, error: '微信登录失败' } };
    }
    let user = await store.findOne('users', { openid });
    if (!user) {
      user = await store.insert('users', {
        username: null,
        openid,
        nickname: '微信用户',
        password_hash: null,
        created_at: new Date().toISOString(),
      });
    }
    const token = await issueSession(user._id, 'wx');
    return { statusCode: 200, data: { ok: true, token, user: publicUser(user), is_new: !user.username } };
  }

  async function me(user) {
    return { statusCode: 200, data: { ok: true, user: publicUser(user) } };
  }

  // 账号绑定：把当前 openid 身份关联到已有账号（web 端注册的用户名）。
  // 仅允许微信登录会话发起；账号密码登录（无论账号是否已绑定）都返回 400。
  async function bind(user, { username, password }) {
    if (user.provider !== 'wx') {
      return { statusCode: 400, data: { ok: false, error: '当前已是账号密码登录，无需绑定' } };
    }
    username = String(username || '').trim();
    password = String(password || '');
    const target = await store.findOne('users', { username });
    if (!target || !security.verifyPassword(password, target.password_hash)) {
      return { statusCode: 401, data: { ok: false, error: '用户名或密码错误' } };
    }
    if (target.openid && target.openid !== user.openid) {
      return { statusCode: 409, data: { ok: false, error: '该账号已绑定其他微信' } };
    }
    await store.update('users', { _id: target._id }, { openid: user.openid });
    const token = await issueSession(target._id, 'wx');
    return { statusCode: 200, data: { ok: true, token, user: publicUser(target) } };
  }

  return { register, login, wxLogin, me, bind };
}

module.exports = { createAuthRoutes };
