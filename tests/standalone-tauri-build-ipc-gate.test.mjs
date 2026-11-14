import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts;
const nativeGate = 'npm run verify:ipc';

function expectStandaloneBuild(command, uiBuild) {
  assert.equal(typeof command, 'string');
  assert.deepEqual(command.split(' && '), [
    'npm run verify:version',
    nativeGate,
    uiBuild,
    'npm run prepare:icon',
    'tauri build',
  ]);
}

test('normal synthetic Tauri build audits native IPC before rebuilding Angular', () => {
  assert.equal(scripts['verify:ipc'], 'node scripts/verify-native-ipc.mjs');
  expectStandaloneBuild(scripts['tauri:build'], 'npm run build:ui');
});

test('private-artwork Tauri build uses the same native audit before packaging', () => {
  expectStandaloneBuild(scripts['tauri:build:private'], 'npm run build:ui:private');
});

test('city-enabled Windows Tauri builds retain their independent IPC and override gates', () => {
  for (const [command, uiBuild] of [
    ['tauri:build:places:windows', 'npm run build:ui'],
    ['tauri:build:places:private:windows', 'npm run build:ui:private'],
  ]) {
    const stages = scripts[command].split(' && ');
    const native = stages.indexOf(nativeGate);
    const override = stages.indexOf('npm run verify:places-override');
    const ui = stages.indexOf(uiBuild);
    const build = stages.indexOf('tauri build --config .local/places/tauri-places.conf.json');
    assert.ok(native >= 0 && override === native + 1 && ui === override + 1 &&
      build === stages.length - 1 && ui < build, command);
  }
});

test('native IPC cannot silently disappear or move after Tauri compilation', () => {
  const original = scripts['tauri:build'];
  for (const mutated of [
    original.replace(nativeGate + ' && ', ''),
    original.replace(nativeGate + ' && ', '') + ' && ' + nativeGate,
    original.replace(nativeGate, 'npm run verify:css'),
  ]) {
    assert.throws(() => expectStandaloneBuild(mutated, 'npm run build:ui'));
  }
});

test('Windows spike bootstrap retains its separate single-build native IPC audit', () => {
  const bootstrap = readFileSync(new URL('../scripts/build-windows-spike.ps1', import.meta.url), 'utf8');
  const audit = bootstrap.indexOf("'run', 'verify:ipc'");
  const ui = bootstrap.indexOf("'run', 'build:ui'");
  const nativeBuild = bootstrap.indexOf("'exec', '--offline', '--', 'tauri', 'build'");
  assert.ok(audit >= 0 && ui > audit && nativeBuild > ui);
  assert.doesNotMatch(bootstrap, /'run', 'tauri:build'/);
});
