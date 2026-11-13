import test from 'node:test';
import assert from 'node:assert/strict';
import { chartSide, MAX_CHART_SIDE_CSS_PX } from '../src/app/workspace-state.ts';
import { parseDesktopShortcut } from '../src/app/desktop-shortcuts.ts';
import { buildFictionalAngles } from '../src/app/fictional-geometry.ts';
import { buildSyntheticChartCsv, SYNTHETIC_DATA_STATUS } from '../src/app/synthetic-csv-export.ts';

const shortcut = (code, target = { tagName: 'BUTTON', closest: () => null }) => ({
  code, altKey: true, shiftKey: true, ctrlKey: false, metaKey: false,
  repeat: false, target,
});
const NAMES = ['Sun','Moon','Mercury','Venus','Mars','Jupiter','Saturn','Uranus','Neptune','Pluto'];

function fictionalCsv() {
  const data = buildFictionalAngles(0);
  return buildSyntheticChartCsv(
    NAMES.map((name, i) => ({ name, longitude: data.planetLongitudes[i] })),
    data.houseCusps.map((longitude, i) => ({ number: i + 1, longitude })),
  );
}

test('fit shortcut coexists with finite bounded geometry even at extreme CSS measurements', () => {
  assert.deepEqual(parseDesktopShortcut(shortcut('Digit0')), { kind: 'fit' });
  assert.equal(MAX_CHART_SIDE_CSS_PX, 4096);
  for (const [width, height, padding] of [
    [1920,1080,24], [7680,4320,24], [1e9,1e9,0],
    [Number.MAX_VALUE,Number.MAX_VALUE,0], [4144,4144,24],
  ]) {
    const side = chartSide(width, height, padding);
    assert.ok(Number.isSafeInteger(side) && side >= 0 && side <= MAX_CHART_SIDE_CSS_PX);
    assert.ok(side <= Math.max(0, Math.min(width, height) - 2*padding));
  }
});

test('repeated layout measurements from opening or closing panels are deterministic', () => {
  for (const [width, height] of [
    [1024,768], [800,768], [768,768], [650,500], [100000,100000], [0,1000],
  ]) {
    const values = Array.from({length: 4}, () => chartSide(width, height, 24));
    assert.deepEqual(values, Array(4).fill(values[0]));
    assert.ok(values[0] <= MAX_CHART_SIDE_CSS_PX);
  }
});

test('editable focus and invalid measurements cannot force chart resizing via shortcuts', () => {
  for (const code of ['Digit0','Digit1','Digit2','Digit3','Digit4']) {
    assert.equal(parseDesktopShortcut(shortcut(code, {tagName: 'INPUT'})), null);
  }
  for (const [width,height,padding] of [
    [NaN,900,24], [Infinity,900,24], [-1,900,24], [900,900,Infinity],
  ]) {
    assert.equal(chartSide(width,height,padding), 0);
  }
});

test('fit and view selection do not mutate the 22 fictional coordinates or CSV', () => {
  const before = buildFictionalAngles(0);
  const csv = fictionalCsv();
  for (const code of ['Digit0','Digit1','Digit2','Digit3','Digit4','Digit0']) {
    const action = parseDesktopShortcut(shortcut(code));
    assert.ok(action && (action.kind === 'fit' || action.kind === 'mode'));
    assert.ok(chartSide(6000,6000,24) <= MAX_CHART_SIDE_CSS_PX);
    assert.deepEqual(buildFictionalAngles(0), before);
    assert.equal(fictionalCsv(), csv);
  }
  assert.equal(csv.trimEnd().split('\r\n').length, 23);
  assert.ok(csv.includes('planet,Sun,19.3,' + SYNTHETIC_DATA_STATUS));
});
