/**
 * Additional review candidates when different branches change paths such as
 * `config` and `config/settings.json`. Git cannot check out both as regular
 * files in the same tree. These are path-level signals, not merge verdicts.
 * This module performs no filesystem or Git operations.
 */
function* ancestors(path) {
  for (let index = path.indexOf('/'); index !== -1; index = path.indexOf('/', index + 1)) {
    yield path.slice(0, index);
  }
}

// A Git diff can fit within its byte budget yet expand to an enormous number
// of ancestor-path pairs (especially across 100 parallel branches). Stop the
// audit rather than returning truncated data that could look merge-safe.
export const MAX_PREFIX_COLLISION_PAIRS = 1024;
export const PREFIX_COLLISION_BUDGET_ERROR = 'Too many file-directory prefix collisions; review a smaller branch batch';

function addCollision(rows, candidate) {
  if (rows.length >= MAX_PREFIX_COLLISION_PAIRS) throw new Error(PREFIX_COLLISION_BUDGET_ERROR);
  rows.push(candidate);
}

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/** Compare each path only with its ancestors, not every other changed path. */
export function findBranchPrefixOverlaps(files) {
  const collisions = [];
  for (const [nestedPath, nestedBranches] of files) {
    for (const ancestorPath of ancestors(nestedPath)) {
      const ancestorBranches = files.get(ancestorPath);
      if (!ancestorBranches || !ancestorBranches.some(a => nestedBranches.some(b => a !== b))) continue;
      addCollision(collisions, {ancestorPath, nestedPath,
        ancestorBranches: [...ancestorBranches].sort(), nestedBranches: [...nestedBranches].sort()});
    }
  }
  return collisions.sort((a, b) => compare(a.ancestorPath, b.ancestorPath) ||
    compare(a.nestedPath, b.nestedPath));
}

/** Compare branch changes with main-side changes from the same merge base. */
export function findBasePrefixOverlaps(branch, branchPaths, baseSidePaths) {
  const feature = new Set(branchPaths);
  const base = new Set(baseSidePaths);
  const collisions = [];
  for (const branchPath of feature) {
    for (const basePath of ancestors(branchPath)) {
      if (base.has(basePath)) addCollision(collisions, {branch, basePath, branchPath});
    }
  }
  for (const basePath of base) {
    for (const branchPath of ancestors(basePath)) {
      if (feature.has(branchPath)) addCollision(collisions, {branch, basePath, branchPath});
    }
  }
  return collisions.sort((a, b) => compare(a.basePath, b.basePath) ||
    compare(a.branchPath, b.branchPath));
}
