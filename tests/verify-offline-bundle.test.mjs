import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
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

test('rejects a commented-out Angular main module even if its JS file exists',()=>run(f=>{
  const file=join(f.bundle,'index.html');
  const html=readFileSync(file,'utf8').replace(
    '<script src="main-LCL123.js" type="module"></script>',
    '<!-- <script src="main-LCL123.js" type="module"></script> -->'
  );
  writeFileSync(file,html);
  assert.throws(()=>verifyOfflineBundle(f.bundle,f.staging),/Missing or unclosed Angular script element/);
}));


test('rejects a commented-out desktop app root despite valid CSS, JavaScript and image hash',()=>run(f=>{
  const index=join(f.bundle,'index.html');
  const canonical=readFileSync(index,'utf8');
  writeFileSync(index,canonical.replace(
    '<vs-desktop-app></vs-desktop-app>',
    '<!-- <vs-desktop-app></vs-desktop-app> -->'
  ));
  assert.throws(()=>verifyOfflineBundle(f.bundle,f.staging),/not the desktop-owned app/);
}));

test('rejects a duplicated or hidden desktop app root even with valid offline assets',()=>run(f=>{
  const index=join(f.bundle,'index.html');
  const canonical=readFileSync(index,'utf8');
  for(const bad of [
    '<vs-desktop-app></vs-desktop-app><vs-desktop-app></vs-desktop-app>',
    '<template><vs-desktop-app></vs-desktop-app></template>',
    '<vs-desktop-app hidden></vs-desktop-app>'
  ]) {
    writeFileSync(index,canonical.replace('<vs-desktop-app></vs-desktop-app>',bad));
    assert.throws(()=>verifyOfflineBundle(f.bundle,f.staging),/not the desktop-owned app/);
  }
}));

test('accepts a harmless HTML comment before the real Angular body root',()=>run(f=>{
  const index=join(f.bundle,'index.html');
  const canonical=readFileSync(index,'utf8');
  writeFileSync(index,canonical.replace('<vs-desktop-app></vs-desktop-app>',
    '<!-- synthetic comment --> <vs-desktop-app></vs-desktop-app>'));
  assert.equal(verifyOfflineBundle(f.bundle,f.staging).count,1);
}));

test('verifies transitive Angular chunk imports with the exact offline asset manifest',()=>run(f=>{
  writeFileSync(join(f.bundle,'main-LCL123.js'),
    'import {a} from "./chunk-ONE.js"; console.log(a);');
  writeFileSync(join(f.bundle,'chunk-ONE.js'),
    'export {a} from "./chunk-TWO.js";');
  writeFileSync(join(f.bundle,'chunk-TWO.js'),'export const a=42;');
  const report=verifyOfflineBundle(f.bundle,f.staging);
  assert.equal(report.scripts,1);
  assert.equal(report.modules,3);
  assert.equal(report.chunks,2);
  assert.equal(report.dependencies,2);
}));

test('rejects missing lazy Angular chunk before browser packaging',()=>run(f=>{
  writeFileSync(join(f.bundle,'main-LCL123.js'),
    'const load=()=>import("./chunk-LOST.js");');
  assert.throws(()=>verifyOfflineBundle(f.bundle,f.staging),
    /Imported Angular JavaScript chunk missing/);
}));

test('rejects an orphan Angular JavaScript chunk not reachable from the entrypoint',()=>run(f=>{
  writeFileSync(join(f.bundle,'chunk-ORPHAN.js'),'export const data=1;');
  assert.throws(()=>verifyOfflineBundle(f.bundle,f.staging),
    /Unreferenced Angular JavaScript chunk/);
}));

test('rejects a missing JavaScript Worker module hidden behind import.meta.url',()=>run(f=>{
  writeFileSync(join(f.bundle,'main-LCL123.js'),
    'new Worker(new URL("./chunk-WORK-MISSING.js", import.meta.url), {type:"module"});');
  assert.throws(()=>verifyOfflineBundle(f.bundle,f.staging),
    /Imported Angular JavaScript chunk missing/);
}));

test('accepts an offline JavaScript Worker module and transitive dependency',()=>run(f=>{
  writeFileSync(join(f.bundle,'main-LCL123.js'),
    'new Worker(new URL("./chunk-WORKER.js", import.meta.url), {type:"module"});');
  writeFileSync(join(f.bundle,'chunk-WORKER.js'),
    'import "./chunk-SHARED.js";');
  writeFileSync(join(f.bundle,'chunk-SHARED.js'),
    'export const marker="synthetic";');
  const result=verifyOfflineBundle(f.bundle,f.staging);
  assert.equal(result.chunks,2);
  assert.equal(result.modules,3);
  assert.equal(result.dependencies,2);
}));

test('rejects an extensionless remote Worker URL despite a valid main script and image manifest',()=>run(f=>{
  writeFileSync(join(f.bundle,'main-LCL123.js'),
    'new Worker(new URL("https://example.invalid/remote-worker", import.meta.url), {type:"module"});');
  assert.throws(()=>verifyOfflineBundle(f.bundle,f.staging),
    /DESKTOP JS CHUNKS: Nonlocal or invalid JavaScript import/);
}));

test('rejects an image URL used as a JavaScript Worker source',()=>run(f=>{
  writeFileSync(join(f.bundle,'main-LCL123.js'),
    'new Worker(new URL("./assets/img/fictional.png", import.meta.url), {type:"module"});');
  assert.throws(()=>verifyOfflineBundle(f.bundle,f.staging),
    /DESKTOP JS CHUNKS: Unexpected JavaScript import filename/);
}));

test('rejects an oversized synthetic manifest before JSON decoding',()=>run(f=>{
  const manifest=join(f.staging,'synthetic-assets-manifest.json');
  truncateSync(manifest,8*1024*1024+1);
  assert.throws(()=>verifyOfflineBundle(f.bundle,f.staging),/manifest exceeds size budget/);
}));

test('rejects more than 2000 declared image entries before file inspection',()=>run(f=>{
  const template=f.manifest.files[0];
  f.manifest.files=Array.from({length:2001},(_,i)=>({
    ...template,path:'img/fixture-'+i+'.png',
  }));
  f.save();
  assert.throws(()=>verifyOfflineBundle(f.bundle,f.staging),/manifest exceeds file count budget/);
}));

test('rejects oversized declared asset metadata and an excessive total manifest budget',()=>run(f=>{
  const template=f.manifest.files[0];
  f.manifest.files=[{...template,bytes:20_000_001}];
  f.save();
  assert.throws(()=>verifyOfflineBundle(f.bundle,f.staging),/Invalid generated manifest entry/);
  f.manifest.files=Array.from({length:11},(_,i)=>({
    ...template,path:'img/fixture-'+i+'.png',bytes:20_000_000,
  }));
  f.save();
  assert.throws(()=>verifyOfflineBundle(f.bundle,f.staging),/assets exceed total size budget/);
}));

test('rejects a sparse, oversized emitted image before reading its body',()=>run(f=>{
  truncateSync(f.img,20_000_001);
  assert.throws(()=>verifyOfflineBundle(f.bundle,f.staging),/missing or modified asset/);
}));
