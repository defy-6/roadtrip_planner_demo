import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { crossesFeatureBoundary, findImportCycles, resolveImport } from '../scripts/import-graph.mjs';

for (const [platform, paths, root] of [['Windows', path.win32, 'E:\\project\\public\\features'],
  ['Linux', path.posix, '/project/public/features']]) {
  test(`${platform}: feature boundaries reject cross-feature imports but allow runtime composition`, () => {
    const dirs = new Set(['map', 'places', 'schedule']);
    const file = paths.join(root, 'places/editor.js');
    assert.equal(crossesFeatureBoundary(file, '../map/controller.js?v=1', root, dirs, paths), true);
    assert.equal(crossesFeatureBoundary(file, './model.js?v=1', root, dirs, paths), false);
    assert.equal(crossesFeatureBoundary(paths.join(root, 'runtime/editors.js'), '../schedule/editor.js', root, dirs, paths), false);
  });
  test(`${platform}: canonical import paths detect cycles despite cache query strings`, () => {
    const a = paths.join(root, 'map/a.js'), b = paths.join(root, 'map/b.js');
    const graph = new Map([[a, [resolveImport(a, './b.js?v=1', paths)]], [b, [resolveImport(b, './a.js#cached', paths)]]]);
    assert.deepEqual(findImportCycles(graph), [[a, b, a]]);
    graph.set(b, []);
    assert.deepEqual(findImportCycles(graph), []);
  });
}
