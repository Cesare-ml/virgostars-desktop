import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hasDesktopComponentLayout, hasDesktopLayoutOverride, inspectDesktopComponentStyles} from '../scripts/verify-component-styles.mjs';

const COMPONENT_CSS = '.desktop-app[_ngcontent-%COMP%]{display:grid;grid-template-rows:60px minmax(0,1fr)}' +
  '.workspace[_ngcontent-%COMP%]{display:grid;grid-template-columns:208px minmax(0,1fr) 316px}' +
  '.chart-stage[_ngcontent-%COMP%]{position:relative;flex:1;min-height:0;display:grid;place-items:center}';
const GLOBAL_CSS = ':root{color-scheme:light}vs-desktop-app{height:100%}*{box-sizing:border-box}';

function fixture(run) {
  const root=mkdtempSync(join(tmpdir(),'vs-compiled-layout-'));
  try { run(root); } finally { rmSync(root,{recursive:true,force:true}); }
}

test('recognizes committed source component layout in addition to compiled Angular selectors',()=>{
  const tracked=readFileSync(new URL('../src/app/desktop-app.component.css',import.meta.url),'utf8');
  assert.equal(hasDesktopComponentLayout(tracked),true);
  assert.equal(hasDesktopComponentLayout(COMPONENT_CSS),true);
});
test('accepts component CSS emitted in a local Angular JS chunk, without a remote stylesheet',()=>fixture(root=>{
  writeFileSync(join(root,'styles-ABC.css'),GLOBAL_CSS);
  writeFileSync(join(root,'main-ABC.js'),'const css='+JSON.stringify(COMPONENT_CSS)+';');
  assert.equal(inspectDesktopComponentStyles(root).evidence,'main-ABC.js');
}));
test('accepts component CSS emitted in the compiled local stylesheet',()=>fixture(root=>{
  writeFileSync(join(root,'styles-ABC.css'),GLOBAL_CSS+COMPONENT_CSS);
  writeFileSync(join(root,'main-ABC.js'),'console.log("synthetic")');
  assert.equal(inspectDesktopComponentStyles(root).evidence,'styles-ABC.css');
}));
test('rejects missing component stylesheet despite healthy global CSS and Angular entrypoint',()=>fixture(root=>{
  writeFileSync(join(root,'styles-ABC.css'),GLOBAL_CSS);
  writeFileSync(join(root,'main-ABC.js'),'const template="workspace chart-stage";');
  assert.throws(()=>inspectDesktopComponentStyles(root),/Missing Angular workspace and chart-stage/);
}));
test('rejects selectors without CSS grid/flex declarations and incomplete component CSS',()=>{
  assert.equal(hasDesktopComponentLayout('workspace chart-stage'),false);
  assert.equal(hasDesktopComponentLayout('.workspace{display:block;grid-template-columns:1fr}.chart-stage{display:grid;flex:1}'),false);
  assert.equal(hasDesktopComponentLayout('.workspace{display:grid;grid-template-columns:1fr}.chart-stage{display:block;flex:1}'),false);
  assert.equal(hasDesktopComponentLayout('.workspace{display:grid;grid-template-columns:1fr}'),false);
});
test('does not accept two unrelated files with only half of the component layout each',()=>fixture(root=>{
  writeFileSync(join(root,'main-ABC.js'),'.workspace{display:grid;grid-template-columns:1fr}');
  writeFileSync(join(root,'chunk-ABC.js'),'.chart-stage{display:grid;flex:1}');
  assert.throws(()=>inspectDesktopComponentStyles(root),/Missing Angular workspace and chart-stage/);
}));
test('rejects symlinked compiled layout instead of following it',()=>fixture(root=>{
  writeFileSync(join(root,'main-ABC.js'),COMPONENT_CSS);
  symlinkSync(join(root,'main-ABC.js'),join(root,'chunk-SYMLINK.js'));
  assert.throws(()=>inspectDesktopComponentStyles(root),/Unsafe compiled style candidate/);
}));
test('rejects oversized candidate before reading its body',()=>fixture(root=>{
  const file=join(root,'main-ABC.js');
  writeFileSync(file,'');
  truncateSync(file,64*1024*1024+1);
  assert.throws(()=>inspectDesktopComponentStyles(root),/exceeds limits/);
}));
test('preflights a later symlink even when an earlier main module has matching CSS',()=>fixture(root=>{
  writeFileSync(join(root,'main-ABC.js'),COMPONENT_CSS);
  const target=join(root,'main-ABC.js');
  symlinkSync(target,join(root,'polyfills-ZZZ.js'));
  assert.throws(()=>inspectDesktopComponentStyles(root),/Unsafe compiled style candidate/);
}));
test('preflights a later oversized file even when earlier CSS is complete',()=>fixture(root=>{
  writeFileSync(join(root,'main-ABC.js'),COMPONENT_CSS);
  const later=join(root,'polyfills-ZZZ.js');
  writeFileSync(later,'');
  truncateSync(later,64*1024*1024+1);
  assert.throws(()=>inspectDesktopComponentStyles(root),/exceeds limits/);
}));

