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
