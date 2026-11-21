import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {hasFixedDesktopHost,hasPinnedWorkspace,verifyMacResponsiveBundle}
  from '../scripts/mac/verify-responsive-bundle.mjs';

const host='*{box-sizing:border-box}vs-desktop-app{display:block;position:fixed;inset:0;min-width:0;min-height:0}';
const stage='.desktop-app[_ngcontent-%COMP%]{display:grid;grid-template-rows:minmax(0,1fr)}'+
  '.workspace[_ngcontent-%COMP%]{--nav-width:208px;position:absolute;inset:0;width:100%;height:100%;display:grid;grid-template-columns:208px 1fr}'+
  '.chart-stage[_ngcontent-%COMP%]{flex:1;display:grid;place-items:center}';

function fixture(check) {
  const dir=mkdtempSync(join(tmpdir(),'vs-macos-responsive-'));
  try {
    writeFileSync(join(dir,'index.html'),'<html><head><link rel="stylesheet" href="styles-A.css"></head><body><vs-desktop-app></vs-desktop-app></body></html>');
    writeFileSync(join(dir,'styles-A.css'),host);
    writeFileSync(join(dir,'main-A.js'),'const styles='+JSON.stringify(stage));
    check(dir);
  } finally {rmSync(dir,{recursive:true,force:true});}
}
test('the committed viewport and workspace rules survive the source-layout check',()=>{
  assert.equal(hasFixedDesktopHost(readFileSync(new URL('../src/styles.css',import.meta.url),'utf8')),true);
  assert.equal(hasPinnedWorkspace(readFileSync(new URL('../src/app/desktop-app.component.css',import.meta.url),'utf8')),true);
});
test('a normal Angular build embeds full viewport styles',()=>fixture(dir=>{
  assert.equal(verifyMacResponsiveBundle(dir).stylesheets,1);
}));
test('a missing viewport anchor or bottom-half workspace is a release blocker',()=>fixture(dir=>{
  writeFileSync(join(dir,'styles-A.css'),host.replace('position:fixed','position:static'));
  assert.throws(()=>verifyMacResponsiveBundle(dir),/fixed viewport host/);
  writeFileSync(join(dir,'styles-A.css'),host);
  writeFileSync(join(dir,'main-A.js'),stage.replace('position:absolute','position:relative'));
  assert.throws(()=>verifyMacResponsiveBundle(dir),/workspace lost full-viewport geometry/);
}));
test('a later symlink fails even after finding valid Angular styles',()=>fixture(dir=>{
  symlinkSync(join(dir,'main-A.js'),join(dir,'chunk-B.js'));
  assert.throws(()=>verifyMacResponsiveBundle(dir),/unsafe or oversized/);
}));
test('an unsupported partial anchored rule is not accepted',()=>{
  assert.equal(hasFixedDesktopHost('vs-desktop-app{display:block;position:fixed}'),false);
  assert.equal(hasPinnedWorkspace('.workspace{display:grid;position:absolute;inset:0;height:100%}'),false);
});
