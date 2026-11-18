import test from 'node:test';
import assert from 'node:assert/strict';
import {CHART_SKINS, CHART_SKIN_KEY, loadChartSkin, saveChartSkin} from '../src/app/chart-skin.ts';

test('chart skin defaults to the official skin and persists every supported choice', () => {
  let value = null;
  const storage = {getItem(key) { assert.equal(key, CHART_SKIN_KEY); return value; },
    setItem(key, next) { assert.equal(key, CHART_SKIN_KEY); value = next; }};
  assert.equal(loadChartSkin(storage), 'virgostars');
  for (const skin of CHART_SKINS) {
    saveChartSkin(storage, skin);
    assert.equal(loadChartSkin(storage), skin);
  }
  value = '__proto__';
  assert.equal(loadChartSkin(storage), 'virgostars');
});

test('unavailable storage and invalid writes cannot prevent use of the chart', () => {
  const broken = {getItem() { throw Error(); }, setItem() { throw Error(); }};
  assert.equal(loadChartSkin(broken), 'virgostars');
  assert.doesNotThrow(() => saveChartSkin(broken, 'dark'));
  let writes = 0;
  saveChartSkin({setItem() { writes++; }}, 'unknown');
  assert.equal(writes, 0);
});
