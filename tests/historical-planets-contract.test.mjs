import test from 'node:test';
import assert from 'node:assert/strict';
import {requestHistoricalPlanet, validHistoricalRequest} from '../src/app/native/historical-planets-contract.ts';

const request = Object.freeze({body: 'Moon', jdUt1: 2451545, deltaTSeconds: 64, uncertaintySeconds: 1, deltaTSource: 'synthetic'});
const result = () => ({...request, jdTt: 2451545.00074, jdTdb: 2451545.00074, longitudeDeg: 223,
  latitudeDeg: 4, distanceAu: 0.0025, longitudeSpeedDegPerTdbDay: 12, latitudeSpeedDegPerTdbDay: 0.2,
  radialSpeedAuPerTdbDay: 0.00001, radialCorrectionApplied: true});
const ok = () => ({protocolVersion: 1, status: 'ok', result: result()});

test('rejects invalid times, bodies and ambiguous source labels before invocation', async () => {
  let calls = 0;
  const transport = {isNative: () => true, invoke: async () => { calls++; return ok(); }};
  for (const invalid of [{...request, jdUt1: NaN}, {...request, uncertaintySeconds: -1},
    {...request, deltaTSource: ' '}, {...request, deltaTSource: 'è'.repeat(101)}, {...request, body: 'Earth'}]) {
    assert.equal(validHistoricalRequest(invalid), false);
    assert.equal((await requestHistoricalPlanet(transport, invalid)).kind, 'invalid_request');
  }
  assert.equal(calls, 0);
});

test('sends explicit UT1 and returns detached data', async () => {
  let sent;
  const raw = ok();
  const transport = {isNative: () => true, invoke: async (...args) => { sent = args; return raw; }};
  const actual = await requestHistoricalPlanet(transport, request);
  assert.deepEqual(sent, ['calculate_historical_planet', {request: {...request, protocolVersion: 1}}]);
  assert.equal(actual.kind, 'ready');
  assert.ok(Object.isFrozen(actual.planet));
  raw.result.longitudeDeg = 10;
  assert.equal(actual.planet.longitudeDeg, 223);
});

test('rejects malformed or inconsistent native output', async () => {
  for (const mutate of [r => { r.result.jdUt1++; }, r => { r.result.deltaTSource = 'different'; },
    r => { r.result.longitudeDeg = 360; }, r => { r.result.distanceAu = NaN; },
    r => { Object.defineProperty(r.result, 'latitudeDeg', {get: () => 2, enumerable: true}); },
    r => { r.protocolVersion = 2; }]) {
    const raw = ok(); mutate(raw);
    assert.equal((await requestHistoricalPlanet({isNative: () => true, invoke: async () => raw}, request)).kind, 'unavailable');
  }
});

test('reports missing provider and non-native context without substitution', async () => {
  assert.equal((await requestHistoricalPlanet({isNative: () => false, invoke: async () => ok()}, request)).kind, 'not_native');
  assert.equal((await requestHistoricalPlanet({isNative: () => true, invoke: async () => ({protocolVersion: 1, status: 'provider_unavailable'})}, request)).kind, 'provider_unavailable');
});
