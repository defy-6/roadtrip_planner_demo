import { openSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const previewUrl = 'http://127.0.0.1:3001/?preview=mobile#schedule';
const healthUrl = 'http://127.0.0.1:3001/api/preview-mode';
const cacheDir = join(projectRoot, '.cache');

async function isMobilePreviewReady() {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1000) });
    const payload = await response.json();
    return payload.mode === 'mobile';
  } catch {
    return false;
  }
}

if (!(await isMobilePreviewReady())) {
  await mkdir(cacheDir, { recursive: true });
  const stdout = openSync(join(cacheDir, 'mobile-preview.out.log'), 'a');
  const stderr = openSync(join(cacheDir, 'mobile-preview.err.log'), 'a');
  const server = spawn(process.execPath, ['--watch', 'server.js'], {
    cwd: projectRoot,
    detached: true,
    windowsHide: true,
    env: { ...process.env, PORT: '3001', PREVIEW_MODE: 'mobile' },
    stdio: ['ignore', stdout, stderr],
  });
  server.unref();

  let ready = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (await isMobilePreviewReady()) {
      ready = true;
      break;
    }
  }

  if (!ready) {
    throw new Error(`Mobile preview did not start. Check ${join(cacheDir, 'mobile-preview.err.log')}`);
  }
}

const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', previewUrl], {
  detached: true,
  windowsHide: true,
  stdio: 'ignore',
});
browser.unref();
console.log(`Mobile preview opened: ${previewUrl}`);
