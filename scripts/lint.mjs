// 架构 lint:除静态壳规则外,检查目录依赖方向、纯模块约束、runtime 行数与循环依赖。
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const root = 'public';
let failed = false;
let ruleCount = 0;

function fail(message) { failed = true; console.error(`Lint rule failed: ${message}`); }
function pass() { ruleCount += 1; }

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

// ---- 静态壳规则(原有) ----
const staticChecks = [
  ['public/features/runtime.js', /document\.head\.append\(Object\.assign\(document\.createElement\('style'\)/, 'runtime must not inject dynamic <style> elements', 'not'],
  ['public/features/runtime.js', /(?:localStorage|fetch\()/, 'runtime must not access infrastructure directly', 'not'],
  ['public/app.js', /bootstrap\.js/, 'app entry must delegate startup to bootstrap', 'has'],
  ['public/bootstrap.js', /createPersistence/, 'bootstrap must compose persistence before runtime', 'has'],
  ['public/index.html', /href="\/runtime\.css(?:\?[^\"]*)?"/, 'index must load runtime.css', 'has'],
  ['public/index.html', /href="\/mobile\.css(?:\?[^\"]*)?"/, 'desktop shell must not load mobile.css', 'not'],
  ['public/bootstrap.js', /preview\.mode === 'mobile'/, 'bootstrap must isolate mobile mode', 'has'],
  ['public/bootstrap.js', /stylesheet\.href = '\.\/desktop\.css/, 'bootstrap must load desktop-only corrections', 'has'],
  ['public/index.html', /id="mapExportPreview"/, 'fixed export dialog shells belong in index.html', 'has'],
  ['public/index.html', /id="placeEditor"/, 'fixed place editor shell belongs in index.html', 'has'],
  ['public/index.html', /id="planDialog"/, 'fixed plan dialog shell belongs in index.html', 'has']
];
for (const [file, rule, message, mode] of staticChecks) {
  const content = await readFile(file, 'utf8');
  const ok = mode === 'not' ? !rule.test(content) : rule.test(content);
  if (ok) pass(); else fail(`${message} (${file})`);
}

// ---- 目录依赖规则 ----
const files = await walk(root);

// 1) core 不得导入 features/services
for (const file of files.filter(file => file.startsWith(join(root, 'core')))) {
  const content = await readFile(file, 'utf8');
  const bad = [...content.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(match => match[1]).filter(path => /(?:\.\.\/)+features|\.\.\/services/.test(path));
  if (bad.length) fail(`core must not import features/services: ${file} -> ${bad.join(', ')}`);
}
pass();

// 2) services 不得访问 DOM
for (const file of files.filter(file => file.startsWith(join(root, 'services')))) {
  const content = await readFile(file, 'utf8');
  if (/document\.|window\.|querySelector|getElementById|innerHTML|addEventListener/.test(content)) fail(`service must not touch DOM: ${file}`);
}
pass();

// 3) 纯 model(文件名 model.js)不得访问 DOM/Leaflet/网络
for (const file of files.filter(file => file.endsWith('model.js'))) {
  const content = await readFile(file, 'utf8');
  if (/document\.|window\.|querySelector|getElementById|innerHTML|\bL\.(map|polyline|marker)|fetch\(|localStorage/.test(content)) fail(`model must stay pure (no DOM/Leaflet/network): ${file}`);
}
pass();

// 4) feature controller 不得直接导入其他 feature 目录(同目录内互引允许)
const featureDirs = new Set(['places', 'schedule', 'routes', 'map', 'flights', 'costs', 'weather', 'export', 'plans', 'route-summary']);
for (const file of files.filter(file => file.startsWith(join(root, 'features')) && !file.endsWith('model.js') && !file.endsWith('runtime.js'))) {
  const content = await readFile(file, 'utf8');
  const bad = [...content.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(match => match[1])
    .filter(path => /^\.\.\//.test(path)) // 只检查跨目录相对导入
    .filter(path => {
      const resolved = resolve(join(file, '..'), path);
      const rel = relative(join(root, 'features'), resolved).split('/')[0];
      return featureDirs.has(rel);
    });
  if (bad.length) fail(`feature must not import another feature directory: ${file} -> ${bad.join(', ')}`);
}
pass();

// 5) runtime 行数上限(composition root 目标 300-600)
const runtimeContent = await readFile('public/features/runtime.js', 'utf8');
const runtimeLines = runtimeContent.split('\n').length;
if (runtimeLines > 600) fail(`runtime.js is ${runtimeLines} lines (limit 600)`);
pass();

// 6) 循环依赖检测(import 图 DFS)
const importMap = new Map();
for (const file of files) {
  const content = await readFile(file, 'utf8');
  const deps = [...content.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(match => {
    const specifier = match[1];
    if (!specifier.startsWith('.')) return null;
    return resolve(join(file, '..'), specifier);
  }).filter(Boolean);
  importMap.set(file, deps);
}
const visiting = new Set(), visited = new Set(), cyclePaths = [];
function dfs(file, trail) {
  if (visiting.has(file)) {
    const start = trail.indexOf(file);
    cyclePaths.push([...trail.slice(start), file].map(entry => relative(root, entry)).join(' -> '));
    return;
  }
  if (visited.has(file)) return;
  visiting.add(file);
  for (const dep of importMap.get(file) || []) if (importMap.has(dep)) dfs(dep, [...trail, file]);
  visiting.delete(file);
  visited.add(file);
}
for (const file of files) dfs(file, []);
if (cyclePaths.length) fail(`circular imports detected:\n  ${cyclePaths.join('\n  ')}`);
pass();

// 7) 移动端入口只负责组合，页面级交互与样式必须按功能拆分。
const mobileShell = await readFile('public/features/mobile/shell.js', 'utf8');
for (const feature of ['schedule', 'map', 'places', 'plans', 'dialogs']) {
  if (!mobileShell.includes(`./${feature}.js`)) fail(`mobile shell must compose ${feature}.js`);
}
if (mobileShell.split('\n').length > 40) fail('mobile shell must remain a small composition root');
const mobileCss = await readFile('public/mobile.css', 'utf8');
for (const feature of ['schedule', 'map', 'places', 'plans', 'dialogs']) {
  if (!mobileCss.includes(`styles/mobile/${feature}.css`)) fail(`mobile.css must import styles/mobile/${feature}.css`);
}
pass();

if (failed) process.exitCode = 1;
else console.log(`Architecture lint passed (${ruleCount} rules).`);
