import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const { scripts } = manifest;

test('both offline bundle variants perform manifest and privacy audit in order', () => {
  assert.equal(scripts['verify:bundle'], 'node scripts/verify-offline-bundle.mjs && npm run verify:privacy');
  assert.equal(scripts['verify:bundle:private'], 'node scripts/verify-offline-bundle.mjs --private && npm run verify:privacy');
  assert.equal(scripts['verify:privacy'], 'node scripts/verify-build-privacy.mjs');
});

test('public-synthetic and authorized-private Angular builds include their bundle gates', () => {
  assert.match(scripts['build:ui'], /ng build desktop && npm run verify:bundle$/);
  assert.match(scripts['build:ui:private'], /ng build desktop --configuration private-artwork && npm run verify:bundle:private$/);
  assert.match(scripts['tauri:build'], /npm run build:ui &&/);
  assert.match(scripts['tauri:build:private'], /npm run build:ui:private &&/);
});

test('local test command includes every packaging regression test', () => {
  assert.match(scripts.test, /node .*--test tests\/\*\.test\.mjs/);
  for (const file of [
    '../tests/desktop-packaging-integration.test.mjs',
    '../tests/document-base.test.mjs',
    '../tests/verify-offline-bundle.test.mjs',
    '../tests/private-assets.test.mjs'
  ]) {
    assert.ok(readFileSync(new URL(file, import.meta.url), 'utf8').includes("test('"));
  }
});
