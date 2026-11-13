import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildFictionalAngles, normalizeFictionalLongitude} from '../src/app/fictional-geometry.ts';

const modulo360 = value => ((value % 360) + 360) % 360;
const sameLongitude = (a, b) => Math.abs(a - b) < 1e-9;

test('longitude normalizer wraps signed degrees into [0,360)', () => {
  for (const [input, expected] of [
    [0,0], [360,0], [-360,0], [-0,0], [720,0],
    [-1,359], [361,1], [-361,359], [719.5,359.5], [-719.5,0.5],
  ]) {
    const actual = normalizeFictionalLongitude(input);
    assert.equal(actual, expected, String(input));
    assert.ok(!Object.is(actual, -0), 'negative zero must not escape');
  }
});

test('non-finite shifts and longitudes are rejected before rendering', () => {
  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.throws(() => normalizeFictionalLongitude(invalid), RangeError);
    assert.throws(() => buildFictionalAngles(invalid), RangeError);
  }
});

test('the prototype uses ten planets and twelve houses with safe wrapped longitudes', () => {
  for (const shift of [0, 23, 58, -1, -103, -360, 360, 725.5]) {
    const angles = buildFictionalAngles(shift);
    assert.equal(angles.planetLongitudes.length, 10);
    assert.equal(angles.houseCusps.length, 12);
    for (const coordinate of [angles.ascendant,angles.descendant,angles.mediumCoeli,
      angles.imumCoeli,angles.vertex,...angles.planetLongitudes,...angles.houseCusps]) {
      assert.ok(Number.isFinite(coordinate) && coordinate >= 0 && coordinate < 360, `shift ${shift}: ${coordinate}`);
    }
    assert.ok(sameLongitude(angles.descendant, modulo360(angles.ascendant + 180)));
    assert.ok(sameLongitude(angles.imumCoeli, modulo360(angles.mediumCoeli + 180)));
    assert.ok(sameLongitude(angles.vertex, modulo360(angles.ascendant + 120)));
    angles.houseCusps.forEach((longitude, index) => {
      assert.ok(sameLongitude(longitude, modulo360(angles.ascendant + index * 30)));
    });
  }
});

test('base fixture values remain unchanged for the existing natal demo', () => {
  const natal = buildFictionalAngles(0);
  assert.equal(natal.ascendant, 103);
  assert.equal(natal.mediumCoeli, 15);
  assert.deepEqual([...natal.planetLongitudes], [19.3,83.1,44.8,129.4,167.1,208.6,278.1,305.6,347.7,6.5]);
  assert.deepEqual([...natal.houseCusps], [103,133,163,193,223,253,283,313,343,13,43,73]);
});

test('fixture geometry is deterministic and cannot be mutated by consumers', () => {
  const first = buildFictionalAngles(58);
  const second = buildFictionalAngles(58);
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.planetLongitudes));
  assert.ok(Object.isFrozen(first.houseCusps));
  assert.throws(() => first.planetLongitudes.push(5), TypeError);
  assert.deepEqual(first, buildFictionalAngles(58));
});

test('the chart fixture sources all demo longitudes from the shared synthetic helper', () => {
  const fixture = readFileSync(new URL('../src/app/fictional-fixture.ts', import.meta.url), 'utf8');
  assert.match(fixture, /from '\.\/fictional-geometry'/);
  assert.match(fixture, /buildFictionalAngles\(shift\)/);
  assert.match(fixture, /longitude: angles\.planetLongitudes\[i\]/);
  assert.match(fixture, /house:\[\.\.\.angles\.houseCusps\]/);
  assert.match(fixture, /buildFictionalAngles\(0\)/);
});
