import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { fingerprint, target, validateTarget } from './release-support.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const [command = 'prepare', version] = process.argv.slice(2);
if (!['prepare', 'verify'].includes(command) || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/.test(version || '')) {
  throw new Error('Usage: node scripts/release.mjs prepare|verify 0.2.0');
}
const directory = join(root, 'work/releases', version);
const recordPath = join(directory, 'release.json');
async function run(executable, args, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    let output = '';
    if (capture) { child.stdout.on('data', value => { output += value; }); child.stderr.on('data', () => {}); }
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(`${executable} exited ${code}`)));
  });
}
await validateTarget(root);
if (command === 'verify') {
  const record = JSON.parse((await readFile(recordPath, 'utf8')).replace(/^\uFEFF/, ''));
  if (record.version !== version || record.gate !== 'passed' ||
      JSON.stringify(record.target) !== JSON.stringify(target) ||
      record.sourceHash !== await fingerprint(root) ||
      record.webHash !== await fingerprint(directory, ['web'])) {
    throw new Error('Release changed or did not pass the gate. Prepare this version again.');
  }
  console.log(`Verified ${version}: tested source and web artifact match.`);
} else {
  await mkdir(directory, { recursive: true });
  // Invalidate an older successful record before starting any checks.
  const record = { version, target, startedAt: new Date().toISOString(), gate: 'running',
    deployment: 'not-started', deviceAcceptance: 'pending', consoleAcceptance: 'pending' };
  await writeFile(recordPath, JSON.stringify(record, null, 2));
  try {
    const before = await fingerprint(root);
    await run(process.execPath, ['scripts/build-cloud-single.mjs']);
    for (const script of ['scripts/lint.mjs', 'scripts/check-syntax.mjs', 'scripts/architecture-test.mjs']) {
      await run(process.execPath, [script]);
    }
    const unit = (await readdir(join(root, 'tests'))).filter(name => name.endsWith('.test.mjs')).sort();
    await run(process.execPath, ['--test', ...unit.map(name => `tests/${name}`)]);
    await run(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config=playwright.release.config.js']);
    if (before !== await fingerprint(root)) throw new Error('Source changed while gate was running. Rerun preparation.');
    const web = join(directory, 'web');
    // A version directory is immutable: require a new version or manual archival
    // instead of merging new files with a stale artifact.
    await mkdir(web);
    await cp(join(root, 'public'), web, { recursive: true });
    const indexPath = join(web, 'index.html');
    const index = await readFile(indexPath, 'utf8');
    if (!index.includes('<head>')) throw new Error('Web entry has no injection point.');
    await writeFile(indexPath, index.replace('<head>', `<head><script>window.__API_BASE__=${JSON.stringify(target.apiBase)};</script>`));
    record.gate = 'passed'; record.sourceHash = before;
    record.webHash = await fingerprint(directory, ['web']);
    record.commit = await run('git', ['rev-parse', 'HEAD'], true);
    record.dirty = Boolean(await run('git', ['status', '--porcelain'], true));
    record.completedAt = new Date().toISOString();
    console.log(`Release ready: ${recordPath}`);
  } catch (error) { record.gate = 'failed'; throw error; }
  finally { await writeFile(recordPath, JSON.stringify(record, null, 2)); }
}
