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
  writeFileSync(join(bundle,'index.html'),'<html><head><base href="/"><link rel="stylesheet" href="styles-LOCAL123.css"></head><body><vs-desktop-app></vs-desktop-app><script src="main-LCL123.js" type="module"></script></body></html>');
  writeFileSync(join(bundle,'styles-LOCAL123.css'),':root{font-family:system-ui}*{box-sizing:border-box}vs-desktop-app{height:100%}');
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
  const result = verifyOfflineBundle(f.bundle,f.staging);
  assert.equal(result.count,1);
  assert.equal(result.stylesheets,1);
  assert.equal(result.scripts,1);
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

test('rejects missing stylesheet link even when scripts and images are present',()=>run(f=>{
  const index=join(f.bundle,'index.html');
  writeFileSync(index,readFileSync(index,'utf8').replace(/<link rel="stylesheet"[^>]*>/,''));
  assert.throws(()=>verifyOfflineBundle(f.bundle,f.staging),/no linked stylesheet/);
}));
test('rejects CSS link when the bundled stylesheet itself is absent',()=>run(f=>{
  const css=join(f.bundle,'styles-LOCAL123.css');
  rmSync(css);
  assert.throws(()=>verifyOfflineBundle(f.bundle,f.staging),/stylesheet missing/);
}));
test('rejects incomplete stylesheet rather than shipping an unstyled chart',()=>run(f=>{
  writeFileSync(join(f.bundle,'styles-LOCAL123.css'),'body{color:red}');
  assert.throws(()=>verifyOfflineBundle(f.bundle,f.staging),/Global stylesheet is incomplete/);
}));
test('rejects remotely hosted CSS without allowing stylesheet network fallback',()=>run(f=>{
  const index=join(f.bundle,'index.html');
  writeFileSync(index,readFileSync(index,'utf8').replace('href="styles-LOCAL123.css"','href="https://example.invalid/desktop.css"'));
  assert.throws(()=>verifyOfflineBundle(f.bundle,f.staging),/external script or stylesheet/);
}));

test('rejects Angular critical-CSS print/onload pattern blocked by strict Tauri CSP',()=>run(f=>{
  const index=join(f.bundle,'index.html');
  const html=readFileSync(index,'utf8').replace(
    '<link rel="stylesheet" href="styles-LOCAL123.css">',
    '<link rel="stylesheet" href="styles-LOCAL123.css" media="print" onload="this.media=\'all\'">'
  );
  writeFileSync(index,html);
  assert.throws(()=>verifyOfflineBundle(f.bundle,f.staging),/Inline stylesheet event handler/);
}));

test('rejects print-only CSS even without an inline handler',()=>run(f=>{
  const index=join(f.bundle,'index.html');
  const html=readFileSync(index,'utf8').replace(
    '<link rel="stylesheet" href="styles-LOCAL123.css">',
    '<link rel="stylesheet" href="styles-LOCAL123.css" media="print">'
  );
  writeFileSync(index,html);
  assert.throws(()=>verifyOfflineBundle(f.bundle,f.staging),/Deferred or print-only stylesheet/);
}));

test('rejects other inline stylesheet event handlers without disabling CSP',()=>run(f=>{
  const index=join(f.bundle,'index.html');
  const html=readFileSync(index,'utf8').replace(
    '<link rel="stylesheet" href="styles-LOCAL123.css">',
    '<link rel="stylesheet" href="styles-LOCAL123.css" onerror="alert(1)">'
  );
  writeFileSync(index,html);
  assert.throws(()=>verifyOfflineBundle(f.bundle,f.staging),/Inline stylesheet event handler/);
}));

test('screen stylesheet without inline event handler remains valid',()=>run(f=>{
  const index=join(f.bundle,'index.html');
  const html=readFileSync(index,'utf8').replace(
    '<link rel="stylesheet" href="styles-LOCAL123.css">',
    '<link rel="stylesheet" href="styles-LOCAL123.css" media="screen">'
  );
  writeFileSync(index,html);
  assert.equal(verifyOfflineBundle(f.bundle,f.staging).stylesheets,1);
}));


test('rejects missing or hijacked HTML base before checking packaged CSS and assets',()=>run(f=>{
  const index=join(f.bundle,'index.html');
  const canonical=readFileSync(index,'utf8');
  for(const bad of ['', '<base href="https://example.invalid/">',
                    '<base href="/assets/">', '<base href="/"><base href="/">']) {
    writeFileSync(index, canonical.replace('<base href="/">', bad));
    assert.throws(()=>verifyOfflineBundle(f.bundle,f.staging),/DESKTOP BASE HREF/);
  }
}));

test('rejects inert document base in HTML comment or template',()=>run(f=>{
  const index=join(f.bundle,'index.html');
  const canonical=readFileSync(index,'utf8');
  for(const inert of ['<!-- <base href="/"> -->',
                      '<template><base href="/"></template>',
                      '<noscript><base href="/"></noscript>']) {
    writeFileSync(index,canonical.replace('<base href="/">',inert));
    assert.throws(()=>verifyOfflineBundle(f.bundle,f.staging),/DESKTOP BASE HREF/);
  }
  // An irrelevant commented-out base must not invalidate the real one.
  writeFileSync(index,canonical.replace('<base href="/">','<!-- <base href="/wrong/"> --><base href="/">'));
  assert.equal(verifyOfflineBundle(f.bundle,f.staging).count,1);
}));


test('rejects a missing local Angular main script with valid base, CSS and synthetic assets',()=>run(f=>{
  rmSync(join(f.bundle,'main-LCL123.js'));
  assert.throws(()=>verifyOfflineBundle(f.bundle,f.staging),/Local desktop script missing/);
}));
test('rejects a fake CSS link in a comment even when main script and base are valid',()=>run(f=>{
  const file=join(f.bundle,'index.html');
  const html=readFileSync(file,'utf8').replace('<link rel="stylesheet" href="styles-LOCAL123.css">',
    '<!-- <link rel="stylesheet" href="styles-LOCAL123.css"> -->');
  writeFileSync(file,html);
  assert.throws(()=>verifyOfflineBundle(f.bundle,f.staging),/no linked stylesheet/);
}));
test('rejects an inactive stylesheet in a valid local Angular bundle',()=>run(f=>{
  const file=join(f.bundle,'index.html');
  const html=readFileSync(file,'utf8').replace('rel="stylesheet" href="styles-LOCAL123.css"',
    'rel="stylesheet" href="styles-LOCAL123.css" disabled');
  writeFileSync(file,html);
  assert.throws(()=>verifyOfflineBundle(f.bundle,f.staging),/Disabled stylesheet/);
}));
