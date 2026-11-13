/**
 * Fail-closed, offline inspection of files copied into the Tauri WebView bundle.
 * This checks packaging accidents; it is not a secret scanner or a runtime audit.
 */
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_FILES = 10_000;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const DENIED_EXTENSION = /\.(?:map|ts|tsx|mts|cts|pem|key|p12|pfx|sqlite|sqlite3|db|log|bak|orig|swp)$/i;
const DENIED_NAME = /^(?:id_rsa|id_ed25519|credentials(?:\.[\w-]+)?|secrets?(?:\.[\w-]+)?|tokens?(?:\.[\w-]+)?)$/i;
const MAP_DIRECTIVE = /(?:\/\/[#@]|\/\*[#@])\s*sourceMappingURL\s*=/i;

function fail(reason) { throw new Error('DESKTOP BUILD PRIVACY: ' + reason); }
function regularDirectory(path) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) fail('bundle directory is missing or unsafe');
}

/**
 * Read only the already-built browser directory. Errors intentionally omit paths,
 * file contents, and input values so diagnostics are safe to share.
 */
export function auditBuildPrivacy(bundleDir) {
  const bundle = resolve(bundleDir);
  regularDirectory(bundle);
  const seen = new Set();
  let files = 0;
  let sourceFiles = 0;

  function inspect(dir, relative = '') {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const name = entry.name;
      const child = relative ? relative + '/' + name : name;
      const key = child.normalize('NFC').toLowerCase();
      if (seen.has(key)) fail('case-insensitive duplicate output path');
      seen.add(key);
      if (name.startsWith('.')) fail('hidden file or directory in browser bundle');
      if (entry.isSymbolicLink()) fail('symbolic link in browser bundle');
      const absolute = join(dir, name);
      if (entry.isDirectory()) {
        inspect(absolute, child);
        continue;
      }
      if (!entry.isFile()) fail('special file in browser bundle');
      if (++files > MAX_FILES) fail('too many bundled files');
      if (DENIED_EXTENSION.test(name) || DENIED_NAME.test(name)) {
        fail('source, secret-like, database or debug artifact in browser bundle');
      }
      const extension = extname(name).toLowerCase();
      if (['.js', '.mjs', '.css'].includes(extension)) {
        const stat = lstatSync(absolute);
        if (!stat.isFile() || stat.isSymbolicLink()) fail('unsafe bundled source file');
        if (stat.size > MAX_SOURCE_BYTES) fail('oversized bundled script or stylesheet');
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
