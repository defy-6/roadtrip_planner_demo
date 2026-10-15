import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { plannerSafetyFixture } from '../tests/fixtures/planner-safety.mjs';

const directory = await mkdtemp(join(tmpdir(), 'roadtrip-safety-'));
const dataFile = join(directory, 'planner.json');
await writeFile(dataFile, JSON.stringify(plannerSafetyFixture));
const child = spawn(process.execPath, ['server.js'], { stdio: 'inherit', env: {
  ...process.env, PORT: '3102', PREVIEW_MODE: 'desktop',
  PLANNER_DATA_FILE: dataFile, CLOUD_DEV_DATA: join(directory, 'accounts.json'), AMAP_CACHE_DIR: join(directory, 'cache')
} });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', async code => {
  // Only this explicitly created OS-temp directory is removed, never workspace data.
  await rm(directory, { recursive: true, force: true });
  process.exit(code ?? 0);
});
