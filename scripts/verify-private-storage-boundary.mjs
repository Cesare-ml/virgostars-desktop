#!/usr/bin/env node
/**
 * Source-only security boundary: the shipped Tauri host may read the *public*
 * packaged city catalogue, but must not silently acquire plaintext *private*
 * persistence. The optional standalone SQLCipher fixture stays unlinked.
 * This is not runtime proof of encryption or a replacement for code review.
 */
import {lstatSync, readFileSync, readdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NATIVE_MODULES = Object.freeze([
  'src-tauri/src/lib.rs',
  'src-tauri/src/main.rs',
  'src-tauri/src/offline_places.rs',
  'src-tauri/src/runtime_probe.rs',
]);
const CIPHER_FEATURES = new Set([
  'bundled-sqlcipher',
  'bundled-sqlcipher-vendored-openssl',
]);

function assert(ok, message) { if (!ok) throw new Error(message); }
function statOptional(path) {
  try { return lstatSync(path); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}
function readPlainFile(path) {
  const stats = lstatSync(path);
  assert(stats.isFile() && !stats.isSymbolicLink(), 'Unsafe storage audit source file');
  return readFileSync(path, 'utf8');
}
function rustSources(root, folder='src-tauri/src') {
  const out=[];
  for (const entry of readdirSync(join(root, folder), {withFileTypes: true})) {
    assert(!entry.isSymbolicLink(), 'Unexpected Rust source symlink');
    const path=folder+'/'+entry.name;
    if (entry.isDirectory()) out.push(...rustSources(root, path));
    else {
      assert(entry.isFile(), 'Unexpected Rust source type');
      if (entry.name.endsWith('.rs')) out.push(path);
    }
  }
  return out.sort();
}
function reviewedCipherManifest(raw) {
  assert(/^\s*publish\s*=\s*false\s*$/m.test(raw), 'Standalone SQLCipher experiment must not be publishable');
  assert(/^\s*\[workspace\]\s*$/m.test(raw), 'Standalone SQLCipher experiment must use an isolated workspace');
  const matches=[...raw.matchAll(/^\s*rusqlite\s*=\s*\{([^\r\n{}]+)\}\s*$/gm)];
  assert(matches.length===1, 'Standalone SQLCipher dependency requires manual review');
  const fields=matches[0][1];
  assert(/\bdefault-features\s*=\s*false\b/.test(fields), 'SQLCipher must disable default rusqlite features');
  const features=[...fields.matchAll(/\bfeatures\s*=\s*\[([^\]]*)\]/g)];
  assert(features.length===1, 'SQLCipher features require explicit review');
  const names=features[0][1].split(',').map(x=>x.trim()).filter(Boolean);
  assert(names.length===1 && /^"[a-z0-9-]+"$/.test(names[0]) &&
    CIPHER_FEATURES.has(names[0].slice(1,-1)), 'Plain SQLite or unreviewed SQLCipher feature forbidden');
  assert(/\bversion\s*=\s*"=\d+\.\d+\.\d+"/.test(fields), 'SQLCipher crate dependency must be pinned');
}

/** No file paths, user data or secrets in the result; no database is opened. */
export function auditPrivateStorageBoundary(root=ROOT) {
  const hostManifest=readPlainFile(join(root,'src-tauri/Cargo.toml'));
  const entry=readPlainFile(join(root,'src-tauri/src/lib.rs'));
  const all=rustSources(root);
  assert(JSON.stringify(all)===JSON.stringify([...NATIVE_MODULES].sort()),
    'Unreviewed native Rust module; private persistence needs separate authorization');
  const modules=[...entry.matchAll(/^\s*mod\s+([a-z_][a-z_0-9]*)\s*;/gm)].map(x=>x[1]).sort();
  assert(JSON.stringify(modules)===JSON.stringify(['offline_places','runtime_probe']),
    'Unreviewed native Rust module registration');
  // The current host links *ordinary* SQLite only for read-only, packaged
  // cities. This is not permission to use it for personal local storage.
  assert(/^rusqlite\s*=\s*\{\s*version\s*=\s*"0\.32",\s*features\s*=\s*\["bundled"\]\s*\}\s*$/m.test(hostManifest),
    'Native SQLite dependency changed; review city/private database boundary');
  assert(!/encrypted.outbox.spike|sqlcipher|private.storage|secure.storage/i.test(hostManifest),
    'Standalone encrypted experiment cannot be linked into the Tauri host without review');
  for (const path of all) {
    if (path === 'src-tauri/src/offline_places.rs') continue;
    const source=readPlainFile(join(root,path));
    assert(!/\brusqlite\b|\bSQLITE_OPEN_|\bConnection\s*::\s*open(?:_with_flags)?\b/.test(source),
      'Unreviewed native database access outside city catalogue');
  }
  const spikePath=join(root,'crates/encrypted-outbox-spike');
  const stats=statOptional(spikePath);
  if (!stats) return Object.freeze({mode:'city-catalog-only', privateStorageAvailable:false});
  assert(stats.isDirectory() && !stats.isSymbolicLink(), 'Standalone SQLCipher experiment path is unsafe');
  reviewedCipherManifest(readPlainFile(join(spikePath,'Cargo.toml')));
  return Object.freeze({mode:'isolated-synthetic-sqlcipher-spike', privateStorageAvailable:false});
}

if (process.argv[1] && resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))) {
  try {
    assert(process.argv.length===2, 'Unexpected verifier arguments');
    const result=auditPrivateStorageBoundary();
    process.stdout.write(`PRIVATE STORAGE BOUNDARY OK: ${result.mode}; real private storage unavailable.\n`);
  } catch (error) {
    process.stderr.write(`PRIVATE STORAGE BOUNDARY BLOCKED: ${error.message}\n`);
    process.exitCode=1;
  }
}
