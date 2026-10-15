import path from 'node:path';

export function resolveImport(file, specifier, paths = path) {
  if (!specifier.startsWith('.')) return null;
  return paths.resolve(paths.dirname(paths.resolve(file)), specifier.split(/[?#]/)[0]);
}

// Runtime adapters are the composition layer: their job is to connect features.
// Feature controllers still cannot reach into another feature's implementation.
export function crossesFeatureBoundary(file, specifier, featureRoot, featureDirs, paths = path) {
  const target = resolveImport(file, specifier, paths);
  if (!target) return false;
  const owner = paths.relative(paths.resolve(featureRoot), paths.resolve(file)).split(paths.sep)[0];
  const targetOwner = paths.relative(paths.resolve(featureRoot), target).split(paths.sep)[0];
  if (owner === 'runtime') return false;
  return featureDirs.has(targetOwner) && targetOwner !== owner;
}

export function findImportCycles(graph) {
  const visiting = new Set(), visited = new Set(), cycles = [];
  function visit(file, trail) {
    if (visiting.has(file)) { cycles.push([...trail.slice(trail.indexOf(file)), file]); return; }
    if (visited.has(file)) return;
    visiting.add(file);
    for (const dependency of graph.get(file) || []) {
      if (graph.has(dependency)) visit(dependency, [...trail, file]);
    }
    visiting.delete(file); visited.add(file);
  }
  for (const file of graph.keys()) visit(file, []);
  return cycles;
}