test('rejects missing bundle directory and irrelevant filenames',()=>{
  assert.throws(()=>inspectDesktopComponentStyles(''),/Invalid bundle directory/);
  fixture(root=>{
    writeFileSync(join(root,'unrelated.txt'),COMPONENT_CSS);
    assert.throws(()=>inspectDesktopComponentStyles(root),/Unexpected number/);
  });
});


test('the real offline bundle CLI executes the compiled component style check',()=>{
  const cli=readFileSync(new URL('../scripts/verify-offline-bundle.mjs',import.meta.url),'utf8');
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.match(cli,/import\s*\{\s*inspectDesktopComponentStyles\s*\}\s*from\s*['"]\.\/verify-component-styles\.mjs['"]/);
  const cliBranch=cli.slice(cli.indexOf('if(process.argv[1]'));
  assert.match(cliBranch,/inspectDesktopComponentStyles\(resolve\(ROOT,'dist\/desktop\/browser'\)\)/);
  assert.match(pkg.scripts['verify:bundle'],/node scripts\/verify-offline-bundle\.mjs/);
  assert.match(pkg.scripts['verify:bundle:private'],/node scripts\/verify-offline-bundle\.mjs --private/);
});

test('rejects layout-hiding and non-grid overrides despite otherwise valid source styles',()=>{
  for(const override of [
    '.desktop-app{display:none}',
    '.workspace{display:block}',
    '.chart-stage{display:none!important}',
    '@media(max-width:760px){.workspace{display:flex}}',
    ':where(.workspace){opacity:0}',
    ':is(.chart-stage){visibility:hidden}',
  ]) {
    assert.equal(hasDesktopLayoutOverride(COMPONENT_CSS+override),true,override);
    assert.equal(hasDesktopComponentLayout(COMPONENT_CSS+override),false,override);
  }
});

test('rejects a hidden stage in later compiled chunk after a valid main module',()=>fixture(root=>{
  writeFileSync(join(root,'main-ABC.js'),'const styles='+JSON.stringify(COMPONENT_CSS));
  writeFileSync(join(root,'chunk-ABCD.js'),'const hidden=\".chart-stage{display:none}\"');
  assert.throws(()=>inspectDesktopComponentStyles(root),/layout overridden/);
}));

test('preserves responsive descendant-only visibility rules and safe grid overrides',()=>fixture(root=>{
  const css=COMPONENT_CSS + '@media(max-width:760px){.workspace.nav-collapsed .nav-label{display:none}.workspace{display:grid;grid-template-columns:60px 1fr}}';
  writeFileSync(join(root,'main-ABC.js'),css);
  assert.equal(hasDesktopLayoutOverride(css),false);
  assert.equal(inspectDesktopComponentStyles(root).evidence,'main-ABC.js');
}));

test('requires the desktop app shell grid as well as both inner layout grids',()=>{
  const noShell=COMPONENT_CSS.replace(/\.desktop-app\[[^\]]+\]\{[^}]+\}/,'');
  assert.equal(hasDesktopComponentLayout(noShell),false);
  assert.equal(hasDesktopComponentLayout(COMPONENT_CSS),true);
});


test('blocks zero-width and zero-height desktop root layout overrides',()=>{
  for(const collapse of [
    '.chart-stage{height:0}',
    '.chart-stage{max-width:0rem}',
    '.workspace{width:0%}',
    '.desktop-app{max-height:0px!important}',
    '@media(max-width:760px){.workspace{height:0.00em}}',
  ]) {
    assert.equal(hasDesktopLayoutOverride(COMPONENT_CSS+collapse),true,collapse);
    assert.equal(hasDesktopComponentLayout(COMPONENT_CSS+collapse),false,collapse);
  }
});

test('keeps legitimate min-width/min-height zero and descendant-only rules',()=>{
  for(const legitimate of [
    '.workspace{min-width:0;min-height:0}',
    '.chart-stage{min-height:0;max-width:100%}',
    '.workspace .nav-label{width:0}',
    '.chart-stage .fixture-label{height:0}',
    '@media(max-width:760px){.workspace{display:grid;grid-template-columns:60px 1fr}}',
  ]) {
    assert.equal(hasDesktopLayoutOverride(COMPONENT_CSS+legitimate),false,legitimate);
    assert.equal(hasDesktopComponentLayout(COMPONENT_CSS+legitimate),true,legitimate);
  }
});

test('rejects a later compiled chunk that collapses chart geometry',()=>fixture(root=>{
  writeFileSync(join(root,'main-ABC.js'),'const styles='+JSON.stringify(COMPONENT_CSS));
  writeFileSync(join(root,'chunk-ZERO.js'),'const hidden=".chart-stage{height:0px}";');
  assert.throws(()=>inspectDesktopComponentStyles(root),/layout overridden/);
}));
