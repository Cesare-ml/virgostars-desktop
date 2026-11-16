import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyTauriSecurityConfig } from '../scripts/verify-tauri-security-config.mjs';

const baseline = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(baseline);

test('desktop MVP production frontend is a bundled local directory', () => {
  assert.equal(baseline.build.frontendDist, '../dist/desktop/browser');
  assert.equal(baseline.bundle.active, false);
  assert.deepEqual(verifyTauriSecurityConfig(clone()), { windows: 1 });
});

test('desktop MVP rejects remote production frontend URLs', () => {
  for (const url of ['https://virgostars.it', 'http://127.0.0.1:4200', 'file:///tmp/index.html']) {
    const config = clone();
    config.build.frontendDist = url;
    assert.throws(() => verifyTauriSecurityConfig(config), /packaged frontend path/);
  }
});

test('desktop MVP rejects unreviewed startup hooks', () => {
  for (const field of ['beforeBuildCommand', 'beforeDevCommand']) {
    const config = clone();
    config.build[field] = 'echo unreviewed';
    assert.throws(() => verifyTauriSecurityConfig(config));
  }
});

test('desktop MVP rejects additional windows and external capabilities', () => {
  const extraWindow = clone();
  extraWindow.app.windows.push(structuredClone(extraWindow.app.windows[0]));
  assert.throws(() => verifyTauriSecurityConfig(extraWindow));
  const capabilities = clone();
  capabilities.app.security.capabilities.push('unreviewed');
  assert.throws(() => verifyTauriSecurityConfig(capabilities));
});

test('desktop MVP keeps development origin loopback-only', () => {
  const config = clone();
  config.build.devUrl = 'http://0.0.0.0:4200';
  assert.throws(() => verifyTauriSecurityConfig(config), /loopback/);
});
