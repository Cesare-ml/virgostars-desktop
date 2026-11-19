import test from 'node:test';
import assert from 'node:assert/strict';
import { chartSide, CHART_MODES, safeMode, navigationLabel, commonHouseSystems } from '../src/app/workspace-state.ts';
import { STRINGS, translate } from '../src/app/translations.ts';

test('synastry offers only house systems available for both calculated charts', () => {
  const radix = ['egizia', 'placido', 'koch'];
  const partner = ['koch', 'egizia', 'porfirio'];
  assert.deepEqual(commonHouseSystems(radix, partner), ['egizia', 'koch']);
  assert.deepEqual(commonHouseSystems(radix, ['porfirio']), []);
  assert.deepEqual(commonHouseSystems([], partner), []);
  assert.deepEqual(radix, ['egizia', 'placido', 'koch']);
  assert.deepEqual(partner, ['koch', 'egizia', 'porfirio']);
});

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

test('navigation folds only when the centre column would be narrower than the window is tall', async () => {
  const {shouldCollapseNavigation, NAV_WIDTH_PX, INSPECTOR_WIDTH_PX} = await import('../src/app/workspace-state.ts');
  // 1360x880: 1360-208-400 = 752 < 880, so the wheel would be width-limited.
  assert.equal(shouldCollapseNavigation(1360, 880, true), true);
  // The same window with the inspector closed leaves 1152 for the chart.
  assert.equal(shouldCollapseNavigation(1360, 880, false), false);
  // Full HD keeps the labelled navigation: 1920-208-400 = 1312 >= 1080.
  assert.equal(shouldCollapseNavigation(1920, 1080, true), false);
  // Narrow windows float the inspector instead of giving it a column.
  assert.equal(shouldCollapseNavigation(1100, 700, true), 1100 - NAV_WIDTH_PX < 700);
  assert.equal(INSPECTOR_WIDTH_PX, 400);
  for (const bad of [[NaN, 800], [1200, Infinity], [0, 800], [-5, 800]]) {
    assert.equal(shouldCollapseNavigation(bad[0], bad[1], true), false);
  }
});
