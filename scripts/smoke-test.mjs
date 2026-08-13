import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [index, runtimeCss, runtime, app, bootstrap, persistence] = await Promise.all([
  readFile('public/index.html', 'utf8'),
  readFile('public/runtime.css', 'utf8'),
  readFile('public/features/runtime.js', 'utf8'),
  readFile('public/app.js', 'utf8'),
  readFile('public/bootstrap.js', 'utf8'),
  readFile('public/storage/persistence.js', 'utf8')
]);

assert.match(index, /<link rel="stylesheet" href="\/runtime\.css">/);
assert.match(index, /<dialog id="mapExportPreview"/);
assert.match(index, /<dialog id="placeEditor"/);
assert.match(index, /<dialog id="planDialog"/);
assert.match(runtimeCss, /Runtime presentation rules/);
assert.doesNotMatch(runtime, /document\.createElement\('dialog'\)/);
assert.doesNotMatch(runtime, /document\.head\.append\(Object\.assign\(document\.createElement\('style'\)/);
assert.match(app, /import '\.\/bootstrap\.js'/);
assert.match(bootstrap, /startRuntime\(/);
assert.match(persistence, /enableAutoSave/);
assert.doesNotMatch(runtime, /(?:localStorage|fetch\()/);

console.log('Smoke test passed: static shells and runtime presentation assets are wired.');
