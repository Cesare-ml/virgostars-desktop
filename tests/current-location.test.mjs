import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCurrentCoordinates} from '../src/app/current-location.ts';

test('converts valid geographic coordinates to immutable microdegrees', () => {
  const value = normalizeCurrentCoordinates(43.7696, 11.2558);
  assert.deepEqual(value, {latMicro: 43_769_600, lngMicro: 11_255_800});
  assert.ok(Object.isFrozen(value));
});

test('accepts both geographic boundaries', () => {
  assert.deepEqual(normalizeCurrentCoordinates(-90, -180), {latMicro: -90_000_000, lngMicro: -180_000_000});
  assert.deepEqual(normalizeCurrentCoordinates(90, 180), {latMicro: 90_000_000, lngMicro: 180_000_000});
});

test('rejects non-finite, non-numeric and out-of-range coordinates', () => {
  for (const pair of [[NaN, 0], [Infinity, 0], [0, -Infinity], ['43', 11], [90.00001, 0], [0, 180.00001], [null, null]]) {
    assert.equal(normalizeCurrentCoordinates(pair[0], pair[1]), null);
  }
});
