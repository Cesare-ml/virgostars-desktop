#!/usr/bin/env node
/**
 * Dependency-free, read-only native test gate for the synthetic Rust profile
 * status fence. No Cargo, Tauri, downloads, account access or source edits.
 * Output binaries are isolated in an automatically removed OS temp directory.
 */
import {lstatSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'src-tauri', 'src', 'profile_status_generation.rs');

function assert(ok, message) { if (!ok) throw new Error(message); }

/**
 * Testable runner: only the process execution function and temp base may be
 * injected. Production CLI always uses the fixed checked-in Rust source.
 * Never include native compiler output or absolute paths in thrown errors.
 */
export function testProfileStatusRust({run=spawnSync, tempBase=tmpdir()}={}) {
  let source;
  try {
    const stat = lstatSync(SOURCE);
    assert(stat.isFile() && !stat.isSymbolicLink(), 'RUST_FENCE_SOURCE_INVALID');
    source = readFileSync(SOURCE, 'utf8');
  } catch {
    throw new Error('RUST_FENCE_SOURCE_UNAVAILABLE');
  }
  const expected = [...source.matchAll(/^\s*#\[test\]\s*$/gm)].length;
  assert(expected > 0 && expected <= 100, 'RUST_FENCE_TEST_INVENTORY_INVALID');

  const directory = mkdtempSync(join(tempBase, 'vs-fence-rust-'));
  const binary = join(directory, process.platform === 'win32' ? 'fence-tests.exe' : 'fence-tests');
  try {
    let compiled;
    try {
      compiled = run('rustc', ['--edition=2021', '--test', SOURCE, '-o', binary], {
        cwd: ROOT, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024,
        windowsHide: true, shell: false,
      });
    } catch {
      throw new Error('RUST_FENCE_COMPILER_UNAVAILABLE');
    }
    if (compiled?.error?.code === 'ENOENT') throw new Error('RUST_FENCE_COMPILER_UNAVAILABLE');
    assert(compiled?.status === 0 && !compiled?.signal && !compiled?.error,
      'RUST_FENCE_COMPILATION_FAILED');

    let executed;
    try {
      executed = run(binary, ['--test-threads=1'], {
        cwd: ROOT, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024,
        windowsHide: true, shell: false,
      });
    } catch {
      throw new Error('RUST_FENCE_EXECUTION_FAILED');
    }
    assert(executed?.status === 0 && !executed?.signal && !executed?.error,
      'RUST_FENCE_EXECUTION_FAILED');
    const matches = [...String(executed.stdout ?? '').matchAll(/test result: ok\. (\d+) passed; (\d+) failed;/g)];
    assert(matches.length === 1 && Number(matches[0][1]) === expected &&
      Number(matches[0][2]) === 0,
      'RUST_FENCE_TEST_COUNT_MISMATCH');
    return Object.freeze({passed: expected});
  } finally {
    try { rmSync(directory, {recursive: true, force: true, maxRetries: 2}); }
    catch { throw new Error('RUST_FENCE_CLEANUP_FAILED'); }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert(process.argv.length === 2, 'RUST_FENCE_ARGUMENTS_NOT_ALLOWED');
    const result = testProfileStatusRust();
    console.log('RUST_FENCE_TEST_PASS: ' + result.passed + ' standalone Rust unit tests');
  } catch (error) {
    const allowed = new Set([
      'RUST_FENCE_SOURCE_UNAVAILABLE', 'RUST_FENCE_TEST_INVENTORY_INVALID',
      'RUST_FENCE_COMPILER_UNAVAILABLE', 'RUST_FENCE_COMPILATION_FAILED',
      'RUST_FENCE_EXECUTION_FAILED', 'RUST_FENCE_TEST_COUNT_MISMATCH',
      'RUST_FENCE_CLEANUP_FAILED', 'RUST_FENCE_ARGUMENTS_NOT_ALLOWED',
    ]);
    console.error(allowed.has(error?.message) ? error.message : 'RUST_FENCE_TEST_FAILED');
    process.exitCode = 1;
  }
}
