import { cp, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'roadtrip-e2e-'));
const temporaryDataFile = join(temporaryDirectory, 'roadtrip-data.json');
await cp('data/roadtrip-data.json', temporaryDataFile);

const child = spawn(process.execPath, ['server.js'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: '3100',
    PREVIEW_MODE: 'desktop',
    PLANNER_DATA_FILE: relative(process.cwd(), temporaryDataFile)
  }
});

let stopping = false;
async function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  child.kill(signal);
  await rm(temporaryDirectory, { recursive: true, force: true });
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
child.on('exit', async code => {
  await rm(temporaryDirectory, { recursive: true, force: true });
  process.exit(code ?? 0);
});
