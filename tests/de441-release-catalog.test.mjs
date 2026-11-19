import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { RELEASE_CATALOG_NAME, RELEASE_CATALOG_SHA256 } from '../scripts/ephemeris/release-catalog.mjs';

test('reviewed release catalog pins the base and reuses published Mobile data', () => {
  const bytes = readFileSync(new URL(`../src-tauri/${RELEASE_CATALOG_NAME}`, import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), RELEASE_CATALOG_SHA256);
  const catalog = JSON.parse(bytes);
  assert.equal(catalog.releaseTag, 'de441-desktop-v1.0.0');
  assert.equal(catalog.packs.length, 145);
  const base = catalog.packs.filter(pack => pack.required);
  assert.equal(base.length, 1);
  assert.deepEqual([base[0].firstYear, base[0].lastYear], [1000, 2200]);
  assert.equal(base[0].sha256, '72ee04b5ee048320ae3198f9f70d02e03aef2229260ade0bc2404efe7a744f32');
  const reused = catalog.packs.filter(pack => pack.releaseTag);
  assert.deepEqual(reused.map(pack => pack.firstYear), [0, 200, 400, 600, 800]);
  assert.ok(reused.every(pack => pack.releaseTag === 'de441-mobile-v1.0.0'));
  assert.ok(catalog.packs.every((pack, i) => i === 0 || pack.startJdTdb === catalog.packs[i - 1].endJdTdb));
});
