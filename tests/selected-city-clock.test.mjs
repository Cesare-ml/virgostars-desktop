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
