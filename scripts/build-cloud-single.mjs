// 生成单文件版云函数（cloudfunctions/api-single/）：把 store/security/routes 内联进 index.js，
// 便于在云开发控制台在线编辑器里一键粘贴（避免多文件粘贴出错）。
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const src = path.join(root, 'cloudfunctions', 'api');
const out = path.join(root, 'cloudfunctions', 'api-single');
mkdirSync(out, { recursive: true });

// 读文件并过滤掉指定行（逐行精确处理，避免正则误删）
function readFiltered(rel, { dropStartsWith = [], dropExact = [], dropIncludes = [] } = {}) {
  return readFileSync(path.join(src, rel), 'utf8')
    .split('\n')
    .filter(line => {
      const t = line.trim();
      if (dropStartsWith.some(p => t.startsWith(p))) return false;
      if (dropExact.includes(t)) return false;
      if (dropIncludes.some(p => line.includes(p))) return false;
      return true;
    })
    .join('\n');
}

const header = `// 行远途记后端云函数（单文件版，由 scripts/build-cloud-single.mjs 生成）
// 部署：云开发控制台 → 云函数 api → index.js 整体替换本文件内容；
//       package.json 替换为 {"dependencies":{"wx-server-sdk":"~2.6.3"}}；然后保存并部署。
'use strict';

const http = require('node:http');

`;

// ---------- store.js ----------
const storeBody = readFiltered('store.js', {
  dropStartsWith: ["const fs = require('node:fs');", "const path = require('node:path');", "const crypto = require('node:crypto');", 'const COLLECTIONS', 'module.exports ='],
});
const storeBlock = `// ===== store.js（内联） =====
const storeModule = (() => {
  const fs = require('node:fs');
  const path = require('node:path');
  const crypto = require('node:crypto');
  const COLLECTIONS = ['users', 'sessions', 'trips', 'trip_members', 'trip_backups'];
${storeBody}
  return { createStore, COLLECTIONS };
})();

`;

// ---------- security.js ----------
const securityBody = readFiltered('security.js', {
  dropStartsWith: ["const crypto = require('node:crypto');"],
  dropExact: ["module.exports = { hashPassword, verifyPassword, generateToken, sessionTtlMs };"],
});
const securityBlock = `// ===== security.js（内联） =====
const securityModule = (() => {
  const crypto = require('node:crypto');
${securityBody}
  return { hashPassword, verifyPassword, generateToken, sessionTtlMs };
})();

`;

// ---------- routes/auth.js ----------
const authBody = readFiltered(path.join('routes', 'auth.js'), {
  dropExact: ["module.exports = { createAuthRoutes };"],
});
const authBlock = `// ===== routes/auth.js（内联） =====
const authModule = (() => {
${authBody}
  return { createAuthRoutes };
})();

`;

// ---------- backup-format.js ----------
const backupFormatBody = readFiltered('backup-format.js', {
  dropStartsWith: ["'use strict';", "const crypto = require('node:crypto');", "const { supportedSchema } = require('./trip-write-safety');", 'module.exports = {'],
});
const backupFormatBlock = `// ===== backup-format.js（内联） =====
const backupFormatModule = (() => {
  const { supportedSchema } = tripWriteSafetyModule;
  const crypto = require('node:crypto');
${backupFormatBody}
  return { BACKUP_FORMAT_VERSION, stableStringify, computeIntegrity, summarizeAssets, sourceVersionOf, buildBackupEnvelope, verifyBackupEnvelope, validateBackupContent };
})();

`;

// ---------- routes/trips.js ----------
const safetyBody = readFiltered('trip-write-safety.js', { dropStartsWith: ['module.exports ='] });
const safetyBlock = `const tripWriteSafetyModule = (() => {\n${safetyBody}\nreturn { nextRevision, versionConflict, guardVersion, libraryChange, supportedSchema, hasPlannerData };\n})();\n`;
const tripsBody = readFiltered(path.join('routes', 'trips.js'), {
  dropExact: ["module.exports = { createTripsRoutes };", "const backupFormat = require('../backup-format');", "const { nextRevision, versionConflict, guardVersion, libraryChange, supportedSchema, hasPlannerData } = require('../trip-write-safety');"],
});
const tripsBlock = `// ===== routes/trips.js（内联） =====
const tripsModule = (() => {
  const backupFormat = backupFormatModule;
  const { nextRevision, versionConflict, guardVersion, libraryChange, supportedSchema, hasPlannerData } = tripWriteSafetyModule;
${tripsBody}
  return { createTripsRoutes };
})();

`;

// ---------- routes/amap.js ----------
const amapBody = readFiltered(path.join('routes', 'amap.js'), {
  dropExact: ["module.exports = { createAmapRoutes };"],
});
const amapBlock = `// ===== routes/amap.js（内联） =====
const amapModule = (() => {
${amapBody}
  return { createAmapRoutes };
})();

`;

// ---------- index.js 主体 ----------
const indexBody = readFiltered('index.js', {
  dropStartsWith: ["'use strict';", "const http = require('node:http');"],
  dropIncludes: [
    "const { createStore } = require('./store');",
    "const { createAuthRoutes } = require('./routes/auth');",
    "const { createTripsRoutes } = require('./routes/trips');",
    "const { createAmapRoutes } = require('./routes/amap');",
    "const security = require('./security');",
    '// ---------- 本地直接运行',
    'exports.createStore = createStore;',
    'exports.createRouter = createRouter;',
    'exports.createServer = createServer;',
  ],
});
const indexBlock = `// ===== index.js（主逻辑，require 已指向内联模块） =====
const { createStore } = storeModule;
const { createAuthRoutes } = authModule;
const { createTripsRoutes } = tripsModule;
const { createAmapRoutes } = amapModule;
const security = securityModule;

${indexBody}
`;

const bundle = header + storeBlock + securityBlock + safetyBlock + backupFormatBlock + authBlock + tripsBlock + amapBlock + indexBlock;

writeFileSync(path.join(out, 'index.js'), bundle);
writeFileSync(path.join(out, 'package.json'), JSON.stringify({
  name: 'roadtrip-api',
  version: '0.1.0',
  private: true,
  description: '行远途记后端云函数（单文件版）',
  main: 'index.js',
  dependencies: { 'wx-server-sdk': '~2.6.3' },
}, null, 2) + '\n');

console.log(`已生成 ${out}/index.js（${bundle.split('\n').length} 行）与 package.json`);
