import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const scripts = pkg.scripts;
const common = [
  'npm run places:fetch:windows',
  'py -3 scripts/places/prepare_tauri_bundle.py',
  'npm run verify:ipc',
  'npm run verify:places-override'
];
const afterBuild = [
  'npm run prepare:icon',
  'tauri build --config .local/places/tauri-places.conf.json'
];

test('Windows city build checks IPC and resource override before synthetic UI and Tauri packaging', () => {
  assert.deepEqual(scripts['tauri:build:places:windows'].split(' && '),
    [...common, 'npm run build:ui', ...afterBuild]);
});

test('Windows private city build uses same native checks before approved private UI packaging', () => {
  assert.deepEqual(scripts['tauri:build:places:private:windows'].split(' && '),
    [...common, 'npm run build:ui:private', ...afterBuild]);
});

test('both city builds inherit offline HTML/CSS/JS and privacy checks via UI build chain', () => {
  assert.equal(scripts['verify:ipc'], 'node scripts/verify-native-ipc.mjs');
  assert.equal(scripts['verify:places-override'], 'node scripts/verify-places-tauri-override.mjs');
  assert.equal(scripts['verify:privacy'], 'node scripts/verify-build-privacy.mjs');
  const securityGate = 'node scripts/verify-tauri-security-config.mjs';
  assert.deepEqual(scripts['verify:bundle'].split(' && '), [
    'node scripts/verify-offline-bundle.mjs',
    'npm run verify:privacy',
    securityGate,
  ]);
  assert.deepEqual(scripts['verify:bundle:private'].split(' && '), [
    'node scripts/verify-offline-bundle.mjs --private',
    'npm run verify:privacy',
    securityGate,
  ]);
  assert.match(scripts['build:ui'], /ng build desktop && npm run verify:bundle$/);
  assert.match(scripts['build:ui:private'], /ng build desktop --configuration private-artwork && npm run verify:bundle:private$/);
});
