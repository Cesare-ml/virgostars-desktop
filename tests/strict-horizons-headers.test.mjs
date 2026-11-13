import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUniqueHorizonsHeaders } from '../scripts/ephemeris/strict-horizons-headers.mjs';

const body = [
  'API VERSION: 1.0',
  'API SOURCE: NASA/JPL Horizons API',
  '',
  'Ephemeris / synthetic, not an official data record',
  'Target body name: Sun (10) {source: de441}',
  'Center body name: Solar System Barycenter (0)',
  'Center-site name: BODY CENTER',
  'Output units: KM-S',
  'Output type: GEOMETRIC cartesian states',
  'Output format: 2 (position and velocity)',
  'Reference frame: ICRF/J2000.0',
  'Coordinate systm: Earth Mean Equator and Equinox of Reference Epoch',
  'Start time: A.D. 2023-Feb-25 00:00:00.0000 TDB',
  '$$SOE',
  '2460000.5, fictional, 1,2,3,4,5,6,',
  '$$EOE',
].join('\n');
const insert = line => body.replace('$$SOE', () => line+'\n$$SOE');
const remove = line => body.replace(line+'\n','');

test('parses only fields from valid pre-ephemeris header',()=>{
  const p = parseUniqueHorizonsHeaders(body);
  assert.equal(p.targetName,'Sun (10) {source: de441}');
  assert.equal(p.centerName,'Solar System Barycenter (0)');
  assert.equal(p.coordinateSystem,'Earth Mean Equator and Equinox of Reference Epoch');
  assert.equal(p.apiVersion,'1.0');
  assert.equal(Object.keys(p).length,11);
  assert.ok(Object.isFrozen(p));
});
test('accepts documented coordinate system full spelling',()=>{
  const p=parseUniqueHorizonsHeaders(body.replace('Coordinate systm:','Coordinate system:'));
  assert.match(p.coordinateSystem,/Reference Epoch/);
});
test('supports case- and whitespace-variations without losing uniqueness',()=>{
  const p=parseUniqueHorizonsHeaders(body.replace('Target body name:', '  tArGet   BODY  name :  '));
  assert.match(p.targetName,/Sun/);
});
test('rejects duplicate target even if one is otherwise correct',()=>{
  assert.throws(()=>parseUniqueHorizonsHeaders(insert('Target body name: Moon (301)')),/AMBIGUOUS_RESPONSE_HEADER/);
});
test('rejects duplicate center, including same value',()=>{
  assert.throws(()=>parseUniqueHorizonsHeaders(insert('CENTER BODY NAME: Solar System Barycenter (0)')),/AMBIGUOUS_RESPONSE_HEADER/);
});
test('rejects both aliases of coordinate header',()=>{
  assert.throws(()=>parseUniqueHorizonsHeaders(insert('Coordinate system: Earth Mean Equator and Equinox of Reference Epoch')),/AMBIGUOUS_RESPONSE_HEADER/);
});
test('rejects duplicate API transport version',()=>{
  assert.throws(()=>parseUniqueHorizonsHeaders(insert('API VERSION: 2.0')),/AMBIGUOUS_RESPONSE_HEADER/);
});
test('rejects blank mandatory field',()=>{
  assert.throws(()=>parseUniqueHorizonsHeaders(body.replace('Output units: KM-S','Output units:    ')),/INVALID_RESPONSE_HEADER/);
});
test('rejects missing target even if it appears after ephemeris',()=>{
  const raw=remove('Target body name: Sun (10) {source: de441}')+'\nTarget body name: Sun (10)';
  assert.throws(()=>parseUniqueHorizonsHeaders(raw),/MISSING_RESPONSE_HEADER/);
});
test('rejects missing frame even if it is forged in footer',()=>{
  const raw=remove('Reference frame: ICRF/J2000.0')+'\nReference frame: ICRF/J2000.0';
  assert.throws(()=>parseUniqueHorizonsHeaders(raw),/MISSING_RESPONSE_HEADER/);
});
test('does not accept header-only response without an ephemeris marker',()=>{
  assert.throws(()=>parseUniqueHorizonsHeaders(body.replace('$$SOE','')),/INVALID_RESPONSE_HEADER/);
});
test('rejects control chars in header values',()=>{
  assert.throws(()=>parseUniqueHorizonsHeaders(body.replace('Output units: KM-S','Output units: KM-\x00S')),/INVALID_RESPONSE_HEADER/);
});
test('rejects repeated field with different casing, including start time',()=>{
  assert.throws(()=>parseUniqueHorizonsHeaders(insert('start TIME: A.D. 2023-Feb-25 00:00:00 TDB')),/AMBIGUOUS_RESPONSE_HEADER/);
});
test('does not treat colon-bearing descriptive text as a field',()=>{
  const p=parseUniqueHorizonsHeaders(insert('Comment: Target body name: fake'));
  assert.match(p.targetName,/Sun/);
});
test('rejects empty, nonstring, or malformed source',()=>{
  for(const x of [null,{},'',42,'$$SOE\n$$EOE'])
    assert.throws(()=>parseUniqueHorizonsHeaders(x),/INVALID_RESPONSE_HEADER|MISSING_RESPONSE_HEADER/);
});
