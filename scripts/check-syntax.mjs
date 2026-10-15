import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const roots = ['public', 'scripts', 'server', 'miniprogram', 'cloudfunctions/api', 'cloudfunctions/api-single'];
const files = ['server.js'];

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await collect(file);
    else if (/\.(?:js|mjs)$/.test(entry.name)) files.push(file);
  }
}

for (const root of roots) {
  try { await access(root); await collect(root); } catch { /* Optional directory. */ }
}

// 用异步 spawn 逐个执行 `node --check`。
// 判定与原先的 spawnSync 完全一致：子进程退出码非 0 即视为该文件语法失败，整体 exitCode = 1。
// 差异仅在于：不依赖同步子进程 API（某些受限环境下 spawnSync/execSync 会直接 EBUSY），
// 并且失败时输出真实的语法报错而非 undefined。
function check(file) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--check', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let stdout = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.on('error', error => resolve({ ok: false, output: `${error.code || ''} ${error.message}`.trim() }));
    child.on('close', code => resolve({ ok: code === 0, output: stderr || stdout }));
  });
}

const sorted = files.sort();
const failures = [];
for (const file of sorted) {
  // 顺序执行：报错顺序稳定且可读，也避免一次性铺开上百个子进程。
  // eslint-disable-next-line no-await-in-loop
  const result = await check(file);
  if (!result.ok) failures.push({ file, output: result.output });
}

for (const { file, output } of failures) {
  process.stderr.write(`\nSyntax check failed: ${file}\n${output || '(no output)'}\n`);
}

if (failures.length) {
  process.stderr.write(`\nSyntax check failed: ${failures.length}/${sorted.length} files.\n`);
  process.exitCode = 1;
} else {
  console.log(`Module syntax check passed (${sorted.length} files).`);
}
