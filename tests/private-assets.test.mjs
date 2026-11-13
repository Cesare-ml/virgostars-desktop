import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {preparePrivateAssets, validatePrivateManifest} from '../scripts/prepare-private-assets.mjs';
import {verifyOfflineBundle} from '../scripts/verify-offline-bundle.mjs';

const hash = b=>createHash('sha256').update(b).digest('hex');
function fixture() {
  const root=mkdtempSync(join(tmpdir(),'private-pack-test-'));
  const source=join(root,'source'), stage=join(root,'stage'), bundle=join(root,'bundle');
  for(const folder of ['manifests','catalog','public/assets/img']) mkdirSync(join(source,folder),{recursive:true});
  const data=Buffer.from('synthetic test image');
  const approval={path:'img/example.png',status:'approved',rightsHolder:'Test',permissionBasis:'Fixture only',approvalEvidence:'Synthetic fixture'};
  const manifest={schemaVersion:1,source:{repository:'Cesare-ml/virgo-stars',commit:'a'.repeat(40),assetRoot:'public/assets'},assets:[{...approval,bytes:data.length,sha256:hash(data)}]};
  const bytes=Buffer.from(JSON.stringify(manifest));
  writeFileSync(join(source,'manifests/approved-assets.json'),bytes);
  writeFileSync(join(source,'catalog/approvals.json'),JSON.stringify({schemaVersion:1,assets:[approval]}));
  writeFileSync(join(source,'public/assets/img/example.png'),data);
  return {root,source,stage,bundle,manifest,approval,bytes,data,expected:hash(bytes),clean:()=>rmSync(root,{recursive:true,force:true})};
}
function run(fn) {const f=fixture();try{fn(f);}finally{f.clean();}}

test('stages only approved pinned images and verifies the private bundle',()=>run(f=>{
  assert.deepEqual(preparePrivateAssets(f.source,f.stage,f.expected),{count:1,reused:false});
  assert.equal(preparePrivateAssets(f.source,f.stage,f.expected).reused,true);
  mkdirSync(join(f.bundle,'assets/img'),{recursive:true});
  writeFileSync(join(f.bundle,'assets/img/example.png'),f.data);
  writeFileSync(join(f.bundle,'index.html'),'<html><head><base href="/"><link rel="stylesheet" href="styles.css"></head><body><vs-desktop-app></vs-desktop-app><script src="main-LOCAL.js" type="module"></script></body></html>');
  writeFileSync(join(f.bundle,'styles.css'),'*{box-sizing:border-box}vs-desktop-app{display:block}');
  writeFileSync(join(f.bundle,'main-LOCAL.js'),'/* private-mode fixture: no account data */');
  assert.equal(verifyOfflineBundle(f.bundle,f.stage,{privateMode:true,expectedPrivateHash:f.expected}).count,1);
  writeFileSync(join(f.bundle,'assets/img/example.png'),'changed');
  assert.throws(()=>verifyOfflineBundle(f.bundle,f.stage,{privateMode:true,expectedPrivateHash:f.expected}),/missing or modified asset/);
}));

test('rejects changed pack bytes, absent approval and an unpinned manifest',()=>run(f=>{
  assert.throws(()=>preparePrivateAssets(f.source,f.stage,'0'.repeat(64)),/manifest checksum/);
  f.approval.status='pending';
  writeFileSync(join(f.source,'catalog/approvals.json'),JSON.stringify({schemaVersion:1,assets:[f.approval]}));
  assert.throws(()=>preparePrivateAssets(f.source,f.stage,f.expected),/approval does not match/);
  f.approval.status='approved';
  writeFileSync(join(f.source,'catalog/approvals.json'),JSON.stringify({schemaVersion:1,assets:[f.approval]}));
  writeFileSync(join(f.source,'public/assets/img/example.png'),'modified');
  assert.throws(()=>preparePrivateAssets(f.source,f.stage,f.expected),/checksum mismatch/);
}));

test('rejects altered staged images and extra staged files',()=>run(f=>{
  preparePrivateAssets(f.source,f.stage,f.expected);
  writeFileSync(join(f.stage,'assets/img/extra.png'),'extra');
  assert.throws(()=>preparePrivateAssets(f.source,f.stage,f.expected),/unexpected or missing files/);
  rmSync(join(f.stage,'assets/img/extra.png'));
  writeFileSync(join(f.stage,'assets/img/example.png'),'changed');
  assert.throws(()=>preparePrivateAssets(f.source,f.stage,f.expected),/stage is modified/);
}));

test('pins the same manifest across Windows and Unix line endings',()=>run(f=>{
  const lf=Buffer.from(JSON.stringify(f.manifest,null,2)+'\n');
  const crlf=Buffer.from(lf.toString('utf8').replace(/\n/g,'\r\n'));
  assert.deepEqual(validatePrivateManifest(crlf,hash(lf)),f.manifest);
}));
