import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {snapshotAssets,restoreAssets} from '../scripts/updates/release-site-assets.mjs';

test('retain old hashed JavaScript and CSS without overwriting differing files',()=>{
  const root=mkdtempSync(join(tmpdir(),'desktop-assets-')),dist=join(root,'dist'),snap=join(root,'snapshot');
  try {
    mkdirSync(dist);writeFileSync(join(dist,'index.html'),'<script src="main-12345678.js"></script>');
    writeFileSync(join(dist,'main-12345678.js'),'previous');writeFileSync(join(dist,'styles-12345678.css'),'style');
    assert.throws(()=>snapshotAssets(dist,snap,'main-87654321.js'));
    assert.equal(snapshotAssets(dist,snap,'main-12345678.js'),2);
    rmSync(join(dist,'main-12345678.js'));writeFileSync(join(dist,'styles-12345678.css'),'changed');
    assert.throws(()=>restoreAssets(dist,snap));
    writeFileSync(join(dist,'styles-12345678.css'),'style');
    assert.equal(restoreAssets(dist,snap),2);
    assert.equal(readFileSync(join(dist,'main-12345678.js'),'utf8'),'previous');
  } finally {rmSync(root,{recursive:true,force:true});}
});
