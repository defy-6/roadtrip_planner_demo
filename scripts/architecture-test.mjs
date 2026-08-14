import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [index, runtimeCss, mobileCss, mobileShell, runtime, app, bootstrap, persistence] = await Promise.all([
  readFile('public/index.html', 'utf8'),
  readFile('public/runtime.css', 'utf8'),
  readFile('public/mobile.css', 'utf8'),
  readFile('public/features/mobile/shell.js', 'utf8'),
  readFile('public/features/runtime.js', 'utf8'),
  readFile('public/app.js', 'utf8'),
  readFile('public/bootstrap.js', 'utf8'),
  readFile('public/storage/persistence.js', 'utf8')
]);

assert.match(index, /<link rel="stylesheet" href="\/runtime\.css(?:\?[^\"]*)?">/);
assert.doesNotMatch(index, /<link rel="stylesheet" href="\/mobile\.css(?:\?[^\"]*)?">/, '桌面 HTML 壳不得静态加载手机样式');
assert.match(bootstrap, /preview\.mode === 'mobile'/, '手机样式只能在手机预览模式加载');
assert.match(bootstrap, /stylesheet\.href = '\.\/mobile\.css/, '手机模式应动态加载独立 mobile.css');
assert.match(bootstrap, /runtime\.shareMode[\s\S]*?mode: 'mobile'/, 'GitHub Pages 只读分享页应强制复用手机模式');
assert.match(index, /<dialog id="mapExportPreview"/);
assert.match(index, /<dialog id="placeEditor"/);
assert.match(index, /<dialog id="planDialog"/);
assert.match(runtimeCss, /Runtime presentation rules/);
assert.match(mobileCss, /Mobile shell only/);
for (const feature of ['schedule', 'map', 'places', 'plans', 'dialogs']) {
  assert.match(mobileCss, new RegExp(`styles/mobile/${feature}\\.css`));
  assert.match(mobileShell, new RegExp(`\\./${feature}\\.js`));
}
assert.doesNotMatch(runtime, /document\.createElement\('dialog'\)/);
assert.doesNotMatch(runtime, /document\.head\.append\(Object\.assign\(document\.createElement\('style'\)/);
assert.match(app, /import '\.\/bootstrap\.js'/);
assert.match(bootstrap, /startRuntime\(/);
assert.match(persistence, /enableAutoSave/);
assert.doesNotMatch(runtime, /(?:localStorage|fetch\()/);

const buildScript = await readFile('scripts/build-share.mjs', 'utf8');
assert.match(buildScript, /app\\\.js\(\[\^\\\"\]\*\)/, '共享构建应兼容 app.js 的缓存查询参数');
assert.match(buildScript, /share-config\.js/, '共享构建必须注入 share-config.js');

console.log('Architecture test passed: static shells and runtime presentation assets are wired.');
