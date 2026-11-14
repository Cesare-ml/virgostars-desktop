import test from 'node:test';
import assert from 'node:assert/strict';
import {chartSide, MAX_CHART_BACKING_SIDE_PX, MAX_CHART_SIDE_CSS_PX} from '../src/app/workspace-state.ts';

test('1x geometry is unchanged for normal stage sizes and CSS limit', () => {
  assert.equal(chartSide(800, 600, 24, 1), 552);
  assert.equal(chartSide(1920, 1080, 24), 1032);
  assert.equal(chartSide(9000, 9000, 24, 1), MAX_CHART_SIDE_CSS_PX);
  assert.equal(chartSide(9000, 9000, 24, 0.75), MAX_CHART_SIDE_CSS_PX);
});

test('high-DPI stages are conservatively bounded in CSS and backing pixels', () => {
  assert.equal(MAX_CHART_BACKING_SIDE_PX, 4096);
  assert.equal(chartSide(9000, 9000, 24, 2), 2048);
  assert.equal(chartSide(9000, 9000, 24, 3), 1365);
  assert.equal(chartSide(9000, 9000, 24, 1.25), 3276);
  for (const dpr of [1, 1.25, 1.5, 2, 2.75, 3, 4]) {
    const css = chartSide(12000, 8500, 24, dpr);
    assert.ok(css <= MAX_CHART_SIDE_CSS_PX);
    assert.ok(Math.ceil(css * dpr) <= MAX_CHART_BACKING_SIDE_PX, `${dpr} DPR`);
  }
});

test('ordinary laptop and desktop sizes remain usable at 1x and 2x', () => {
  assert.equal(chartSide(1280, 720, 24, 2), 672);
  assert.equal(chartSide(2560, 1440, 24, 2), 1392);
  assert.equal(chartSide(3840, 2160, 24, 2), 2048);
  assert.equal(chartSide(3840, 2160, 24, 3), 1365);
});

test('invalid or extreme DPR never requests unbounded dimensions', () => {
  for (const dpr of [NaN, Infinity, -Infinity, -1, 0]) {
    assert.equal(chartSide(8000, 8000, 0, dpr), 0);
  }
  assert.equal(chartSide(8000, 8000, 0, Number.MAX_VALUE), 0);
  assert.equal(chartSide(8000, -1, 0, 2), 0);
  assert.equal(chartSide(NaN, 8000, 0, 2), 0);
});

test('fractional measurements always fit inside padding and yield integer CSS sizes', () => {
  for (const [width,height,pad,dpr] of [
    [2560.75, 1440.25, 12.5, 1.25],
    [4143.25, 4000.99, 24, 2],
    [100.5, 48.5, 24, 2.75],
    [Number.MAX_VALUE, Number.MAX_VALUE, 24, 4],
  ]) {
    const size = chartSide(width, height, pad, dpr);
    assert.ok(Number.isSafeInteger(size) && size >= 0);
    assert.ok(size <= Math.max(0, Math.min(width, height) - pad * 2));
    assert.ok(size * dpr <= MAX_CHART_BACKING_SIDE_PX);
  }
});
