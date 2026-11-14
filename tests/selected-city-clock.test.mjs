import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedCityClockAt} from '../src/app/device-clock.ts';

const city = timeZone => ({timeZone});

test('a selected city uses its own zone, never device local time', () => {
  const ms = Date.parse('2026-11-12T17:02:03.000Z');
  const rome = selectedCityClockAt(ms, city('Europe/Rome'), 'it');
  const ny = selectedCityClockAt(ms, city('America/New_York'), 'en');
  assert.equal(rome.kind, 'ready');
  assert.equal(rome.timeZone, 'Europe/Rome');
  assert.match(rome.text, /18:02:03/);
  assert.equal(ny.kind, 'ready');
  assert.equal(ny.timeZone, 'America/New_York');
  assert.match(ny.text, /12:02:03/);
});

test('summer/winter and DST transitions follow the platform IANA database', () => {
  for (const [instant, expected] of [
    ['2026-01-12T12:00:00.000Z', '13:00:00'],
    ['2026-07-12T12:00:00.000Z', '14:00:00'],
    ['2026-03-29T00:59:59.000Z', '01:59:59'],
    ['2026-03-29T01:00:00.000Z', '03:00:00'],
    ['2026-10-25T00:59:59.000Z', '02:59:59'],
    ['2026-10-25T01:00:00.000Z', '02:00:00'],
  ]) {
    const actual = selectedCityClockAt(Date.parse(instant), city('Europe/Rome'), 'it');
    assert.equal(actual.kind, 'ready');
    assert.match(actual.text, new RegExp(expected), `${instant} -> ${actual.text}`);
  }
});

test('absent and invalid city zones fail closed, without device-time fallback', () => {
  assert.deepEqual(selectedCityClockAt(Date.now(), null, 'it'), {kind:'not_selected'});
  for (const zone of [null, '', 'Nonexistent/No_Zone', '../../etc/passwd',
    'Europe/Rome\nother', 'x'.repeat(81)]) {
    assert.deepEqual(selectedCityClockAt(Date.now(), city(zone), 'en'), {kind: 'unavailable'});
  }
});

test('invalid clock instants are unavailable, not displayed as the Unix epoch', () => {
  assert.deepEqual(selectedCityClockAt(NaN, city('Europe/Rome'), 'it'), {kind: 'unavailable'});
  assert.deepEqual(selectedCityClockAt(Infinity, city('Europe/Rome'), 'en'), {kind:'unavailable'});
});

test('UTC is a valid explicit city timezone and both languages format', () => {
  const instant = Date.parse('2026-11-12T16:14:15.000Z');
  for (const locale of ['it','en']) {
    const state = selectedCityClockAt(instant, city('UTC'), locale);
    assert.equal(state.kind, 'ready');
    assert.match(state.text, /16:14:15/);
  }
});


test('malformed city runtime values fail closed without throwing or device-zone fallback', () => {
  const instant = Date.parse('2026-11-12T17:02:03.000Z');
  for (const invalidCity of [undefined, false, 42, 'Europe/Rome', [], Object.create(null)]) {
    assert.deepEqual(selectedCityClockAt(instant, invalidCity, 'it'), {kind: 'unavailable'});
  }
  assert.deepEqual(selectedCityClockAt(instant, null, 'it'), {kind: 'not_selected'});
});

test('city timezone access is snapshotted once; hostile accessors cannot crash the clock', () => {
  const instant = Date.parse('2026-11-12T17:02:03.000Z');
  let reads = 0;
  const changing = {
    get timeZone() {
      reads++;
      if (reads > 1) throw new Error('private accessor details');
      return 'Europe/Rome';
    },
  };
  const result = selectedCityClockAt(instant, changing, 'it');
  assert.equal(reads, 1);
  assert.equal(result.kind, 'ready');
  assert.equal(result.timeZone, 'Europe/Rome');
  assert.match(result.text, /18:02:03/);

  const broken = {
    get timeZone() { throw new Error('private location details must not escape'); },
  };
  assert.deepEqual(selectedCityClockAt(instant, broken, 'en'), {kind: 'unavailable'});

  const revoked = Proxy.revocable({timeZone: 'Europe/Rome'}, {});
  revoked.revoke();
  assert.deepEqual(selectedCityClockAt(instant, revoked.proxy, 'en'), {kind: 'unavailable'});
});

test('untrusted city timezone access never aborts live clock rendering', () => {
  const timestamp = Date.parse('2026-11-12T17:02:03Z');
  const getterThrows = Object.defineProperty({}, 'timeZone', {
    get() { throw new Error('private local data must not escape'); },
  });
  const proxyThrows = new Proxy({}, {get() { throw new Error('untrusted proxy'); }});
  const revoked = Proxy.revocable({timeZone: 'Europe/Rome'}, {});
  revoked.revoke();
  for (const unexpected of [undefined, getterThrows, proxyThrows, revoked.proxy]) {
    assert.doesNotThrow(() => selectedCityClockAt(timestamp, unexpected, 'it'));
    assert.deepEqual(selectedCityClockAt(timestamp, unexpected, 'it'), {kind: 'unavailable'});
  }
});

test('selected city timezone is captured once, including when accessors mutate', () => {
  const timestamp = Date.parse('2026-11-12T17:02:03Z');
  let reads = 0;
  const cityWithChangingGetter = {
    get timeZone() {
      reads++;
      return reads === 1 ? 'Europe/Rome' : 'America/New_York';
    },
  };
  const state = selectedCityClockAt(timestamp, cityWithChangingGetter, 'en');
  assert.equal(state.kind, 'ready');
  assert.equal(state.timeZone, 'Europe/Rome');
  assert.match(state.text, /18:02:03/);
  assert.equal(reads, 1, 'the zone used for formatting must match the returned zone');
});

test('malformed city input cannot borrow the device timezone', () => {
  const timestamp = Date.parse('2026-11-12T17:02:03Z');
  for (const unexpected of [false, 0, 'Europe/Rome', Object.create(null)]) {
    assert.deepEqual(selectedCityClockAt(timestamp, unexpected, 'en'), {kind: 'unavailable'});
  }
});
