import test from 'node:test';
import assert from 'node:assert/strict';
import { chartSide, CHART_MODES, safeMode, navigationLabel } from '../src/app/workspace-state.ts';
import { STRINGS, translate } from '../src/app/translations.ts';

test('chart is bounded by BOTH usable viewport dimensions, including safe padding',()=>{
  for(const [width,height,pad] of [[1400,800,24],[540,900,24],[1280,720,36],[300,200,12]]) {
    const diameter=chartSide(width,height,pad);
    assert.ok(diameter+2*pad<=width, 'should fit available width');
    assert.ok(diameter+2*pad<=height, 'should fit available height');
  }
  assert.equal(chartSide(800,600,24),552);
  assert.equal(chartSide(600,800,24),552);
});
test('invalid viewport measurements never create a negative/non-finite chart diameter',()=>{
  for(const [w,h,p] of [[0,0,24],[10,10,24],[-1,500,24],[NaN,500,24],[800,Infinity,24],[400,400,-1]]) {
    assert.equal(chartSide(w,h,p),0);
  }
});
test('only explicitly implemented renderer modes are selectable',()=>{
  assert.deepEqual(CHART_MODES,['natal','transits','synastry','latitude']);
  for(const mode of CHART_MODES) {
    assert.equal(safeMode(mode),mode);
    assert.match(navigationLabel(mode),/^mode\./);
  }
  for(const invalid of ['archive','live','javascript:alert(1)','']) assert.equal(safeMode(invalid),null);
});
test('all Italian and English UI labels have identical keys and nonempty text',()=>{
  assert.deepEqual(Object.keys(STRINGS.it).sort(),Object.keys(STRINGS.en).sort());
  for(const key of Object.keys(STRINGS.it)) {
    assert.ok(translate('it',key));
    assert.ok(translate('en',key));
  }
});

// Pure UI behavior tests; no browser, accounts, astronomical computation or assets.
test('desktop breakpoints agree with stylesheet navigation and inspector overlays', async () => {
  const {isCompactNavigationWidth, isOverlayInspectorWidth} = await import('../src/app/workspace-state.ts');
  for (const [width, nav, inspector] of [[1920,false,false],[1141,false,false],[1140,false,true],[761,false,true],[760,true,true],[600,true,true]]) {
    assert.equal(isCompactNavigationWidth(width),nav);
    assert.equal(isOverlayInspectorWidth(width),inspector);
  }
  for (const invalid of [-1,NaN,Infinity]) {
    assert.equal(isCompactNavigationWidth(invalid),false);
    assert.equal(isOverlayInspectorWidth(invalid),false);
  }
});
test('inspector arrow keys and Home/End wrap through one selected tab', async () => {
  const {INSPECTOR_TABS,nextInspectorTab} = await import('../src/app/workspace-state.ts');
  assert.deepEqual(INSPECTOR_TABS,['planets','houses','settings']);
  assert.equal(nextInspectorTab('planets','ArrowLeft'),'settings');
  assert.equal(nextInspectorTab('settings','ArrowRight'),'planets');
  assert.equal(nextInspectorTab('planets','ArrowDown'),'houses');
  assert.equal(nextInspectorTab('houses','ArrowUp'),'planets');
  assert.equal(nextInspectorTab('settings','Home'),'planets');
  assert.equal(nextInspectorTab('planets','End'),'settings');
  assert.equal(nextInspectorTab('houses','Escape'),null);
});
test('Angular shell implements compact overlays and accessible tab traversal',()=>{
  const html=readFileSync(new URL('../src/app/desktop-app.component.html',import.meta.url),'utf8');
  const css=readFileSync(new URL('../src/app/desktop-app.component.css',import.meta.url),'utf8');
  const component=readFileSync(new URL('../src/app/desktop-app.component.ts',import.meta.url),'utf8');
  assert.match(html,/class="nav-backdrop"/);
  assert.match(html,/aria-controls="desktop-navigation"/);
  assert.match(html,/aria-controls="desktop-inspector"/);
  assert.match(html,/role="tab" id="tab-planets"[^>]*\[attr.tabindex\]/);
  assert.match(component,/onInspectorTabKeydown\(event: KeyboardEvent\)/);
  assert.match(component,/onDocumentKeydown\(event: KeyboardEvent\)/);
  assert.match(css,/\.workspace\.mobile-nav-open \.sidebar/);
  assert.match(css,/\.workspace\.mobile-nav-open \.nav-backdrop/);
});
