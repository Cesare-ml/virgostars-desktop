#!/usr/bin/env node
// Read-only review scheduling for a complete local branch-overlap audit.
// Review lanes are NOT merge groups, merge safety guarantees or PR approvals.
import {pathToFileURL} from 'node:url';
import {safeRef} from './branch-overlap-report.mjs';

const MAX_STDIN_BYTES = 2 * 1024 * 1024;
const validCount = n => Number.isSafeInteger(n) && n >= 0;
const validPath = p => typeof p === 'string' && p.length > 0 &&
  p.length <= 16384 && !p.includes('\0');
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;

function exactSet(values, expected) {
  return Array.isArray(values) && values.length === expected.size &&
    new Set(values).size === values.length &&
    values.every(value => expected.has(value));
}

/**
 * Color the shared-path graph greedily into deterministic parallel review lanes.
 * A lane contains no KNOWN shared-file pair, but semantic conflicts, base drift,
 * unreported Git changes and real merge conflicts still require human review.
 * Input must be the complete JSON from branch-overlap-report.mjs (not a PR list).
 */
export function planReviewLanes(audit) {
  if (!audit || typeof audit !== 'object' || Array.isArray(audit) ||
      !safeRef(audit.base) || audit.freshnessChecked !== true ||
      audit.baseFilesChecked !== true ||
      !Array.isArray(audit.branches) || audit.branches.length < 2 ||
      audit.branches.length > 100 || !Array.isArray(audit.overlaps) ||
      !Array.isArray(audit.baseOverlaps) || !validCount(audit.overlapFiles) ||
      !validCount(audit.baseOverlapFiles) ||
      audit.overlapFiles !== audit.overlaps.length ||
      audit.baseOverlapFiles !== audit.baseOverlaps.length)
    throw new Error('Incomplete local branch audit');

  const branches = new Map();
  for (const item of audit.branches) {
    if (!item || typeof item !== 'object' || !safeRef(item.branch) ||
        item.branch === audit.base || branches.has(item.branch) ||
        !validCount(item.behindBy) || !validCount(item.aheadBy) ||
        !validCount(item.changedFiles))
      throw new Error('Invalid branch audit');
    branches.set(item.branch, item);
  }
  const stale = new Set([...branches.values()]
    .filter(item => item.behindBy > 0).map(item => item.branch));
  if (!exactSet(audit.staleBranches, stale))
    throw new Error('Inconsistent branch freshness');

  const links = new Map([...branches.keys()].map(branch => [branch, new Set()]));
  const touched = new Map([...branches.keys()].map(branch => [branch, new Set()]));
  const overlapPaths = new Set();
  for (const item of audit.overlaps) {
    if (!item || !validPath(item.path) || overlapPaths.has(item.path) ||
        !Array.isArray(item.branches) || item.branches.length < 2 ||
        !exactSet(item.branches, new Set(item.branches)) ||
        item.branches.some(branch => !branches.has(branch)))
      throw new Error('Invalid shared-path audit');
    overlapPaths.add(item.path);
    for (const left of item.branches) {
      touched.get(left).add(item.path);
      for (const right of item.branches) {
        if (left !== right) links.get(left).add(right);
      }
    }
  }

  const baseCollisionBranches = new Set();
  const basePairs = new Set();
  for (const item of audit.baseOverlaps) {
    if (!item || !branches.has(item.branch) || !validPath(item.path))
      throw new Error('Invalid base-side audit');
    const pair = item.branch + '\0' + item.path;
    if (basePairs.has(pair)) throw new Error('Duplicate base-side audit');
    basePairs.add(pair);
    baseCollisionBranches.add(item.branch);
    touched.get(item.branch).add(item.path);
    if (branches.get(item.branch).behindBy === 0)
      throw new Error('Contradictory base-side audit');
  }

  for (const [branch, paths] of touched) {
    if (paths.size > branches.get(branch).changedFiles)
      throw new Error('Contradictory changed-file counts');
  }

  // Stable greedy grouping: high-degree branches first, then ASCII ref order.
  // This is a reviewer scheduling heuristic, not a minimum-color guarantee.
  const ordered = [...branches.keys()].sort((a,b) =>
    links.get(b).size - links.get(a).size || compare(a,b));
  const lanes = [];
  for (const branch of ordered) {
    let lane = lanes.find(group =>
      group.every(member => !links.get(branch).has(member)));
    if (!lane) { lane = []; lanes.push(lane); }
    lane.push(branch);
  }
  return {
    base: audit.base,
    branchCount: branches.size,
    sharedPathCount: overlapPaths.size,
    lanes: lanes.map(members => {
      members.sort(compare);
      return {
        branches: members,
        requiresBaseRefresh: members.filter(branch => stale.has(branch)),
        baseOverlapBranches: members.filter(branch => baseCollisionBranches.has(branch)),
      };
    }),
    note: 'Review scheduling only. Local refs may be stale. No lane implies merge safety, compatible dependencies, or approval.',
  };
}

async function readStdin() {
  let size = 0;
  let source = '';
  const decoder = new TextDecoder('utf-8', {fatal:true});
  for await (const chunk of process.stdin) {
    if (!Buffer.isBuffer(chunk)) throw new Error('Invalid audit input');
    size += chunk.length;
    if (size > MAX_STDIN_BYTES) throw new Error('Audit input exceeds size limit');
    source += decoder.decode(chunk, {stream:true});
  }
  source += decoder.decode();
  if (size === 0) throw new Error('Empty audit input');
  return source;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) {
    console.error('Usage: branch-overlap-report.mjs --json ... | triage-review-lanes.mjs');
    process.exitCode = 2;
  } else {
    try {
      const result = planReviewLanes(JSON.parse(await readStdin()));
      console.log(JSON.stringify(result, null, 2));
    } catch {
      // No untrusted JSON, paths or OS exceptions in CLI diagnostics.
      console.error('Invalid or incomplete read-only local branch audit');
      process.exitCode = 2;
    }
  }
}
