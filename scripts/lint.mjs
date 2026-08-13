import { readFile } from 'node:fs/promises';

const checks = [
  ['public/features/runtime.js', /document\.head\.append\(Object\.assign\(document\.createElement\('style'\)/, 'runtime must not inject dynamic <style> elements'],
  ['public/features/runtime.js', /(?:localStorage|fetch\()/, 'runtime must not access infrastructure directly'],
  ['public/app.js', /bootstrap\.js/, 'app entry must delegate startup to bootstrap'],
  ['public/bootstrap.js', /createPersistence/, 'bootstrap must compose persistence before runtime'],
  ['public/index.html', /href="\/runtime\.css"/, 'index must load runtime.css'],
  ['public/index.html', /id="mapExportPreview"/, 'fixed export dialog shells belong in index.html'],
  ['public/index.html', /id="placeEditor"/, 'fixed place editor shell belongs in index.html'],
  ['public/index.html', /id="planDialog"/, 'fixed plan dialog shell belongs in index.html']
];

let failed = false;
for (const [file, rule, message] of checks) {
  const content = await readFile(file, 'utf8');
  const expected = message.startsWith('runtime must not') ? !rule.test(content) : rule.test(content);
  if (expected) continue;
  failed = true;
  console.error(`Lint rule failed: ${message} (${file})`);
}

if (failed) process.exitCode = 1;
else console.log(`Architecture lint passed (${checks.length} rules).`);
