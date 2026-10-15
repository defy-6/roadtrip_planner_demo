import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprint, validateTarget, target } from '../scripts/release-support.mjs';

test('release fingerprint detects added, deleted and edited untracked source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roadtrip-release-'));
  try {
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src/a.js'), 'original');
    const first = await fingerprint(root, ['src']);
    await writeFile(join(root, 'src/a.js'), 'edited');
    assert.notEqual(await fingerprint(root, ['src']), first);
    await writeFile(join(root, 'src/a.js'), 'original');
    await writeFile(join(root, 'src/b.js'), 'added');
    assert.notEqual(await fingerprint(root, ['src']), first);
    await rm(join(root, 'src/b.js'));
    assert.equal(await fingerprint(root, ['src']), first);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('release refuses an AppID/environment mismatch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roadtrip-target-'));
  try {
    await mkdir(join(root, 'miniprogram'));
    await writeFile(join(root, 'project.config.json'), JSON.stringify({ appid: 'wrong', miniprogramRoot: 'miniprogram/', cloudfunctionRoot: 'cloudfunctions/' }));
    await writeFile(join(root, 'miniprogram/app.js'), `env: '${target.environment}'`);
    await writeFile(join(root, 'miniprogram/config.js'), `API_BASE: '${target.apiBase}'`);
    await assert.rejects(validateTarget(root), /target mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
