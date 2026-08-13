import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['public', 'scripts'];
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

let failed = false;
for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status === 0) continue;
  failed = true;
  process.stderr.write(`\nSyntax check failed: ${file}\n${result.stderr || result.stdout}`);
}

if (failed) process.exitCode = 1;
else console.log(`Module syntax check passed (${files.length} files).`);
