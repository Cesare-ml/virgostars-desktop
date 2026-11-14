import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageFile = new URL('../package.json', import.meta.url);
const launcherFile = new URL('../scripts/build-windows-spike.ps1', import.meta.url);
const scripts = JSON.parse(readFileSync(packageFile, 'utf8')).scripts;

const TAURI_ENTRYPOINTS = [
  'tauri:dev',
  'tauri:build',
  'tauri:build:private',
  'tauri:build:places:windows',
  'tauri:build:places:private:windows',
];

test('the version gate is a dependency-free, explicitly named npm command', () => {
  assert.equal(scripts['verify:version'], 'node scripts/verify-desktop-version.mjs');
});

test('every npm Tauri command fails closed on version drift before doing other work', () => {
  for (const name of TAURI_ENTRYPOINTS) {
    assert.equal(typeof scripts[name], 'string', name);
    assert.ok(scripts[name].startsWith('npm run verify:version && '), name);
    assert.equal((scripts[name].match(/\bverify:version\b/g) ?? []).length, 1, name);
  }
});

test('native build entrypoints retain their original offline bundle and Tauri gates', () => {
  for (const name of TAURI_ENTRYPOINTS.filter(name => name !== 'tauri:dev')) {
    assert.match(scripts[name], /npm run build:ui(?::private)? && npm run prepare:icon && tauri build/, name);
  }
  assert.match(scripts['tauri:dev'], /verify-tauri-security-config\.mjs && npm run prepare:icon && tauri dev$/);
});

test('city-catalog builds verify the version before starting a fetch or resource bundling', () => {
  for (const name of TAURI_ENTRYPOINTS.filter(name => name.includes(':places:'))) {
    const line = scripts[name];
    assert.ok(line.indexOf('verify:version') < line.indexOf('places:fetch:windows'), name);
    assert.ok(line.indexOf('places:fetch:windows') < line.indexOf('verify:places-override'), name);
    assert.match(line, /tauri build --config \.local\/places\/tauri-places\.conf\.json$/);
  }
});

test('Windows bootstrap has its own direct preflight because it bypasses the npm Tauri wrappers', () => {
  const script = readFileSync(launcherFile, 'utf8');
  const versionGate = script.indexOf("'node' @('scripts/verify-desktop-version.mjs')");
  const firstInstall = script.indexOf("'npm.cmd' @('ci')");
  const directTauriBuild = script.indexOf("'npm.cmd' @('exec', '--offline', '--', 'tauri', 'build')");
  assert.ok(versionGate > 0 && firstInstall > versionGate);
  assert.ok(directTauriBuild > firstInstall);
});
