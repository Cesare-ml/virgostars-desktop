import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  verifyProductionCsp, verifyTauriSecurityConfig, verifyTauriSecurityCheckout,
} from '../scripts/verify-tauri-security-config.mjs';

const original = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(original);

test('committed production Tauri config meets the offline security gate', () => {
  assert.deepEqual(verifyTauriSecurityCheckout(), { windows: original.app.windows.length });
  assert.equal(verifyProductionCsp(original.app.security.csp).directives, 9);
});

test('dev-only allowances do not change packaged production CSP validation', () => {
  const config = copy();
  config.app.security.devCsp += "; script-src 'unsafe-eval'";
  assert.equal(verifyTauriSecurityConfig(config).windows, 1);
});

test('production CSP rejects remote origins, eval, data scripts and extra directives', () => {
  for (const [directive, variant] of [
    ['script-src', "script-src 'self' https://example.invalid"],
    ['script-src', "script-src 'self' 'unsafe-eval'"],
    ['script-src', "script-src 'self' data:"],
    ['connect-src', "connect-src 'self' https://api.example.invalid"],
    ['img-src', "img-src 'self' data: blob: https://example.invalid"],
    ['default-src', 'default-src *'],
  ]) {
    const config = copy();
    config.app.security.csp = config.app.security.csp.replace(
      new RegExp(directive + ' [^;]+'), variant,
    );
    assert.throws(() => verifyTauriSecurityConfig(config), /CSP source list changed/, variant);
  }
  const config = copy();
  config.app.security.csp += '; script-src-elem https://example.invalid';
  assert.throws(() => verifyTauriSecurityConfig(config), /unreviewed CSP directive/);
});

test('CSP rejects duplicate, missing and empty directives rather than falling back', () => {
  for (const csp of [
    original.app.security.csp + "; script-src 'self'",
    original.app.security.csp.replace(/connect-src 'self'; ?/, ''),
    '', null, {},
  ]) {
    assert.throws(() => verifyProductionCsp(csp), /TAURI SECURITY CONFIG:/);
  }
});

test('packaged windows may not redirect to a website or use a different frontend root', () => {
  for (const change of [
    config => { config.app.windows[0].url = 'https://example.invalid'; },
    config => { config.app.windows = []; },
    config => { config.build.frontendDist = 'https://example.invalid'; },
    config => { config.build.beforeBuildCommand = 'npm run fetch'; },
  ]) {
    const config = copy(); change(config);
    assert.throws(() => verifyTauriSecurityConfig(config), /TAURI SECURITY CONFIG:/);
  }
});

test('permission expansion and enabling installer packaging require review', () => {
  for (const change of [
    config => { config.app.security.capabilities = ['fs:default']; },
    config => { config.app.withGlobalTauri = true; },
    config => { config.app.security.dangerousDisableAssetCspModification = true; },
    config => { config.app.security.assetProtocol = {enable:true}; },
    config => { config.bundle.active = true; },
  ]) {
    const config = copy(); change(config);
    assert.throws(() => verifyTauriSecurityConfig(config), /TAURI SECURITY CONFIG:/);
  }
});
