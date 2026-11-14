import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('Angular desktop entry owns its application and imports upstream renderer, not a copy',()=>{
  const main=read('src/main.ts');
  const app=read('src/app/desktop-app.component.ts');
  const packageJson=JSON.parse(read('package.json'));
  assert.match(main,/bootstrapApplication\(DesktopAppComponent/);
  assert.match(app,/from 'grafici-astrologici'/);
  assert.match(app,/new GraficoRenderService\(\)/);
  assert.match(app,/ResizeObserver/);
  assert.match(app,/configurePublicAssetsBase\('\/assets\/'\)/);
  assert.match(packageJson.dependencies['grafici-astrologici'],/^file:\.\.\/astrological-charts\/dist\/grafici-astrologici$/);
});
test('Tauri references the owned offline Angular build with no privileged IPC capabilities',()=>{
  const tauri=JSON.parse(read('src-tauri/tauri.conf.json'));
  const angular=JSON.parse(read('angular.json'));
  assert.equal(tauri.build.frontendDist,'../dist/desktop/browser');
  assert.equal(tauri.bundle.active,false);
  assert.deepEqual(tauri.app.security.capabilities,[]);
  assert.equal(angular.projects.desktop.architect.build.options.browser,'src/main.ts');
  assert.equal(angular.projects.desktop.architect.build.options.assets[0].input,'.local/frontend/assets');
});
test('UI keeps unimplemented account, research, and archive flows disabled or clearly experimental',()=>{
  const html=read('src/app/desktop-app.component.html');
  assert.match(html,/t\('noaccount'\)/);
  assert.match(html,/t\('fixture'\)/);
  assert.match(html,/disabled \[attr.title\]="t\('archive'\)"/);
  assert.match(html,/disabled \[attr.title\]="t\('research'\)"/);
  assert.match(html,/role="tabpanel"/);
});
test('light and dark tokens exist, and the chart has a central flex stage',()=>{
  const css=read('src/app/desktop-app.component.css');
  assert.match(css,/\.desktop-app\[data-theme="dark"\]/);
  assert.match(css,/--vs-accent:/);
  assert.match(css,/\.chart-stage\s*\{[^}]*flex:1;[^}]*min-height:0;/s);
  assert.match(css,/\.workspace\.nav-collapsed/);
  assert.match(css,/\.workspace\.inspector-collapsed/);
});


test('PNG export failure keeps an already rendered chart available to retry',()=> {
  const app=read('src/app/desktop-app.component.ts');
  const start=app.indexOf('async exportPng(): Promise<void>');
  const end=app.indexOf('private renderError(', start);
  assert.ok(start >= 0 && end > start, 'locate the export-specific completion path');
  const exportMethod=app.slice(start,end);
  assert.match(exportMethod,/if\(!this\.ready \|\| this\.busy \|\| this\.destroyed \|\| this\.exporting\) return/);
  assert.match(exportMethod,/this\.error='';/, 'clear any previous export error on retry');
  assert.match(exportMethod,/this\.status='exporting'/);
  assert.match(exportMethod,/this\.status='export\.failed'/);
  assert.match(exportMethod,/this\.error=this\.t\('export\.failed'\)/);
  assert.doesNotMatch(exportMethod,/this\.renderError\(/, 'export failure must not destroy chart readiness');
  assert.doesNotMatch(exportMethod,/this\.ready\s*=\s*false/, 'keep a valid chart ready for retry');
  assert.match(exportMethod,/finally\s*\{\s*this\.exporting=false;/);
  assert.match(exportMethod,/this\.busy=false/);
});

test('chart rendering and PNG exporting report their distinct bilingual status',()=> {
  const app=read('src/app/desktop-app.component.ts');
  const template=read('src/app/desktop-app.component.html');
  const translations=read('src/app/translations.ts');
  assert.match(app,/private renderError\([\s\S]*?this\.status='status\.error';/);
  assert.match(template,/<div class="chart-message" \*ngIf="busy" role="status">\{\{t\(status\)\}\}<\/div>/);
  assert.equal((translations.match(/"export\.failed":/g) ?? []).length, 2);
  assert.match(translations,/"export\.failed":"Esportazione PNG non riuscita\. Riprova\."/);
  assert.match(translations,/"export\.failed":"PNG export failed\. Please try again\."/);
});
