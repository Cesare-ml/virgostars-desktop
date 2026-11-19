import test from 'node:test';
import assert from 'node:assert/strict';
import {ReturnMapGeocoder} from '../src/app/return-map-geocode.ts';

test('reverse lookup runs only for valid coordinates, caches results and rate limits repeated clicks', async t => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url.origin, 'https://nominatim.openstreetmap.org');
    assert.equal(url.searchParams.get('lat'), '41.9');
    assert.equal(options.credentials, 'omit');
    return new Response(JSON.stringify({address:{city:'Roma', country:'Italia'}}));
  };
  t.after(() => {globalThis.fetch = original;});
  const geocoder = new ReturnMapGeocoder(), signal = new AbortController().signal;
  assert.equal(await geocoder.lookup(91_000_000, 0, signal), '');
  assert.equal(await geocoder.lookup(41_900_000, 12_500_000, signal), 'Roma, Italia');
  assert.equal(await geocoder.lookup(41_900_000, 12_500_000, signal), 'Roma, Italia');
  assert.equal(await geocoder.lookup(42_000_000, 12_500_000, signal), '');
  assert.equal(calls, 1);
});

test('failed, aborted or oversized responses leave the location name empty', async t => {
  const original = globalThis.fetch;
  t.after(() => {globalThis.fetch = original;});
  globalThis.fetch = async () => { throw new Error('offline'); };
  assert.equal(await new ReturnMapGeocoder().lookup(0,0,new AbortController().signal), '');
  globalThis.fetch = async () => new Response('x'.repeat(65537));
  assert.equal(await new ReturnMapGeocoder().lookup(0,0,new AbortController().signal), '');
});
