import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hasDesktopComponentLayout, inspectDesktopComponentStyles} from '../scripts/verify-component-styles.mjs';

const COMPONENT_CSS = '.workspace[_ngcontent-%COMP%]{display:grid;grid-template-columns:208px minmax(0,1fr) 316px}' +
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
