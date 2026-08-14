// 安全原语：scrypt 密码哈希（Node 内置 crypto，无需第三方依赖）+ 会话 token。
'use strict';

const crypto = require('node:crypto');

const SCRYPT_KEYLEN = 64;
const TOKEN_BYTES = 32;
const SESSION_DAYS = 30;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

function sessionTtlMs() {
  return SESSION_DAYS * 24 * 60 * 60 * 1000;
}

module.exports = { hashPassword, verifyPassword, generateToken, sessionTtlMs };
