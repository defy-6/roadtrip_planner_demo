import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export const target = Object.freeze({ appid: 'wx7e7f29848ea9baa8',
  environment: 'cloud1-d0giwgf98368c9398', functionName: 'api',
  apiBase: 'https://cloud1-d0giwgf98368c9398.service.tcloudbase.com' });

// Include untracked source too: this project currently has an uncommitted S1.
export async function fingerprint(root, roots = ['public', 'miniprogram', 'cloudfunctions/api',
  'scripts', 'tests', 'server', 'server.js', 'package.json', 'package-lock.json',
  'project.config.json', 'playwright.safety.config.js', 'playwright.release.config.js', '.github/workflows']) {
  const hash = createHash('sha256');
  async function visit(path) {
    const entries = await readdir(join(root, path), { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOTDIR') return null;
      throw error;
    });
    if (!entries) { hash.update(path.replaceAll('\\', '/')); hash.update('\0'); hash.update(await readFile(join(root, path))); return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (entry.name === 'node_modules') continue;
      if (entry.isSymbolicLink()) throw new Error(`Release sources cannot contain symbolic links: ${path}/${entry.name}`);
      await visit(`${path}/${entry.name}`);
    }
  }
  for (const path of roots) await visit(path);
  return hash.digest('hex');
}

export async function validateTarget(root) {
  const project = JSON.parse(await readFile(join(root, 'project.config.json'), 'utf8'));
  const app = await readFile(join(root, 'miniprogram/app.js'), 'utf8');
  const config = await readFile(join(root, 'miniprogram/config.js'), 'utf8');
  if (project.appid !== target.appid || project.miniprogramRoot !== 'miniprogram/' ||
      project.cloudfunctionRoot !== 'cloudfunctions/' ||
      !new RegExp(`env:\\s*['"]${target.environment}['"]`).test(app) ||
      !config.includes(`API_BASE: '${target.apiBase}'`)) {
    throw new Error('Release target mismatch: check AppID, project roots, cloud env and API_BASE.');
  }
  return target;
}
