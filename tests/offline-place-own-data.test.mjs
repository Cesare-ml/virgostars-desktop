import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeOfflinePlaceResults} from '../src/app/native/offline-places-contract.ts';

const city = Object.freeze({
  id: 17, name: 'Città Fittizia', italianName: null,
  latMicro: 41234567, lngMicro: 12345678,
  population: 1234, stateId: null, region: 'Fictional Province',
  timeZone: 'Europe/Rome',
});
const reply = items => ({protocolVersion: 1, items});

test('v1 and v2 data-only JSON rows retain their exact validated values', () => {
  const decoded = decodeOfflinePlaceResults(reply([city, {
    ...city, id: 18, countryName: 'Italia', countryCode: 'IT',
  }]));
  assert.equal(decoded.length, 2);
  assert.equal(decoded[0].name, 'Città Fittizia');
  assert.equal(decoded[0].countryName, null);
  assert.equal(decoded[0].countryCode, null);
  assert.equal(decoded[1].countryName, 'Italia');
  assert.equal(decoded[1].countryCode, 'IT');
  assert.equal(decoded[1].latMicro, city.latMicro);
});

test('sparse and accessor-backed response arrays are rejected rather than silently skipped', () => {
  const sparse = Array(2);
  sparse[1] = city;
  const getterEntries = [city];
  Object.defineProperty(getterEntries, '0', {
    configurable: true,
    enumerable: true,
    get() { throw new Error('private catalog path'); },
  });
  for (const rows of [sparse, getterEntries]) {
    assert.throws(() => decodeOfflinePlaceResults(reply(rows)),
      {message: 'Invalid offline place protocol'});
  }
});

test('outer protocol fields must be own data properties; do not invoke reply getters', () => {
  for (const bad of [
    Object.create({protocolVersion: 1, items: [city]}),
    Object.defineProperty({items: [city]}, 'protocolVersion', {
      get() { throw new Error('private version getter'); },
    }),
    Object.defineProperty({protocolVersion: 1}, 'items', {
      get() { throw new Error('private records getter'); },
    }),
  ]) {
    assert.throws(() => decodeOfflinePlaceResults(bad),
      {message: 'Invalid offline place protocol'});
  }
});

test('required city fields cannot be inherited or supplied through getters', () => {
  const inherited = Object.assign(Object.create({id: 17}), {...city});
  delete inherited.id;
  const getter = {...city};
  Object.defineProperty(getter, 'timeZone', {
    get() { throw new Error('sensitive timezone getter'); },
  });
  const fake = {...city};
  Object.defineProperty(fake, 'name', {
    get() { return 'Città Camuffata'; },
  });
  for (const row of [inherited, getter, fake]) {
    assert.throws(() => decodeOfflinePlaceResults(reply([row])),
      {message: 'Invalid offline place protocol'});
  }
});

test('optional country fields may be absent but must be data when present', () => {
  const absent = decodeOfflinePlaceResults(reply([city]))[0];
  assert.equal(absent.countryCode, null);
  const invalid = {...city};
  Object.defineProperty(invalid, 'countryCode', {
    get() { throw new Error('private lookup details'); },
  });
  assert.throws(() => decodeOfflinePlaceResults(reply([invalid])),
    {message: 'Invalid offline place protocol'});
});

test('revoked proxies and malformed object traps fail closed with sanitized errors', () => {
  const revoked = Proxy.revocable({...city}, {});
  revoked.revoke();
  const trap = new Proxy({...city}, {
    getOwnPropertyDescriptor() { throw new Error('C:/private/world-cities.sqlite'); },
  });
  for (const value of [revoked.proxy, trap]) {
    assert.throws(() => decodeOfflinePlaceResults(reply([value])),
      {message: 'Invalid offline place protocol'});
  }
});

test('bad rows still fail validation without partially accepting a list', () => {
  for (const bad of [
    {...city, latMicro: 90_000_001},
    {...city, id: -1},
    {...city, name: ''},
    {...city, countryCode: 'ITA'},
  ]) {
    assert.throws(() => decodeOfflinePlaceResults(reply([city, bad])),
      {message: 'Invalid offline place protocol'});
  }
  assert.throws(() => decodeOfflinePlaceResults(reply([city, city])),
    {message: 'Invalid offline place protocol'});
});
