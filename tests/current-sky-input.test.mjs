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
