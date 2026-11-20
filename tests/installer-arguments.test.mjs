import test from 'node:test';
import assert from 'node:assert/strict';
import {installerArguments} from '../scripts/ephemeris/installer-arguments.mjs';

test('signed installer retains all required resources and the updater overlay', () => {
  const plain = installerArguments();
  const signed = installerArguments(['--config', '.local/updater/tauri-release.conf.json']);
  assert.deepEqual(signed, [...plain, '--config', '.local/updater/tauri-release.conf.json']);
  for (const required of ['.local/places/tauri-places.conf.json', '.local/ephemeris/tauri-ephemeris.conf.json', '.local/release-licenses/tauri-license.conf.json']) {
    assert.ok(signed.includes(required));
  }
  assert.throws(() => installerArguments(['--config', 'other.json']), /Unsupported/);
  assert.throws(() => installerArguments(['--no-bundle']), /Unsupported/);
});
