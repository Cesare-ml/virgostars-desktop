import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, closeSync, fstatSync, lstatSync, mkdtempSync, openSync, readFileSync, readSync, renameSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseUniqueConfigJson, verifyAngularSourceConfig, verifyAngularSourceConfigCheckout,
} from '../scripts/verify-angular-source-config.mjs';

const configPath = new URL('../angular.json', import.meta.url);
const original = JSON.parse(readFileSync(configPath, 'utf8'));
const copy = () => structuredClone(original);
const invalid = config => assert.throws(() => verifyAngularSourceConfig(config), /ANGULAR SOURCE CONFIG:/);

test('reviewed Angular synthetic and private build graph matches committed config', () => {
  assert.deepEqual(verifyAngularSourceConfigCheckout(), { project: 'desktop', buildModes: 2 });
  assert.deepEqual(verifyAngularSourceConfig(copy()), { project: 'desktop', buildModes: 2 });
});

test('unreviewed scripts, dependencies and extra source files fail closed', () => {
  for (const change of [
    c => { c.projects.desktop.architect.build.options.scripts = ['https://example.invalid/payload.js']; },
    c => { c.projects.desktop.architect.build.options.styles.push('other.css'); },
    c => { c.projects.desktop.architect.build.options.externalDependencies = ['unknown-package']; },
    c => { c.projects.desktop.architect.build.options.browser = 'src/remote-main.ts'; },
    c => { c.projects.desktop.architect.build.options.index = 'other/index.html'; },
  ]) { const c = copy(); change(c); invalid(c); }
});

test('unreviewed stage roots, private substitutions, mode additions and network fonts fail closed', () => {
  for (const change of [
    c => { c.projects.desktop.architect.build.options.assets[0].input = '../private'; },
    c => { c.projects.desktop.architect.build.configurations['private-artwork'].assets.push({ glob: '**/*', input: '../private', output: '/' }); },
    c => { c.projects.desktop.architect.build.configurations['private-artwork'].fileReplacements[0].with = 'src/secrets.ts'; },
    c => { c.projects.desktop.architect.build.configurations.production = {}; },
    c => { c.projects.desktop.architect.build.options.optimization.fonts = true; },
    c => { c.projects.desktop.architect.build.options.optimization.styles.inlineCritical = true; },
    c => { c.projects.desktop.architect.build.options.outputPath = 'dist/public'; },
  ]) { const c = copy(); change(c); invalid(c); }
});

test('configuration structure and dev server cannot silently expand', () => {
  for (const change of [
    c => { c.projects.another = {}; },
    c => { c.projects.desktop.architect.test = { builder: 'unknown' }; },
    c => { c.projects.desktop.architect.serve.options.host = '0.0.0.0'; },
    c => { c.projects.desktop.architect.build.defaultConfiguration = 'private-artwork'; },
    c => { c.projects.desktop.architect.build.options.subresourceIntegrity = true; },
  ]) { const c = copy(); change(c); invalid(c); }
  invalid(null); invalid({}); invalid([]);
});

test('checkout rejects symlink and malformed or oversized configuration input', () => {
  const dir = mkdtempSync(join(tmpdir(), 'desktop-angular-config-'));
  try {
    const file = join(dir, 'angular.json');
    writeFileSync(file, '{ malformed');
    assert.throws(() => verifyAngularSourceConfigCheckout(dir));
    writeFileSync(file, ' '.repeat(65537));
    assert.throws(() => verifyAngularSourceConfigCheckout(dir), /unsafe configuration file/);
    rmSync(file);
    try {
      symlinkSync(configPath, file);
    } catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(error?.code)) throw error;
      // Windows without Developer Mode may refuse a synthetic symlink fixture.
      return;
    }
    assert.throws(() => verifyAngularSourceConfigCheckout(dir), /unsafe configuration file/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('both ordinary and private UI builds run source preflight before staging', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const script of ['build:ui', 'build:ui:private']) {
    assert.match(pkg.scripts[script], /^node scripts\/verify-angular-source-config\.mjs && npm run prepare:frontend/);
  }
});

test('browser and Tauri development commands fail closed on source drift before starting', () => {
  const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts;
  assert.equal(scripts.start,
    'node scripts/verify-angular-source-config.mjs && npm run prepare:frontend && ng serve desktop --host 127.0.0.1 --port 4200');
  assert.equal(scripts['tauri:dev'],
    'npm run verify:version && node scripts/verify-angular-source-config.mjs && node scripts/verify-tauri-security-config.mjs && npm run prepare:icon && tauri dev');
});


