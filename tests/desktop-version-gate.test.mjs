import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { verifyDesktopVersions } from '../scripts/verify-desktop-version.mjs';

const baseline = Object.freeze({
  'package.json': JSON.stringify({name:'virgostars-desktop',version:'0.0.1'}),
  'package-lock.json': JSON.stringify({name:'virgostars-desktop',version:'0.0.1',lockfileVersion:3,
    packages:{'':{name:'virgostars-desktop',version:'0.0.1'}}}),
  'src-tauri/tauri.conf.json': JSON.stringify({productName:'VirgoStars Desktop Lab',version:'0.0.1'}),
  'src-tauri/Cargo.toml': '[package]\nname = "virgostars-desktop-spike"\nversion = "0.0.1"\n[dependencies]\nversion = "999.0.0"\n',
  'src-tauri/Cargo.lock': 'version = 4\n[[package]]\nname = "other"\nversion = "0.0.2"\n[[package]]\nname = "virgostars-desktop-spike"\nversion = "0.0.1"\n',
});
function check(overrides = {}) {
  const docs = { ...baseline, ...overrides };
  return verifyDesktopVersions({readText: name => {
    if (!(name in docs)) throw Error('path is private');
    return docs[name];
  }});
}

test('accepts five matching project manifests while ignoring unrelated Cargo dependencies', () => {
  assert.deepEqual(check(), {version:'0.0.1',checkedManifests:5});
});
test('allows matching canonical prerelease versions', () => {
  const ver='1.2.3-beta.2';
  const versions = Object.fromEntries(Object.entries(baseline).map(([path,content]) => {
    if (path === 'package-lock.json') {
      const lock = JSON.parse(content);
      return [path, JSON.stringify({...lock, version:ver,
        packages:{'':{...lock.packages[''],version:ver}}})];
    }
    return [path, path.endsWith('.json') ?
      JSON.stringify({...JSON.parse(content),version:ver}) :
      content.replaceAll('"0.0.1"','"' + ver + '"')];
  }));
  assert.equal(check(versions).version,ver);
});
test('rejects each manifest independently when its version drifts', () => {
  for (const path of Object.keys(baseline)) {
    assert.throws(() => check({[path]:baseline[path].replace('0.0.1','0.0.2')}),/mismatch/,path);
  }
});
test('rejects invalid canonical versions and version coercion', () => {
  for (const version of ['01.2.3','1.2','1.2.3+build','1.2.3-rc..1','1.2.3-01','1.2.3 ', '', 123]) {
    assert.throws(() => check({'package.json':JSON.stringify({version})}),/Invalid Desktop version/,String(version));
  }
});
test('does not accept malformed JSON or non-object Tauri input', () => {
  assert.throws(() => check({'package.json':'{'}),/Invalid npm package JSON/);
  assert.throws(() => check({'src-tauri/tauri.conf.json':'[]'}),/Invalid Tauri JSON/);
});
test('does not leak absolute host paths when a file cannot be read', () => {
  assert.throws(() => verifyDesktopVersions({readText: () => {throw Error('/secret/home/birth-archive');}}), error =>
    /Cannot read npm version manifest/.test(error.message) && !error.message.includes('/secret/'));
});
test('ignores commented Cargo identities and rejects missing package section', () => {
  assert.throws(() => check({'src-tauri/Cargo.toml':'# [package]\nname = "virgostars-desktop-spike"\nversion = "0.0.1"'}),/Missing or invalid Cargo package identity/);
});
test('rejects duplicate Cargo package sections and name/version keys', () => {
  for (const extra of ['\n[package]\n', '\nversion = "0.0.1"\n']) {
    const content = extra.startsWith('\nversion')
      ? '[package]\nname = "virgostars-desktop-spike"\nversion = "0.0.1"'+extra
      : baseline['src-tauri/Cargo.toml']+extra;
    assert.throws(() => check({'src-tauri/Cargo.toml':content}),/Cargo package identity/);
  }
});
test('rejects missing, duplicate, or inconsistent Cargo.lock root package entries', () => {
  const key='src-tauri/Cargo.lock';
  assert.throws(() => check({[key]:'[[package]]\nname = "other"\nversion = "0.0.1"'}),/exactly one/);
  assert.throws(() => check({[key]:baseline[key]+ '\n[[package]]\nname = "virgostars-desktop-spike"\nversion = "0.0.1"'}),/exactly one/);
  assert.throws(() => check({[key]:baseline[key]+'\nname = "virgostars-desktop-spike"'}),/duplicate Cargo.lock/);
});
test('build launcher runs the version gate before the first package install', () => {
  // Absolute fixtures are intentionally omitted from diagnostic messages.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const text = readFileSync(join(root,'scripts/build-windows-spike.ps1'),'utf8');
  const gate = text.indexOf("'node' @('scripts/verify-desktop-version.mjs')");
  const install = text.indexOf("'npm.cmd' @('ci')");
  assert.ok(gate > 0 && install > gate, 'version preflight must run before npm ci');
});

test('rejects npm lock top-level and installed root version drift separately', () => {
  const path = 'package-lock.json';
  for (const field of ['version', 'packages']) {
    const lock = JSON.parse(baseline[path]);
    if (field === 'version') lock.version = '0.0.2';
    else lock.packages[''].version = '0.0.2';
    assert.throws(() => check({[path]: JSON.stringify(lock)}), /mismatch/, field);
  }
});

test('rejects absent, renamed, malformed, and incompatible npm locks', () => {
  const path = 'package-lock.json';
  const invalid = [
    {version:'0.0.1',lockfileVersion:3,packages:{}},
    {name:'wrong-name',version:'0.0.1',lockfileVersion:3,
      packages:{'':{name:'virgostars-desktop',version:'0.0.1'}}},
    {name:'virgostars-desktop',version:'0.0.1',lockfileVersion:2,
      packages:{'':{name:'virgostars-desktop',version:'0.0.1'}}},
    {name:'virgostars-desktop',version:'0.0.1',lockfileVersion:3,
      packages:{'':{name:'wrong-name',version:'0.0.1'}}},
  ];
  for (const lock of invalid) {
    assert.throws(() => check({[path]: JSON.stringify(lock)}), /Invalid npm lock package identity/);
  }
  assert.throws(() => check({[path]:'{'}), /Invalid npm lock JSON/);
  assert.throws(() => check({[path]:'[]'}), /Invalid npm lock JSON/);
});

test('npm lock root version is mandatory, not inferred from top-level version', () => {
  const lock = JSON.parse(baseline['package-lock.json']);
  delete lock.packages[''].version;
  assert.throws(() => check({'package-lock.json': JSON.stringify(lock)}), /Invalid Desktop version/);
});

test('npm lock preflight bounds source and keeps private errors out of diagnostics', () => {
  assert.throws(() => check({'package-lock.json':'x'.repeat(4_000_001)}), /Invalid npm lock size/);
  assert.throws(() => verifyDesktopVersions({readText:path => {
    if (path === 'package-lock.json') throw new Error('C:\\Users\\Private\\Natal Data');
    return baseline[path];
  }}), error => /Cannot read npm lock version manifest/.test(error.message) &&
    !error.message.includes('Natal Data'));
});
