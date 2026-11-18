import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeArchiveResponse, newChartId, requestArchive, validChartRecord, validPhotoBytes,
} from '../src/app/native/chart-archive-contract.ts';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
// Visibly fictional subject and place.
const record = (id = ID_A, name = 'Soggetto di prova') => ({
  id, name, utcIso: '2001-02-03T04:05:06.000Z', timeZone: 'Europe/Rome',
  latMicro: 44_697_805, lngMicro: 11_805_778, placeName: 'Luogo di prova',
});
const saved = (id, name) => ({...record(id, name), createdAtMs: 1000, updatedAtMs: 2000});
const okResponse = () => ({protocolVersion: 1, status: 'ok', charts: [saved(ID_A, 'Alfa'), saved(ID_B, 'Beta')], legacyPresent: false});
const native = reply => {
  const calls = [];
  return {calls, isNative: () => true, invoke: async (...args) => { calls.push(args); return reply(); }};
};

test('a native list is copied into detached frozen records', () => {
  const raw = okResponse();
  const decoded = decodeArchiveResponse(raw);
  assert.equal(decoded.status, 'ok');
  assert.deepEqual(decoded.charts.map(chart => chart.name), ['Alfa', 'Beta']);
  assert.ok(Object.isFrozen(decoded.charts) && Object.isFrozen(decoded.charts[0]));
  raw.charts[0].name = 'changed later';
  assert.equal(decoded.charts[0].name, 'Alfa');
  assert.deepEqual(decodeArchiveResponse({protocolVersion: 1, status: 'ok', charts: [], legacyPresent: false}).charts, []);
  assert.equal(decoded.legacyPresent, false);
  assert.equal(decodeArchiveResponse({...okResponse(), legacyPresent: true}).legacyPresent, true);
});

test('device-only photo metadata and image bytes are independent of saved-chart DTOs', async () => {
  const jpeg = [255, 216, 255, 224, 0, 0, 0, 255, 217];
  const response = {...okResponse(), photoIds:[ID_A], photoData:jpeg};
  const result = decodeArchiveResponse(response);
  assert.deepEqual(result.photoIds, [ID_A]);
  assert.deepEqual(result.photoData, jpeg);
  assert.ok(!Object.hasOwn(result.charts[0], 'photoData'));
  response.photoData[3] = 3;
  assert.equal(result.photoData[3], 224, 'photo bytes detached from mutable IPC response');
  const transport = native(() => ({...okResponse(), photoIds:[ID_A], photoData:null}));
  assert.equal((await requestArchive(transport, {operation:'photo_save', id:ID_A, photoData:jpeg})).kind, 'ready');
  await requestArchive(transport, {operation:'photo_read', id:ID_A});
  await requestArchive(transport, {operation:'photo_delete', id:ID_A});
  assert.deepEqual(transport.calls, [
    ['chart_archive', {request:{protocolVersion:1,operation:'photo_save',id:ID_A,photoData:jpeg}}],
    ['chart_archive', {request:{protocolVersion:1,operation:'photo_read',id:ID_A}}],
    ['chart_archive', {request:{protocolVersion:1,operation:'photo_delete',id:ID_A}}],
  ]);
  assert.equal(validPhotoBytes(jpeg), true);
  for (const bad of [[], [1, 2], Array(9).fill(255), [255,216,255,224,0,0,0,255,999]]) {
    assert.equal(validPhotoBytes(bad), false);
    assert.deepEqual(await requestArchive(transport, {operation:'photo_save', id:ID_A, photoData:bad}), {kind:'invalid_request'});
  }
});

test('photo ID lists cannot smuggle unknown chart IDs or invalid bytes through native IPC', () => {
  for (const photoIds of [[ID_B, ID_B], ['../../bad'], [ID_A, ID_A]]) {
    assert.throws(() => decodeArchiveResponse({...okResponse(), photoIds}), /Invalid chart archive protocol/);
  }
  assert.throws(() => decodeArchiveResponse({...okResponse(), photoData:[255,216,255,0,0,0,0,0,0]}), /Invalid chart archive protocol/);
});

test('every archive failure state is passed through without details', () => {
  for (const status of ['invalid_request', 'not_found', 'archive_full', 'archive_unavailable', 'archive_corrupt', 'archive_newer', 'archive_locked']) {
    assert.deepEqual(decodeArchiveResponse({protocolVersion: 1, status, charts: null}), {status});
  }
});

