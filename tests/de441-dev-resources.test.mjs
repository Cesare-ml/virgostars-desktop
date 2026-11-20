import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyDevResources} from '../scripts/ephemeris/dev-resources.mjs';
import {RELEASE_CATALOG_NAME} from '../scripts/ephemeris/release-catalog.mjs';

test('development resources require a pinned catalog and its exact base', () => {
  const root = mkdtempSync(join(tmpdir(), 'vs-de441-dev-'));
  try {
    assert.equal(verifyDevResources(root), false);
    const dir = join(root, 'ephemeris');
    mkdirSync(dir);
    const bytes = Buffer.from('synthetic base');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const catalog = Buffer.from(JSON.stringify({packs:[{id:'desktop-core-1000-2200',required:true,bytes:bytes.length,sha256}]}));
    const pin = createHash('sha256').update(catalog).digest('hex');
    writeFileSync(join(dir, 'de441-slice.eph'), bytes);
    writeFileSync(join(dir, RELEASE_CATALOG_NAME), catalog);
    assert.equal(verifyDevResources(root, pin), true);
    assert.throws(() => verifyDevResources(root, '0'.repeat(64)), /catalog/);
    writeFileSync(join(dir, 'de441-slice.eph'), Buffer.from('synthetic basE'));
    assert.throws(() => verifyDevResources(root, pin), /hash mismatch/);
    writeFileSync(join(dir, 'de441-slice.eph'), Buffer.from('short'));
    assert.throws(() => verifyDevResources(root, pin), /base does not match/);
  } finally { rmSync(root, {recursive:true, force:true}); }
});
