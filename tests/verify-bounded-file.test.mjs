import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, rmSync, writeFileSync, symlinkSync, truncateSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readBoundedBuildFile, hashBoundedBuildFile} from '../scripts/verify-bounded-file.mjs';

const run = callback => {
  const dir = mkdtempSync(join(tmpdir(), 'vs-bounded-read-'));
  try { callback(dir); } finally { rmSync(dir, {recursive:true, force:true}); }
};

test('read stable binary manifest and stream a correct image digest', () => run(dir => {
  const path = join(dir,'safe.bin');
  const data = Buffer.alloc(130_011, 0x3f);
  writeFileSync(path, data);
  assert.deepEqual(readBoundedBuildFile(path, 140_000), data);
  assert.equal(hashBoundedBuildFile(path,data.length,140_000), createHash('sha256').update(data).digest('hex'));
}));

test('empty image can be hashed without a data read', () => run(dir => {
  const path = join(dir,'empty.png');writeFileSync(path, '');
  assert.equal(hashBoundedBuildFile(path,0,100),createHash('sha256').update('').digest('hex'));
  assert.deepEqual(readBoundedBuildFile(path,100),Buffer.alloc(0));
}));

test('reject mismatching size and oversized sparse file before reading', () => run(dir => {
  const path = join(dir,'image.png');writeFileSync(path,'image');
  assert.throws(() => hashBoundedBuildFile(path,4,5),/Unsafe or changed/);
  truncateSync(path,200_000_000);
  assert.throws(() => hashBoundedBuildFile(path,200_000_000,1000),/Unsafe or changed/);
  assert.throws(() => readBoundedBuildFile(path,1000),/Unsafe or changed/);
}));

test('refuse symbolic links rather than hashing their target', () => run(dir => {
  const target=join(dir,'target');writeFileSync(target,'not approved');
  const link=join(dir,'link');symlinkSync(target,link);
  assert.throws(() => readBoundedBuildFile(link,100),/Unsafe or changed/);
  assert.throws(() => hashBoundedBuildFile(link,12,100),/Unsafe or changed/);
}));

test('reject missing files and invalid byte budgets without disclosing local path', () => run(dir => {
  const path=join(dir,'secret-birthdata-database');
  for (const action of [
    () => readBoundedBuildFile(path,100),
    () => readBoundedBuildFile(path,-1),
    () => hashBoundedBuildFile(path,3,2),
  ]) {
    assert.throws(action, error => {
      assert.match(error.message,/Unsafe or changed/);
      assert.doesNotMatch(error.message,/secret-birthdata/);
      return true;
    });
  }
}));
