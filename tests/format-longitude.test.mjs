import test from 'node:test';
import assert from 'node:assert/strict';
import { formatEclipticLongitude } from '../src/app/format-longitude.ts';

test('renders valid zero, fractional and upper-bound circular longitudes', () => {
  assert.equal(formatEclipticLongitude(0), '0.0°');
  assert.equal(formatEclipticLongitude(-0), '0.0°');
  assert.equal(formatEclipticLongitude(6.54), '6.5°');
  assert.equal(formatEclipticLongitude(103), '103.0°');
  assert.equal(formatEclipticLongitude(359.94), '359.9°');
  assert.equal(formatEclipticLongitude(359.96), '0.0°');
});

test('uses an Italian decimal comma but keeps English and default decimal points', () => {
  for (const [value, english, italian] of [
    [0, '0.0°', '0,0°'],
    [19.3, '19.3°', '19,3°'],
    [103, '103.0°', '103,0°'],
    [359.96, '0.0°', '0,0°'],
  ]) {
    assert.equal(formatEclipticLongitude(value), english);
    assert.equal(formatEclipticLongitude(value, 'en'), english);
    assert.equal(formatEclipticLongitude(value, 'it'), italian);
  }
  for (const unsupported of ['fr', '', null, 1, {}, true]) {
    assert.equal(formatEclipticLongitude(19.3, unsupported), '—');
  }
  assert.equal(formatEclipticLongitude(NaN, 'it'), '—');
});

test('rejects non-finite and out-of-range longitude values rather than implying precision', () => {
  for (const value of [NaN, Infinity, -Infinity, -0.001, -1, 360, 720, Number.MAX_VALUE]) {
    assert.equal(formatEclipticLongitude(value), '—', String(value));
  }
});

test('rejects untyped runtime values without coercing input', () => {
  for (const value of [null, undefined, '12.3', {}, [], true]) {
    assert.equal(formatEclipticLongitude(value), '—');
  }
});

test('never changes the source value or returns an HTML fragment', () => {
  const longitude = 208.6;
  const formatted = formatEclipticLongitude(longitude);
  assert.equal(longitude, 208.6);
  assert.equal(formatted, '208.6°');
  assert.equal(formatted.includes('<'), false);
});
