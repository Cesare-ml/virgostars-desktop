import test from 'node:test';
import assert from 'node:assert/strict';
import {currentSkyInput} from '../src/app/astro/current-sky-input.ts';

const city = {name:'Rome', latMicro:41902800, lngMicro:12496200, timeZone:'Europe/Rome'};

test('current sky uses the same UTC instant and the selected city coordinates', () => {
  const winter = currentSkyInput('2026-01-15T12:00:00.000Z', city);
  assert.equal(winter.utcIso, '2026-01-15T12:00:00.000Z');
  assert.equal(winter.localDate, '2026-01-15');
  assert.equal(winter.localTime, '13:00:00');
  assert.equal(winter.offsetSeconds, 3600);
  assert.equal(winter.latMicro, city.latMicro);
  const summer = currentSkyInput('2026-07-15T12:00:00.000Z', city);
  assert.equal(summer.localTime, '14:00:00');
  assert.equal(summer.offsetSeconds, 7200);
});

test('current sky preserves calendar rollover and refuses invalid zones or coordinates', () => {
  const rollover = currentSkyInput('2026-12-31T23:30:00.000Z', city);
  assert.equal(rollover.localDate, '2027-01-01');
  assert.equal(rollover.localTime, '00:30:00');
  assert.equal(currentSkyInput('2026-12-31T23:30:00.000Z', {...city, timeZone:'Mars/Olympus'}), null);
  assert.equal(currentSkyInput('not-a-date', city), null);
  assert.equal(currentSkyInput('2026-12-31T23:30:00.000Z', {...city, latMicro:100_000_000}), null);
});

test('current sky rejects unknown zones and preserves subsecond UTC offsets', () => {
  assert.equal(currentSkyInput('2026-07-15T12:00:00.000Z', {...city, timeZone:null}), null);
  const subsecond = currentSkyInput('2026-07-15T12:00:00.999Z', city);
  assert.equal(subsecond.offsetSeconds, 7200);
  assert.equal(subsecond.utcIso, '2026-07-15T12:00:00.999Z');
});

test('current sky resolves DST fold as two distinct UTC instants', () => {
  const first = currentSkyInput('2026-10-25T00:30:00.000Z', city);
  const second = currentSkyInput('2026-10-25T01:30:00.000Z', city);
  assert.equal(first.localTime, '02:30:00');
  assert.equal(second.localTime, '02:30:00');
  assert.equal(first.offsetSeconds, 7200);
  assert.equal(second.offsetSeconds, 3600);
  assert.notEqual(first.utcIso, second.utcIso);
});

test('current sky handles western time zones and native calendar bounds', () => {
  const ny = {...city, name: 'New York', timeZone: 'America/New_York'};
  const west = currentSkyInput('2026-01-01T02:30:00.000Z', ny);
  assert.equal(west.localDate, '2025-12-31');
  assert.equal(west.localTime, '21:30:00');
  assert.equal(west.offsetSeconds, -18000);
  assert.equal(currentSkyInput('1599-12-31T23:00:00.000Z', city), null);
  assert.equal(currentSkyInput('2401-01-01T00:00:00.000Z', city), null);
});
