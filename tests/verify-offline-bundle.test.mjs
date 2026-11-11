import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {verifyOfflineBundle} from '../scripts/verify-offline-bundle.mjs';

function fixture() {
  const root=mkdtempSync(join(tmpdir(),'virgostars-verify-bundle-'));
  const bundle=join(root,'dist/desktop/browser'), staging=join(root,'.local/frontend');
  const img=join(bundle,'assets/img/a.png');
  const data=Buffer.from('synthetic generated fixture');
  mkdirSync(dirname(img),{recursive:true});mkdirSync(staging,{recursive:true});
  writeFileSync(img,data);
  writeFileSync(join(bundle,'index.html'),'<html><head><base href="/"></head><body><vs-desktop-app></vs-desktop-app><script src="main-LCL123.js" type="module"></script></body></html>');
  writeFileSync(join(bundle,'main-LCL123.js'),'console.log("local-only")');
  const manifest={schemaVersion:1,source:{repository:'synthetic-local-fixtures',commit:'none'},files:[{
    path:'img/a.png',bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')
  }]};
  const save=()=>writeFileSync(join(staging,'synthetic-assets-manifest.json'),JSON.stringify(manifest));
  save();
  return {root,bundle,staging,img,data,manifest,save,clean:()=>rmSync(root,{recursive:true,force:true})};
}
const run=f=>{const x=fixture();try{f(x);}finally{x.clean();}};

test('verifies a desktop Angular build with exact synthetic assets',()=>run(f=>{
  assert.equal(verifyOfflineBundle(f.bundle,f.staging).count,1);
}));
test('detects tampered image in Angular output',()=>run(f=>{
  writeFileSync(f.img,'bad');
  assert.throws(()=>verifyOfflineBundle(f.bundle,f.staging),/missing or modified asset/);
}));
test('detects unexpected image (never silently ship private extras)',()=>run(f=>{
  writeFileSync(join(dirname(f.img),'private.png'),Buffer.from('not approved'));
  assert.throws(()=>verifyOfflineBundle(f.bundle,f.staging),/unexpected or missing assets/);
}));
test('rejects wrong frontend entrypoint and external scripts',()=>run(f=>{
  const index=join(f.bundle,'index.html');
  writeFileSync(index,'<html><body><chart-demo></chart-demo></body></html>');
  assert.throws(()=>verifyOfflineBundle(f.bundle,f.staging),/not the desktop-owned app/);
  writeFileSync(index,'<vs-desktop-app></vs-desktop-app><script src="https://evil.test/a.js"></script>');
  assert.throws(()=>verifyOfflineBundle(f.bundle,f.staging),/external script or stylesheet/);
}));
test('rejects accidentally embedded demo bootstrap',()=>run(f=>{
  const index=join(f.bundle,'index.html');
  writeFileSync(index,readFileSync(index,'utf8')+'desktop-assets-bootstrap.js');
  assert.throws(()=>verifyOfflineBundle(f.bundle,f.staging),/Legacy demo bootstrap/);
}));
