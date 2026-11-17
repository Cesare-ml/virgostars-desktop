import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

test('official VirgoStars native icon is packaged, never regenerated synthetically', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['prepare:icon'], 'node scripts/verify-brand-icon.mjs');
  assert.deepEqual(config.bundle.icon, ['icons/icon.png', 'icons/icon.ico', 'icons/icon.icns']);
  const result = spawnSync(process.execPath, ['scripts/verify-brand-icon.mjs'], {
    cwd: new URL('../', import.meta.url), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
});
