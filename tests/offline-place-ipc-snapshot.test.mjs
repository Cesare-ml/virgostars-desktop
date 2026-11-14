import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeOfflinePlaceResults, OfflinePlaceSearch} from '../src/app/native/offline-places-contract.ts';

// The fixture is fictional; never put a real person's location or birth record here.
const city = Object.freeze({
  id: 17, name: 'Città Fittizia', italianName: null, latMicro: 1000000,
  lngMicro: 2000000, population: 100, stateId: null,
  region: 'Regione Demo', timeZone: 'Europe/Rome',
});

test('ordinary v1 and optional country fields decode to detached frozen records', () => {
  const input = {...city, countryName: 'Italia', countryCode: 'IT'};
  const result = decodeOfflinePlaceResults({protocolVersion: 1, items: [input]});
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result[0]));
  assert.equal(result[0].countryCode, 'IT');
  assert.equal(result[0].name, 'Città Fittizia');
  input.name = 'changed after response';
  assert.equal(result[0].name, 'Città Fittizia');
  assert.equal(decodeOfflinePlaceResults({protocolVersion: 1, items: [city]})[0].countryCode, null);
  assert.deepEqual(decodeOfflinePlaceResults({protocolVersion: 1, items: []}), []);
});

test('holes, inherited indices and accessor array entries never pass as checked results', () => {
  const sparse = Array(1);
  const inheritedIndex = Array(1);
  Object.setPrototypeOf(inheritedIndex, Object.assign(Object.create(Array.prototype), {0: city}));
  const getterIndex = [city];
  Object.defineProperty(getterIndex, '0', {
    enumerable: true, configurable: true, get() { throw Error('private path'); },
  });
  const extra = [city];
  extra.extra = 'not JSON wire data';
  for (const items of [sparse, inheritedIndex, getterIndex, extra]) {
    assert.throws(() => decodeOfflinePlaceResults({protocolVersion: 1, items}));
  }
});

test('accessor-backed top-level and row fields fail without invoking getters', () => {
  let getterCount = 0;
  const getter = () => { getterCount++; throw Error('private native detail'); };
  const root = {protocolVersion: 1, items: [city]};
  Object.defineProperty(root, 'items', {enumerable: true, get: getter});
  const row = {...city};
  Object.defineProperty(row, 'name', {enumerable: true, get: getter});
  for (const input of [root, {protocolVersion: 1, items: [row]}]) {
    assert.throws(() => decodeOfflinePlaceResults(input));
  }
  assert.equal(getterCount, 0, 'must read descriptors, not getters');
});

test('inherited fields and non-plain IPC records fail closed', () => {
  const inherited = Object.assign(Object.create(city), {id: 18});
  const nonPlain = new (class Place {
    constructor() { Object.assign(this, city); }
  })();
  const badRoot = Object.assign(Object.create({protocolVersion: 1}), {items: [city]});
  for (const input of [
    {protocolVersion: 1, items: [inherited]},
    {protocolVersion: 1, items: [nonPlain]},
    badRoot,
  ]) assert.throws(() => decodeOfflinePlaceResults(input));
  const nullPrototype = Object.assign(Object.create(null), city);
  assert.equal(decodeOfflinePlaceResults({protocolVersion: 1, items: [nullPrototype]})[0].id, 17);
});

test('non-enumerable fields do not masquerade as valid JSON data', () => {
  const hidden = {...city};
  Object.defineProperty(hidden, 'name', {value:'Hidden', enumerable:false});
  assert.throws(() => decodeOfflinePlaceResults({protocolVersion: 1, items:[hidden]}));
});

test('missing required record fields and malicious optional country field fail', () => {
  const missingZone = {...city};
  delete missingZone.timeZone;
  const country = {...city};
  Object.defineProperty(country, 'countryCode', {
    enumerable: true, get() { throw Error('private country lookup'); },
  });
  assert.throws(() => decodeOfflinePlaceResults({protocolVersion: 1, items: [missingZone]}));
  assert.throws(() => decodeOfflinePlaceResults({protocolVersion: 1, items: [country]}));
});

test('invalid native IPC batch becomes generic unavailable state, without leaking record data', async () => {
  const fake = new OfflinePlaceSearch({
    isNative: () => true,
    invoke: async () => ({protocolVersion: 1, items: Array(1)}),
  });
  assert.deepEqual(await fake.search('Fittizia'), {kind: 'unavailable', items: []});
});