test('version gate remains first; catalog builds stop on source drift before fetching cities', () => {
  const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts;
  for (const name of ['tauri:dev','tauri:build:places:windows','tauri:build:places:private:windows']) {
    const command = scripts[name];
    assert.ok(command.startsWith('npm run verify:version && node scripts/verify-angular-source-config.mjs && '), name);
    assert.equal((command.match(/verify:version/g) ?? []).length, 1, name);
    assert.equal((command.match(/verify-angular-source-config/g) ?? []).length, 1, name);
  }
  for (const name of ['tauri:build:places:windows','tauri:build:places:private:windows']) {
    assert.ok(scripts[name].indexOf('verify-angular-source-config.mjs') <
      scripts[name].indexOf('places:fetch:windows'), name);
  }
});

test('manual Windows bootstrap checks Angular inputs before package installation', () => {
  const script = readFileSync(new URL('../scripts/build-windows-spike.ps1', import.meta.url), 'utf8');
  const angularGate = script.indexOf("'node' @('scripts/verify-angular-source-config.mjs')");
  const versionGate = script.indexOf("'node' @('scripts/verify-desktop-version.mjs')");
  const firstInstall = script.indexOf("'npm.cmd' @('ci')");
  assert.ok(versionGate > 0 && angularGate > versionGate && firstInstall > angularGate);
  assert.equal((script.match(/'node' @\('scripts\/verify-angular-source-config\.mjs'\)/g) ?? []).length, 1);
});


test('file swaps between lstat and open fail closed even with identical JSON content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'desktop-angular-swap-'));
  try {
    const filename = join(dir, 'angular.json');
    writeFileSync(filename, JSON.stringify(original));
    let closed = 0;
    const io = {
      lstatSync(file) {
        const before = lstatSync(file);
        renameSync(file, join(dir, 'original.json'));
        writeFileSync(file, JSON.stringify(original));
        return before;
      },
      openSync, fstatSync, readSync,
      closeSync(fd) { closed++; closeSync(fd); },
    };
    assert.throws(() => verifyAngularSourceConfigCheckout(dir, io), /configuration changed during inspection/);
    assert.equal(closed, 1, 'file descriptor closed on rejected replacement');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('file growth after metadata inspection has a bounded read and closes the descriptor', () => {
  const dir = mkdtempSync(join(tmpdir(), 'desktop-angular-growth-'));
  try {
    const filename = join(dir, 'angular.json');
    writeFileSync(filename, JSON.stringify(original));
    let closed = 0;
    const io = {
      lstatSync, openSync, readSync,
      fstatSync(fd) {
        const stat = fstatSync(fd);
        appendFileSync(filename, ' '.repeat(65537));
        return stat;
      },
      closeSync(fd) { closed++; closeSync(fd); },
    };
    assert.throws(() => verifyAngularSourceConfigCheckout(dir, io), /oversized configuration file/);
    assert.equal(closed, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('invalid UTF-8 fails closed without retaining an open descriptor', () => {
  const dir = mkdtempSync(join(tmpdir(), 'desktop-angular-utf8-'));
  try {
    writeFileSync(join(dir, 'angular.json'), Buffer.from([0xff, 0xfe, 0x00]));
    assert.throws(() => verifyAngularSourceConfigCheckout(dir), /encoded data|valid for encoding/i);
    writeFileSync(join(dir, 'angular.json'), JSON.stringify(original));
    assert.deepEqual(verifyAngularSourceConfigCheckout(dir), { project: 'desktop', buildModes: 2 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('duplicate JSON object keys fail closed, including escaped aliases', () => {
  const fixtures = [
    '{"projects":{},"projects":{}}',
    '{"projects":{},"pro\\u006aects":{}}',
    '{"a":{"key":0,"key":1}}',
    '[{"x":1,"x":1}]',
  ];
  for (const source of fixtures) {
    assert.throws(() => parseUniqueConfigJson(source), /duplicate JSON object key/, source);
  }
});

test('duplicate-key scan respects string delimiters and independent object scopes', () => {
  const source = JSON.stringify({a:{key:'a string with \"quoted\" : { braces }', next:1},b:{key:2}});
  assert.deepEqual(parseUniqueConfigJson(source), JSON.parse(source));
  const compact = JSON.stringify(original);
  const formatted = JSON.stringify(original, null, 4) + '\n';
  assert.deepEqual(verifyAngularSourceConfig(parseUniqueConfigJson(compact)),
    { project: 'desktop', buildModes: 2 });
  assert.deepEqual(verifyAngularSourceConfig(parseUniqueConfigJson(formatted)),
    { project: 'desktop', buildModes: 2 });
});

test('checkout rejects duplicate keys even when final parsed config matches review', () => {
  const dir = mkdtempSync(join(tmpdir(), 'desktop-angular-duplicates-'));
  try {
    const file = join(dir, 'angular.json');
    const source = JSON.stringify(original);
    const duplicate = source.replace('"version":1', '"version":123,"version":1');
    assert.notEqual(duplicate, source);
    assert.deepEqual(JSON.parse(duplicate), JSON.parse(source));
    writeFileSync(file, duplicate);
    assert.throws(() => verifyAngularSourceConfigCheckout(dir), /duplicate JSON object key/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
