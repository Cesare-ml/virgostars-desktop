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
test('UI shows no technical, account or placeholder captions; the archive and the new chart have their own panels',()=>{
  const html=read('src/app/desktop-app.component.html');
  // Only the demonstration wheel keeps a label, so fictional positions are never mistaken for a calculated chart.
  assert.match(html,/subjectCaption/);
  assert.match(html,/\[attr.title\]="t\('archive'\)" \(click\)="openArchive\(\)"/);
  assert.match(html,/\[attr.title\]="t\('newchart'\)" \(click\)="openNewChart\(\)"/);
  assert.match(html,/class="inspector-body" id="inspector-content"/);
  for (const removed of ['noaccount','research','lab','footer','footerKey','artworkStatus','runtimeStatus','provenanceLabel']) {
    assert.doesNotMatch(html,new RegExp("t\\(['\"]?" + removed + "['\"]?\\)|\\b" + removed + "\\b"),removed);
  }
  assert.doesNotMatch(html,/<footer/);
  // The archive is not part of the new-chart panel, and the new-chart panel is not part of the archive.
  const newSheet=html.match(/<section class="sheet" \*ngIf="view==='new'"[\s\S]*?<\/section>/)?.[0] ?? '';
  const archiveSheet=html.match(/<section class="sheet" \*ngIf="view==='archive'"[\s\S]*?<\/section>\s*<\/section>/)?.[0] ?? '';
  assert.ok(newSheet.includes('<vs-new-chart'));
  assert.doesNotMatch(newSheet,/savedCharts|visibleSavedCharts|archive\.title/);
  assert.ok(archiveSheet.includes('visibleSavedCharts'));
  assert.doesNotMatch(archiveSheet,/<vs-new-chart/);
});
test('the chart owns the full window height: no top bar, header or footer around it',()=>{
  const html=read('src/app/desktop-app.component.html');
  const css=read('src/app/desktop-app.component.css');
  assert.doesNotMatch(html,/class="topbar"|class="chart-header"/);
  assert.match(css,/\.chart-panel\s*\{[^}]*padding:0;/s);
  assert.match(css,/\.chart-stage\s*\{[^}]*margin:0;/s);
  assert.match(css,/\.desktop-app\s*\{[^}]*grid-template-rows:minmax\(0,1fr\);/s);
  const component=read('src/app/desktop-app.component.ts');
  assert.match(component,/chartSide\(bounds\.width,bounds\.height,CHART_MARGIN_PX\)/);
});
test('light and dark tokens exist, and the chart has a central flex stage',()=>{
  const css=read('src/app/desktop-app.component.css');
  assert.match(css,/\.desktop-app\[data-theme="dark"\]/);
  assert.match(css,/--vs-accent:/);
  assert.match(css,/\.chart-stage\s*\{[^}]*flex:1;[^}]*min-height:0;/s);
  assert.match(css,/\.workspace\.nav-collapsed/);
  assert.match(css,/\.workspace\.inspector-collapsed/);
});