test('malformed or hostile archive contents are rejected with one generic error', () => {
  const mutations = [
    r => { r.protocolVersion = 2; },
    r => { r.status = 'fine'; },
    r => { r.charts = null; },
    r => { delete r.legacyPresent; },
    r => { r.legacyPresent = 'yes'; },
    r => { r.charts[1].id = ID_A; },
    r => { r.charts[0].id = '../../secret'; },
    r => { r.charts[0].id = 'AAAAAAAA-1111-4111-8111-111111111111'; },
    r => { r.charts[0].name = 'x'.repeat(81); },
    r => { r.charts[0].name = 'two\nlines'; },
    r => { r.charts[0].name = 'hidden\u202e'; },
    r => { r.charts[0].name = ' padded'; },
    r => { r.charts[0].name = 42; },
    r => { r.charts[0].utcIso = '2001-02-03T04:05:06+01:00'; },
    r => { r.charts[0].timeZone = 'Europe/Rome<script>'; },
    r => { r.charts[0].latMicro = 90_000_001; },
    r => { r.charts[0].lngMicro = 11.5; },
    r => { r.charts[0].updatedAtMs = 999; },
    r => { r.charts[0].createdAtMs = -1; },
    r => { delete r.charts[0].placeName; },
    r => { r.charts.length = 3; },
    r => { Object.defineProperty(r.charts[0], 'name', {get: () => 'Alfa', enumerable: true}); },
    r => { r.charts[0] = Object.create(saved(ID_A, 'Alfa')); },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const raw = okResponse();
    mutate(raw);
    assert.throws(() => decodeArchiveResponse(raw), {message: 'Invalid chart archive protocol'}, 'mutation ' + index);
  }
  for (const raw of [null, 'ok', [], new Map()]) {
    assert.throws(() => decodeArchiveResponse(raw), {message: 'Invalid chart archive protocol'});
  }
});

test('records are validated with the same bounds the native side enforces', () => {
  assert.ok(validChartRecord(record()));
  assert.ok(validChartRecord({...record(), name: ''}));
  assert.ok(validChartRecord({...record(), utcIso: '2001-02-03T04:05:06Z'}));
  for (const bad of [
    {...record(), id: 'abc'}, {...record(), name: 'x'.repeat(81)}, {...record(), placeName: 'p'.repeat(161)},
    {...record(), timeZone: '+01:00'}, {...record(), timeZone: ''}, {...record(), latMicro: -90_000_001},
    {...record(), lngMicro: 180_000_001}, {...record(), utcIso: 'yesterday'}, null,
  ]) assert.equal(validChartRecord(bad), false);
});

test('each operation makes one native call carrying only reviewed fields', async () => {
  const transport = native(okResponse);
  assert.equal((await requestArchive(transport, {operation: 'list'})).kind, 'ready');
  const result = await requestArchive(transport, {operation: 'save', chart: {...record(), notes: 'never forwarded'}});
  assert.equal(result.kind, 'ready');
  assert.equal(result.charts.length, 2);
  await requestArchive(transport, {operation: 'delete', id: ID_B});
  await requestArchive(transport, {operation: 'remove_legacy', path: 'C:/never-forwarded'});
  assert.deepEqual(transport.calls, [
    ['chart_archive', {request: {protocolVersion: 1, operation: 'list'}}],
    ['chart_archive', {request: {protocolVersion: 1, operation: 'save', chart: record()}}],
    ['chart_archive', {request: {protocolVersion: 1, operation: 'delete', id: ID_B}}],
    ['chart_archive', {request: {protocolVersion: 1, operation: 'remove_legacy'}}],
  ]);
});

test('invalid operations never reach the native side', async () => {
  const transport = native(okResponse);
  for (const bad of [
    {operation: 'drop'}, {operation: 'save', chart: {...record(), id: 'x'}}, {operation: 'save'},
    {operation: 'delete', id: '../x'}, {operation: 'delete'}, null, 'list',
  ]) {
    assert.deepEqual(await requestArchive(transport, bad), {kind: 'invalid_request'});
  }
  assert.equal(transport.calls.length, 0);
});

test('browser preview, archive states and native failures stay distinct and opaque', async () => {
  const never = async () => { throw new Error('must not be called'); };
  assert.deepEqual(await requestArchive({isNative: () => false, invoke: never}, {operation: 'list'}), {kind: 'not_native'});
  for (const status of ['not_found', 'archive_full', 'archive_corrupt', 'archive_newer', 'archive_unavailable', 'archive_locked']) {
    const transport = native(() => ({protocolVersion: 1, status, charts: null}));
    assert.deepEqual(await requestArchive(transport, {operation: 'list'}), {kind: status});
  }
  const rejected = {isNative: () => true, invoke: async () => { throw new Error('C:\\Users\\someone\\charts.sqlite3'); }};
  assert.deepEqual(await requestArchive(rejected, {operation: 'list'}), {kind: 'unavailable'});
  assert.deepEqual(await requestArchive(native(() => ({status: 'ok'})), {operation: 'list'}), {kind: 'unavailable'});
});

test('chart ids are canonical lowercase UUIDs from the platform generator', () => {
  assert.match(newChartId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(newChartId(), newChartId());
  assert.equal(newChartId(() => ID_A.toUpperCase()), ID_A);
  assert.throws(() => newChartId(() => 'not-a-uuid'), /Invalid chart id source/);
});
