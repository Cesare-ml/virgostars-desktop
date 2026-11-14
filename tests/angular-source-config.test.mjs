import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  verifyAngularSourceConfig, verifyAngularSourceConfigCheckout,
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
