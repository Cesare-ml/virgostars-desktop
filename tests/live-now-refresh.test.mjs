import test from 'node:test';
import assert from 'node:assert/strict';
import {dueLiveNowMinute, LIVE_NOW_REFRESH_INTERVAL_MS} from '../src/app/live-now-refresh.ts';

test('returns one stable minute bucket and waits inside the same minute', () => {
  assert.equal(dueLiveNowMinute(60_001, null), 1);
  assert.equal(dueLiveNowMinute(89_999, 1), null);
  assert.equal(dueLiveNowMinute(90_000, 1), 1);
});

test('refreshes immediately after crossing a minute boundary', () => {
  assert.equal(dueLiveNowMinute(LIVE_NOW_REFRESH_INTERVAL_MS, 0), 1);
  assert.equal(dueLiveNowMinute(LIVE_NOW_REFRESH_INTERVAL_MS - 1, 0), null);
});

test('follows wall-clock corrections in either direction', () => {
  assert.equal(dueLiveNowMinute(120_000, 1), 2);
  assert.equal(dueLiveNowMinute(59_000, 2), 0);
});

test('rejects invalid and out-of-range device clock samples', () => {
  for (const value of [NaN, Infinity, -Infinity, 8_640_000_000_000_001, -8_640_000_000_000_001]) {
    assert.equal(dueLiveNowMinute(value, null), null);
  }
});
