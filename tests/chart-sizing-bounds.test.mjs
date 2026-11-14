import test from 'node:test';
import assert from 'node:assert/strict';
import { chartSide, MAX_CHART_SIDE_CSS_PX } from '../src/app/workspace-state.ts';
import { readFileSync } from 'node:fs';

test('normal desktop viewports preserve existing chart layout', () => {
  assert.equal(chartSide(800, 600), 552);
  assert.equal(chartSide(600, 800), 552);
  assert.equal(chartSide(1920, 1080, 24), 1032);
  assert.equal(chartSide(200.9, 200.9, 24), 152);
});

test('extremely large but finite measurements cannot allocate unbounded CSS surfaces', () => {
  assert.equal(MAX_CHART_SIDE_CSS_PX, 4096);
  assert.equal(chartSide(5000, 5000, 24), MAX_CHART_SIDE_CSS_PX);
  assert.equal(chartSide(Number.MAX_VALUE, Number.MAX_VALUE, 0), MAX_CHART_SIDE_CSS_PX);
  assert.equal(chartSide(4143, 4143, 24), 4095);
  assert.equal(chartSide(4144, 4144, 24), 4096);
});

test('malformed measurements or impossible padding fail closed', () => {
  for (const [width, height, pad] of [
    [NaN, 600, 24], [Infinity, 600, 24], [600, -1, 24],
    [600, 600, -1], [600, 600, Infinity], [1, 1, 24],
    [Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE],
  ]) {
    assert.equal(chartSide(width, height, pad), 0);
  }
});

test('valid dimensions remain finite, integral, and fit inside the padded viewport', () => {
  for (const [width, height, pad] of [
    [4097, 8000, 0], [16384, 8192, 24], [1280, 720, 36],
    [2560.5, 1440.5, 12.5], [2048, 2048, 0], [32, 32, 16],
  ]) {
    const result = chartSide(width, height, pad);
    assert.ok(Number.isSafeInteger(result) && result >= 0 && result <= MAX_CHART_SIDE_CSS_PX);
    assert.ok(result <= Math.max(0, Math.min(width, height) - 2 * pad));
  }
});


test('high-DPI screens cap estimated backing dimensions without shrinking ordinary charts', () => {
  assert.equal(chartSide(9000, 9000, 24, 1), 4096);
  assert.equal(chartSide(9000, 9000, 24, 1.25), 3276);
  assert.equal(chartSide(9000, 9000, 24, 2), 2048);
  assert.equal(chartSide(9000, 9000, 24, 3), 1365);
  assert.equal(chartSide(9000, 9000, 24, 0.8), 4096);
  assert.equal(chartSide(800, 600, 24, 2), 552, 'ordinary viewport stays unchanged');
});

test('all valid high-DPI measurements respect both CSS layout and pixel budget', () => {
  for (const [width, height, pad, ratio] of [
    [1920, 1080, 24, 1.25],
    [5000, 4000, 24, 1.5],
    [8192, 7680, 0, 2],
    [9000, 9000, 36, 2.5],
    [12000, 12000, 0, 3],
    [8000, 8000, 0, 4],
  ]) {
    const side = chartSide(width, height, pad, ratio);
    assert.ok(Number.isSafeInteger(side));
    assert.ok(side >= 0 && side <= MAX_CHART_SIDE_CSS_PX);
    assert.ok(side + 2 * pad <= Math.min(width, height));
    assert.ok(side * ratio <= MAX_CHART_SIDE_CSS_PX);
  }
});

test('invalid display scale cannot request an unsafe canvas allocation', () => {
  for (const ratio of [NaN, Infinity, -Infinity, 0, -1, '2', undefined]) {
    const result = ratio === undefined
      ? chartSide(9000, 9000, 24)
      : chartSide(9000, 9000, 24, ratio);
    assert.equal(result, ratio === undefined ? 4096 : 0);
  }
  assert.equal(chartSide(9000, 9000, 24, 4097), 0);
});

test('Angular resize path passes actual device pixel ratio to the pure chart budget', () => {
  const source = readFileSync(new URL('../src/app/desktop-app.component.ts', import.meta.url), 'utf8');
  assert.match(source, /chartSide\(bounds\.width,\s*bounds\.height,\s*24,\s*window\.devicePixelRatio\)/);
});
