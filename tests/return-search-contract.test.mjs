import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeReturnResponse, requestReturns, validReturnRequest,
} from '../src/app/native/return-search-contract.ts';
import {
  formatReturnInstant, parseReturnYear, returnChartName, validTimeZone,
} from '../src/app/returns-form.ts';

const J2000 = 2451545.0;
// Fictional evenly spaced instants; not an ephemeris.
const instant = days => ({
  utcIso: new Date(Date.UTC(2000, 0, 1, 12) + days * 86_400_000).toISOString(),
  julianDayUt: J2000 + days,
});
const okResponse = () => ({
  protocolVersion: 1, status: 'ok',
  provider: {id: 'virgostars_ephemeris', engineVersion: 'test'},
  instants: [instant(10), instant(37.25), instant(64.5)],
});
const REQUEST = Object.freeze({body: 'Moon', targetLongitudeDeg: 223.3238, year: 2000});

test('returned instants are copied into detached frozen values', () => {
  const raw = okResponse();
  const decoded = decodeReturnResponse(raw);
  assert.equal(decoded.status, 'ok');
  assert.equal(decoded.instants.length, 3);
  assert.equal(decoded.instants[0].utcIso, '2000-01-11T12:00:00.000Z');
  assert.ok(Object.isFrozen(decoded.instants) && Object.isFrozen(decoded.instants[0]));
  raw.instants[0].utcIso = '1999-01-01T00:00:00.000Z';
  assert.equal(decoded.instants[0].utcIso, '2000-01-11T12:00:00.000Z');
  assert.deepEqual(decodeReturnResponse({...okResponse(), instants: []}).instants, []);
});

test('failure statuses carry no provider or instants', () => {
  for (const status of ['provider_unavailable', 'invalid_request', 'calculation_failed']) {
    assert.deepEqual(decodeReturnResponse({protocolVersion: 1, status, provider: null, instants: null}), {status});
  }
});

test('malformed, unordered or self-contradictory responses are rejected', () => {
  const mutations = [
    r => { r.protocolVersion = 2; },
    r => { r.status = 'fine'; },
    r => { r.provider = null; },
    r => { r.provider.id = 'VirgoStars Ephemeris'; },
    r => { r.instants = null; },
    r => { r.instants[1].julianDayUt = r.instants[0].julianDayUt; },
    r => { r.instants.reverse(); },
    r => { r.instants[0].utcIso = '2000-01-11T12:00:00Z'; },
    r => { r.instants[0].utcIso = '2000-01-11 12:00:00.000Z'; },
    r => { r.instants[0].utcIso = '2000-01-12T12:00:00.000Z'; },
    r => { r.instants[0].julianDayUt = Number.NaN; },
    r => { r.instants[0].julianDayUt = '2451555'; },
    r => { delete r.instants[2].utcIso; },
    r => { r.instants = Array.from({length: 17}, (_, index) => instant(index)); },
    r => { r.instants.length = 5; },
    r => { Object.defineProperty(r.instants[0], 'utcIso', {get: () => 'x', enumerable: true}); },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const raw = okResponse();
    mutate(raw);
    assert.throws(() => decodeReturnResponse(raw), {message: 'Invalid return search protocol'}, 'mutation ' + index);
  }
});

test('request bounds are enforced before any native call', async () => {
  assert.ok(validReturnRequest(REQUEST));
  assert.ok(validReturnRequest({body: 'Sun', targetLongitudeDeg: 0, year: 1600}));
  const calls = [];
  const transport = {isNative: () => true, invoke: async (...args) => { calls.push(args); return okResponse(); }};
  for (const bad of [
    {...REQUEST, body: 'Mars'}, {...REQUEST, targetLongitudeDeg: 360}, {...REQUEST, targetLongitudeDeg: -1},
    {...REQUEST, targetLongitudeDeg: Number.NaN}, {...REQUEST, year: 1599}, {...REQUEST, year: 2401},
    {...REQUEST, year: 2000.5}, null,
  ]) {
    assert.deepEqual(await requestReturns(transport, bad), {kind: 'invalid_request'});
  }
  assert.equal(calls.length, 0);
});

test('one native call carries only the body, the longitude and the year', async () => {
  const calls = [];
  const transport = {isNative: () => true, invoke: async (...args) => { calls.push(args); return okResponse(); }};
  const result = await requestReturns(transport, {...REQUEST, name: 'never forwarded', birth: '2000-01-01'});
  assert.equal(result.kind, 'ready');
  assert.equal(result.instants.length, 3);
  assert.deepEqual(calls, [['find_returns', {
    request: {protocolVersion: 1, body: 'Moon', targetLongitudeDeg: 223.3238, year: 2000},
  }]]);
});

test('browser preview, missing provider and native failures stay distinct and opaque', async () => {
  const never = async () => { throw new Error('must not be called'); };
  assert.deepEqual(await requestReturns({isNative: () => false, invoke: never}, REQUEST), {kind: 'not_native'});
  for (const status of ['provider_unavailable', 'invalid_request', 'calculation_failed']) {
    const transport = {isNative: () => true, invoke: async () => ({protocolVersion: 1, status, provider: null, instants: null})};
    assert.deepEqual(await requestReturns(transport, REQUEST), {kind: status});
  }
  const rejected = {isNative: () => true, invoke: async () => { throw new Error('private detail'); }};
  assert.deepEqual(await requestReturns(rejected, REQUEST), {kind: 'unavailable'});
});

test('return charts are named from the kind, the UTC date and the radix', () => {
  assert.equal(returnChartName('solar', '2026-07-20T04:45:10.123Z', 'Soggetto di prova'), 'RS 2026 Soggetto di prova');
  assert.equal(returnChartName('lunar', '2026-03-14T22:01:00.000Z', ' Soggetto di prova '), 'RL 2026-03-14 Soggetto di prova');
  assert.equal(returnChartName('solar', '2026-07-20T04:45:10.123Z', ''), 'RS 2026');
  assert.equal(returnChartName('lunar', '2026-03-14T22:01:00.000Z', 'x'.repeat(200)).length, 80);
});

test('years, zones and instants are validated and formatted without guessing', () => {
  assert.equal(parseReturnYear(' 2026 '), 2026);
  for (const bad of ['', '26', '20260', '1599', '2401', '2026.0', 'MMXXVI', '-2026']) {
    assert.equal(parseReturnYear(bad), null, bad);
  }
  assert.ok(validTimeZone('Europe/Rome'));
  assert.ok(validTimeZone('UTC'));
  for (const bad of ['+01:00', 'Mars/Olympus_Mons', '', 'Europe/Rome; x']) assert.equal(validTimeZone(bad), false, bad);
  assert.match(formatReturnInstant('2000-07-01T10:00:00.000Z', 'Europe/Rome', 'it'), /12:00:00/);
  assert.match(formatReturnInstant('2000-01-01T10:00:00.000Z', 'Europe/Rome', 'en'), /11:00:00/);
  assert.equal(formatReturnInstant('2000-01-01T10:00:00.000Z', 'Not/AZone', 'it'), '2000-01-01T10:00:00.000Z');
});
