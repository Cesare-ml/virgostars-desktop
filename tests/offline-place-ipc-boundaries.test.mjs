import test from 'node:test';
import assert from 'node:assert/strict';
import {OfflinePlaceSearch} from '../src/app/native/offline-places-contract.ts';

const place = Object.freeze({
  id: 41, name: 'Fictional City', italianName: null,
  latMicro: 1_000_000, lngMicro: -2_000_000,
  population: null, stateId: null, region: null, timeZone: 'Etc/UTC',
  countryName: null, countryCode: null,
});
const response = (items) => ({protocolVersion: 1, items});

function makeSearch(reply = response([place])) {
  const calls = [];
  const search = new OfflinePlaceSearch({
    isNative: () => true,
    invoke: async (command, args) => { calls.push({command, args}); return reply; },
  });
  return {search, calls};
}

test('reject punctuation-only and single Unicode-alphanumeric input before IPC', async () => {
  const {search, calls} = makeSearch();
  for (const query of ['--', '😀😀', 'a!', '-1-', '\u{10400}', '   ', '\u{10400}😀']) {
    assert.equal((await search.search(query)).kind, 'query_too_short', query);
  }
  assert.equal(calls.length, 0);
});

test('accept exactly two Unicode letters or numbers, including non-BMP characters', async () => {
  const {search, calls} = makeSearch();
  for (const query of ['中日', 'ΩЖ', 'A9', '\u{10400}\u{10401}', 'a-2']) {
    const result = await search.search(query, 2);
    assert.equal(result.kind, 'ready', query);
  }
  assert.equal(calls.length, 5);
});

test('80 Unicode scalar values are accepted and 81 are blocked regardless of code units', async () => {
  const {search, calls} = makeSearch();
  assert.equal((await search.search('\u{10400}'.repeat(80))).kind, 'ready');
  assert.equal((await search.search('\u{10400}'.repeat(81))).kind, 'query_too_short');
  assert.equal(calls.length, 1);
});

test('reply with more rows than requested fails closed without showing any rows', async () => {
  const two = [{...place}, {...place, id: 42}];
  const {search} = makeSearch(response(two));
  assert.deepEqual(await search.search('Firenze', 1), {kind: 'unavailable', items: []});
  assert.equal((await search.search('Firenze', 2)).items.length, 2);
});

test('the native error mapper does not invoke hostile toString or valueOf methods', async () => {
  let coerced = 0;
  const hostile = {
    toString() { coerced++; throw new Error('private path leak'); },
    valueOf() { coerced++; throw new Error('private path leak'); },
  };
  const search = new OfflinePlaceSearch({
    isNative: () => true,
    invoke: async () => { throw hostile; },
  });
  assert.deepEqual(await search.search('Rome'), {kind: 'unavailable', items: []});
  assert.equal(coerced, 0);
});

test('native rejects objects without prototypes or with throwing property access safely', async () => {
  for (const cause of [Object.create(null), new Proxy({}, {get() { throw Error('unsafe'); }})]) {
    const search = new OfflinePlaceSearch({
      isNative: () => true, invoke: async () => { throw cause; },
    });
    assert.equal((await search.search('Rome')).kind, 'unavailable');
  }
});

test('only exact Rust error strings map to known retry states', async () => {
  let error = 'PLACE_SEARCH_BUSY';
  const search = new OfflinePlaceSearch({
    isNative: () => true, invoke: async () => { throw error; },
  });
  assert.equal((await search.search('Rome')).kind, 'busy');
  error = 'PLACE_CATALOG_UNAVAILABLE';
  assert.equal((await search.search('Rome')).kind, 'catalog_unavailable');
  error = 'PLACE_SEARCH_BUSY private path';
  assert.equal((await search.search('Rome')).kind, 'unavailable');
  error = new Error('PLACE_SEARCH_BUSY');
  assert.equal((await search.search('Rome')).kind, 'unavailable');
});

test('clearing an in-flight native response takes precedence over its row-count error', async () => {
  let resolve;
  const search = new OfflinePlaceSearch({
    isNative: () => true,
    invoke: () => new Promise(ok => { resolve = ok; }),
  });
  const request = search.search('Roma', 1);
  search.clear();
  resolve(response([{...place}, {...place, id: 99}]));
  assert.deepEqual(await request, {kind: 'stale', items: []});
});
