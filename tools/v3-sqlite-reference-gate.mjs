/**
 * Manual synthetic SQLite v3 reference gate (Node 22+).
 * No network, user profiles, SQLCipher keys, production databases, or deployment.
 * A PASS here never represents native Rust/SQLCipher validation.
 */
import { readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// A missing historical regression is an error, even when other tests pass.
export const REQUIRED_V3_SUITES = Object.freeze([
  'sqlite-v3-manual-keep-local.test.mjs',
  'sqlite-v3-readonly-audit.test.mjs',
  'sqlite-v3-conflict-previews.test.mjs',
  'sqlite-v3-keyset-pagination.test.mjs',
  'sqlite-v3-keyset-fullschema.test.mjs',
  'sqlite-v3-identity-immutability.test.mjs',
  'sqlite-v3-request-immutability.test.mjs',
  'sqlite-v3-no-replace.test.mjs',
  'sqlite-v3-history-no-replace.test.mjs',
  'sqlite-v3-ack-immutability.test.mjs',
  'sqlite-v3-latest-local-snapshot.test.mjs',
]);

export const REQUIRED_SQL_SCHEMAS = Object.freeze([
  '0001_local_outbox.sql',
  '0002_ack_ledger.sql',
  '0003_conflict_decisions.sql',
]);

export function discoverV3Suites(root) {
  const absoluteRoot = resolve(root);
  const testDir = join(absoluteRoot, 'tests');
  const schemaDir = join(absoluteRoot, 'contracts', 'sqlite');
  for (const name of REQUIRED_SQL_SCHEMAS) {
    const path = join(schemaDir, name);
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new Error(`Required versioned SQL contract missing: ${name}`);
    }
  }
  if (!existsSync(testDir) || !statSync(testDir).isDirectory()) {
    throw new Error('Missing tracked tests directory');
  }
  const available = new Set(readdirSync(testDir).filter(
    (name) => /^sqlite-v3-[a-z0-9-]+\.test\.mjs$/.test(name),
  ));
  const missing = REQUIRED_V3_SUITES.filter((name) => !available.has(name));
  if (missing.length) {
    throw new Error(`Mandatory v3 regression files missing: ${missing.join(', ')}`);
  }
  // Include additional v3 suites added later instead of silently excluding them.
  return [...available].sort().map((name) => {
    const path = join(testDir, name);
    if (!statSync(path).isFile()) {
      throw new Error(`Expected test file, found different file type: ${name}`);
    }
    return path;
  });
}

export function runV3ReferenceGate(root, { nodePath = process.execPath, nodeVersion = process.versions.node } = {}) {
  const major = Number(nodeVersion.split('.')[0]);
  if (!Number.isInteger(major) || major < 22) {
    throw new Error(`Node 22+ required for synthetic SQLite reference tests (found ${nodeVersion})`);
  }
  const suites = discoverV3Suites(root);
  console.log(`Running ${suites.length} synthetic SQLite v3 suites (NOT native SQLCipher).`);
  // Node's own test worker sets NODE_TEST_CONTEXT. Inheriting it causes a
  // nested `node --test` invocation to SKIP EVERY FILE and exit zero!
  // Force the launched test process to run as a top-level Node test runner.
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  let totalPassed = 0;
  // Run every suite separately, rather than inferring coverage from a single
  // aggregate exit code: Node can exit zero when a file contains no tests,
  // skipped tests or only TODOs. Every required suite must run and pass.
  for (const [index, suite] of suites.entries()) {
    const name = suite.slice(suite.lastIndexOf('/') + 1).split('\\').at(-1);
    const child = spawnSync(nodePath, [
      '--experimental-sqlite',
      '--experimental-strip-types',
      '--test',
      '--test-reporter=tap',
      suite,
    ], {
      encoding: 'utf8', cwd: resolve(root), env: childEnv,
      timeout: 180_000, maxBuffer: 32 * 1024 * 1024,
    });
    const output = child.stdout ?? '';
    const stderr = child.stderr ?? '';
    // Node's TAP reporter ends with machine-checkable summary lines.
    // Requiring them closes the "exit 0 with no assertions" false green.
    const getCount = (label) => {
      const matches = [...output.matchAll(new RegExp(`^# ${label} (\\d+)\\s*$`, 'gm'))];
      return matches.length === 1 ? Number(matches[0][1]) : null;
    };
    const counts = Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo']
      .map((label) => [label, getCount(label)]));
    // With a zero-test file Node 22 emits a *passing file-level Subtest*
    // and reports tests=1/pass=1. A TAP summary alone cannot catch that.
    const fileSubtests = [...output.matchAll(/^# Subtest: (.*)$/gm)]
      .map((match) => match[1].trim());
    const emptyFileFallback = fileSubtests.length === 1 && fileSubtests[0] === suite;
    const validSummary = Object.values(counts).every((count) => Number.isSafeInteger(count))
      && counts.tests > 0 && counts.pass === counts.tests && !emptyFileFallback
      && fileSubtests.length > 0
      && counts.fail === 0 && counts.cancelled === 0
      && counts.skipped === 0 && counts.todo === 0;
    if (child.error || child.signal || child.status !== 0 || !validSummary) {
      if (output) process.stderr.write(output);
      if (stderr) process.stderr.write(stderr);
      const reason = child.error?.message ?? child.signal ?? `exit ${child.status ?? 'unknown'}`;
      throw new Error(`v3 Node reference suite FAILED: ${name} (${reason}; TAP ${JSON.stringify(counts)})`);
    }
    totalPassed += counts.pass;
    console.log(`PASS ${index + 1}/${suites.length}: ${name} (${counts.pass} tests)`);
  }
  console.log(`PASS: ${suites.length} synthetic v3 SQLite suites, ${totalPassed} tests; reference only. Rust/SQLCipher still requires separate validation.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    runV3ReferenceGate(repositoryRoot);
  } catch (error) {
    console.error(`FAIL / NOT READY: ${error.message}`);
    process.exitCode = 1;
  }
}
