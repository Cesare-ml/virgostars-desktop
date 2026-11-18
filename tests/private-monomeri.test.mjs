import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('private build disables missing corpus and rejects a modified corpus', () => {
  const root = mkdtempSync(join(tmpdir(),'vs-monomeri-'));
  try {
    mkdirSync(join(root,'scripts')); mkdirSync(join(root,'.local'));
    copyFileSync(new URL('../scripts/prepare-private-monomeri.mjs',import.meta.url),join(root,'scripts','prepare-private-monomeri.mjs'));
    const run = () => spawnSync(process.execPath,[join(root,'scripts','prepare-private-monomeri.mjs')],{encoding:'utf8'});
    assert.equal(run().status,0);
    assert.match(readFileSync(join(root,'.local','monomeri-data.private.ts'),'utf8'),/\[\]/);
    writeFileSync(join(root,'.local','monomeri.json'),JSON.stringify(Array(360).fill('fictional')));
    assert.notEqual(run().status,0);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
