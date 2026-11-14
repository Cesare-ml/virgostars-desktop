/**
 * Read-only, fail-closed heuristic for the Windows native GUI smoke runner.
 * A valid recent mtime is not an integrity proof of executable embedded assets.
 */
import { lstatSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BUNDLE_FILES = 8192;
const MAX_DEPTH = 16;
const TIMESTAMP_SLOP_MS = 1000;

function failure(code) {
  throw new Error('NATIVE_BUNDLE_' + code);
}

function verifiedStat(path, kind) {
  let stat;
  try { stat = lstatSync(path); } catch { failure('MISSING'); }
  if (stat.isSymbolicLink() || (kind === 'file' ? !stat.isFile() : !stat.isDirectory())) {
    failure('UNSAFE_PATH');
  }
  if (!Number.isFinite(stat.mtimeMs) || stat.mtimeMs < 0) failure('INVALID_TIMESTAMP');
  return stat;
}

/**
 * @param {string} binaryPath exact compiled .exe path
 * @param {string} bundlePath exact Angular browser output directory
 * @returns {{ files: number, status: 'plausibly_current' }}
 */
export function verifyNativeBundleFreshness(binaryPath, bundlePath) {
  const executable = verifiedStat(resolve(binaryPath), 'file');
  const root = resolve(bundlePath);
  verifiedStat(root, 'directory');
  const limit = executable.mtimeMs + TIMESTAMP_SLOP_MS;
  let files = 0;
  let foundIndex = false;
  let foundScript = false;
  let foundStyle = false;

  function inspect(directory, depth) {
    if (depth > MAX_DEPTH) failure('DEPTH_LIMIT');
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); }
    catch { failure('UNREADABLE'); }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) failure('UNSAFE_PATH');
      if (entry.isDirectory()) {
        verifiedStat(path, 'directory');
        inspect(path, depth + 1);
      } else if (entry.isFile()) {
        const stat = verifiedStat(path, 'file');
        files++;
        if (files > MAX_BUNDLE_FILES) failure('FILE_LIMIT');
        if (stat.mtimeMs > limit) failure('STALE_EXECUTABLE');
        if (depth === 0 && entry.name === 'index.html') foundIndex = true;
        if (depth === 0 && /\.(?:m?js)$/i.test(entry.name)) foundScript = true;
        if (depth === 0 && /\.css$/i.test(entry.name)) foundStyle = true;
      } else failure('UNSAFE_PATH');
    }
  }
  inspect(root, 0);
  if (!foundIndex || !foundScript || !foundStyle) failure('INCOMPLETE_BUNDLE');
  return Object.freeze({ files, status: 'plausibly_current' });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    if (process.argv.length !== 2) failure('ARGUMENTS');
    const result = verifyNativeBundleFreshness(
      join(ROOT, 'src-tauri', 'target', 'release', 'virgostars-desktop-spike.exe'),
      join(ROOT, 'dist', 'desktop', 'browser'),
    );
    console.log('Native bundle timestamps plausibly current for ' + result.files + ' packaged files. This is not a binary-asset integrity or WebView2 test.');
  } catch (error) {
    const message = /^NATIVE_BUNDLE_[A-Z_]+$/.test(error?.message) ? error.message : 'NATIVE_BUNDLE_UNREADABLE';
    console.error(message);
    process.exitCode = 1;
  }
}
