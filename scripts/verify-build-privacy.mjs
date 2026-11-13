/**
 * Fail-closed offline inspection of Tauri WebView browser output.
 * The allowlist prevents accidental extra files; it is NOT a secret scanner.
 */
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_FILES = 10_000;
const MAX_ENTRIES = 12_000;
const MAX_DEPTH = 32;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 256 * 1024 * 1024;
const DENIED_EXTENSION = /\.(?:map|ts|tsx|mts|cts|pem|key|p12|pfx|sqlite|sqlite3|db|log|bak|orig|swp)$/i;
const DENIED_NAME = /^(?:id_rsa|id_ed25519|credentials(?:\.[\w-]+)?|secrets?(?:\.[\w-]+)?|tokens?(?:\.[\w-]+)?)$/i;
const MAP_DIRECTIVE = /(?:\/\/[#@]|\/\*[#@])\s*sourceMappingURL\s*=/i;
const ROOT_CODE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:js|mjs|css)$/;
const ROOT_LICENSE = /^(?:3rdpartylicenses|LICENSE|NOTICE)\.txt$/i;
const APPROVED_IMAGE = /^assets\/img\/(?:[a-zA-Z0-9_@. -]+\/)*[a-zA-Z0-9_@. -]+\.(?:png|jpg|jpeg|webp)$/;
const APPROVED_IMAGE_DIRECTORY = /^assets\/img\/(?:[a-zA-Z0-9_@. -]+\/)*[a-zA-Z0-9_@. -]+$/;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function fail(reason) { throw new Error('DESKTOP BUILD PRIVACY: ' + reason); }
function regularDirectory(path) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) fail('bundle directory is missing or unsafe');
}
function portableName(name) {
  if (/[. ]$/.test(name) || /[<>:"\\|?*\x00-\x1f]/.test(name) || WINDOWS_RESERVED_NAME.test(name)) {
    fail('nonportable Windows bundle filename');
  }
}
function approvedDirectory(relative) {
  return relative === 'assets' || relative === 'assets/img' ||
    APPROVED_IMAGE_DIRECTORY.test(relative);
}

function approvedFile(relative) {
  return relative === 'index.html' || ROOT_CODE.test(relative) ||
    ROOT_LICENSE.test(relative) || APPROVED_IMAGE.test(relative);
}

/**
 * Read only the already-built browser directory; report fixed reasons, not paths
 * or file contents. Run together with the existing exact image-manifest verifier.
 */
export function auditBuildPrivacy(bundleDir) {
  const bundle = resolve(bundleDir);
  regularDirectory(bundle);
  const seen = new Set();
  let entries = 0;
  let files = 0;
  let sourceFiles = 0;
  let bundleBytes = 0;

  function inspect(dir, relative = '', depth = 0) {
    if (depth > MAX_DEPTH) fail('browser bundle directory nesting limit exceeded');
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (++entries > MAX_ENTRIES) fail('too many bundled entries');
      const name = entry.name;
      const child = relative ? relative + '/' + name : name;
      const key = child.normalize('NFC').toLowerCase();
      if (seen.has(key)) fail('case-insensitive duplicate output path');
      seen.add(key);
      if (name.startsWith('.')) fail('hidden file or directory in browser bundle');
      portableName(name);
      if (entry.isSymbolicLink()) fail('symbolic link in browser bundle');
      const absolute = join(dir, name);
      const stat = lstatSync(absolute, { throwIfNoEntry: false });
      if (!stat || stat.isSymbolicLink()) fail('unsafe browser bundle entry');
      if (entry.isDirectory()) {
        if (!approvedDirectory(child)) fail('unapproved browser bundle directory');
        if (!stat.isDirectory()) fail('unsafe browser bundle directory');
        inspect(absolute, child, depth + 1);
        continue;
      }
      if (!entry.isFile() || !stat.isFile()) fail('special file in browser bundle');
      if (++files > MAX_FILES) fail('too many bundled files');
      if (DENIED_EXTENSION.test(name) || DENIED_NAME.test(name)) {
        fail('source, secret-like, database or debug artifact in browser bundle');
      }
      if (!approvedFile(child)) fail('unapproved browser bundle file');
      if (stat.size > MAX_SOURCE_BYTES) fail('oversized browser bundle file');
      bundleBytes += stat.size;
      if (bundleBytes > MAX_BUNDLE_BYTES) fail('browser bundle total size limit exceeded');
      const extension = extname(name).toLowerCase();
      if (['.js', '.mjs', '.css'].includes(extension)) {
        const text = readFileSync(absolute, 'utf8');
        if (MAP_DIRECTIVE.test(text)) fail('source map directive in browser bundle');
        sourceFiles++;
      }
    }
  }

  inspect(bundle);
  const entry = lstatSync(join(bundle, 'index.html'), { throwIfNoEntry: false });
  if (!entry || !entry.isFile() || entry.isSymbolicLink()) fail('safe index.html is missing');
  return { files, sourceFiles };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    if (process.argv.length !== 2) fail('unexpected CLI arguments');
    const result = auditBuildPrivacy(join(ROOT, 'dist', 'desktop', 'browser'));
    console.log('Desktop browser packaging gate: ' + result.files + ' files inspected (' + result.sourceFiles + ' scripts/stylesheets); no forbidden artifacts found.');
    console.log('This is NOT a general secret scan or a native WebView2 runtime verification.');
  } catch (error) {
    console.error(error instanceof Error && error.message.startsWith('DESKTOP BUILD PRIVACY:')
      ? error.message : 'DESKTOP BUILD PRIVACY: inspection failed');
    process.exitCode = 1;
  }
}
