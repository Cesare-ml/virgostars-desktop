import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_STEP, STEP_ROWS, defaultElectiveName, fieldTexts, isoFromMs, localParts, shiftInstant, stepInstant, utcFromLocal,
} from '../src/app/sky-navigator.ts';

const ROME = 'Europe/Rome';
const utc = iso => Date.parse(iso);
const wall = (ms, zone = ROME) => { const p = localParts(ms, zone); return [p.year, p.month, p.day, p.hour, p.minute, p.second].join(','); };

test('the steps offered are minutes, hours and days, with 4 minutes selected first', () => {
  assert.deepEqual(STEP_ROWS.map(row => row.unit), ['min', 'h', 'd']);
  assert.deepEqual(STEP_ROWS[0].values, [1, 3, 4, 6, 10, 20]);
  assert.deepEqual(STEP_ROWS[1].values, [1, 4, 6, 7, 12]);
  assert.deepEqual(STEP_ROWS[2].values, [1, 7, 15, 30]);
  assert.deepEqual(DEFAULT_STEP, {unit: 'min', value: 4});
  assert.ok(Object.isFrozen(STEP_ROWS) && STEP_ROWS.every(row => Object.isFrozen(row.values)));
});

test('the local reading of an instant follows the time zone, midnight included', () => {
  assert.equal(wall(utc('2026-11-17T15:11:44Z')), '2026,11,17,16,11,44');
  assert.equal(wall(utc('2026-07-17T15:11:44Z')), '2026,7,17,17,11,44');
  assert.equal(wall(utc('2026-11-16T23:00:00Z')), '2026,11,17,0,0,0');
  assert.equal(localParts(0, 'Not/AZone'), null);
  assert.equal(localParts(Number.NaN, ROME), null);
});

test('minutes and hours move the instant by elapsed time and carry over', () => {
  const start = utc('2026-11-17T15:59:30Z');
  assert.equal(wall(shiftInstant(start, ROME, 'minute', 1)), '2026,11,17,17,0,30');
  assert.equal(wall(shiftInstant(start, ROME, 'minute', -60)), '2026,11,17,15,59,30');
  assert.equal(shiftInstant(start, ROME, 'hour', 1) - start, 3_600_000);
  assert.equal(shiftInstant(start, ROME, 'hour', -24) - start, -86_400_000);
});

test('days, months and years keep the local clock time, also across a daylight-saving change', () => {
  const noon = utc('2026-03-28T11:00:00Z'); // 12:00 in Rome (UTC+1)
  const next = shiftInstant(noon, ROME, 'day', 1);
  assert.equal(wall(next), '2026,3,29,12,0,0');
  assert.equal(next - noon, 23 * 3_600_000, 'that day is 23 hours long');
  assert.equal(wall(shiftInstant(utc('2026-01-31T11:00:00Z'), ROME, 'month', 1)), '2026,2,28,12,0,0');
  assert.equal(wall(shiftInstant(utc('2028-02-29T11:00:00Z'), ROME, 'year', 1)), '2029,2,28,12,0,0');
  assert.equal(wall(shiftInstant(utc('2026-12-15T11:00:00Z'), ROME, 'month', 1)), '2027,1,15,12,0,0');
  assert.equal(wall(shiftInstant(utc('2026-01-15T11:00:00Z'), ROME, 'month', -1)), '2025,12,15,12,0,0');
});

test('a local time that does not exist takes the reading after the clock change, an ambiguous one the earlier instant', () => {
  const missing = utcFromLocal({year: 2026, month: 3, day: 29, hour: 2, minute: 30, second: 0}, ROME);
  assert.equal(wall(missing), '2026,3,29,3,30,0');
  const twice = utcFromLocal({year: 2026, month: 10, day: 25, hour: 2, minute: 30, second: 0}, ROME);
  assert.equal(new Date(twice).toISOString(), '2026-10-25T00:30:00.000Z', 'the first 02:30, still summer time');
  // Stepping a day onto the missing hour never leaves the day.
  const before = utc('2026-03-28T01:30:00Z'); // 02:30 in Rome the day before the change
  assert.equal(wall(shiftInstant(before, ROME, 'day', 1)), '2026,3,29,3,30,0');
});

test('a step goes forwards or backwards by the chosen amount and unit', () => {
  const start = utc('2026-11-17T15:11:44Z');
  assert.equal(stepInstant(start, ROME, 'min', 4, 1) - start, 4 * 60_000);
  assert.equal(stepInstant(start, ROME, 'min', 20, -1) - start, -20 * 60_000);
  assert.equal(stepInstant(start, ROME, 'h', 12, 1) - start, 12 * 3_600_000);
  assert.equal(wall(stepInstant(start, ROME, 'd', 30, 1)), '2026,12,17,16,11,44');
  assert.equal(wall(stepInstant(start, ROME, 'd', 7, -1)), '2026,11,10,16,11,44');
  assert.equal(stepInstant(start, ROME, 'min', 0, 1), null);
  assert.equal(stepInstant(start, ROME, 'min', 1.5, 1), null);
});

test('moving outside the years 1900 to 2100 is refused, never wrapped', () => {
  assert.equal(shiftInstant(utc('2100-12-31T10:00:00Z'), ROME, 'day', 1), null);
  assert.equal(shiftInstant(utc('2100-06-15T10:00:00Z'), ROME, 'year', 1), null);
  assert.equal(shiftInstant(utc('1900-01-01T12:00:00Z'), 'UTC', 'day', -1), null);
  assert.equal(shiftInstant(utc('1900-01-01T12:00:00Z'), 'UTC', 'year', -1), null);
  assert.equal(shiftInstant(utc('2100-12-31T23:30:00Z'), 'UTC', 'minute', 60), null);
  assert.notEqual(shiftInstant(utc('2100-12-30T10:00:00Z'), ROME, 'day', 1), null);
  assert.notEqual(shiftInstant(utc('1900-01-02T12:00:00Z'), 'UTC', 'day', -1), null);
  assert.equal(shiftInstant(utc('2026-01-01T00:00:00Z'), 'Not/AZone', 'day', 1), null);
  assert.equal(shiftInstant(utc('2026-01-01T00:00:00Z'), ROME, 'day', 1.5), null);
});

test('the clock of the panel shows two digits for each field and four for the year', () => {
  assert.deepEqual(fieldTexts(utc('2026-03-05T08:07:00Z'), ROME), {day: '05', month: '03', year: '2026', hour: '09', minute: '07'});
  assert.equal(fieldTexts(0, 'Not/AZone'), null);
});

test('the elective name carries the local date and time of the chart', () => {
  assert.equal(defaultElectiveName('Elettiva', utc('2026-11-17T15:11:44Z'), ROME), 'Elettiva 2026-11-17 16:11:44');
  assert.equal(defaultElectiveName('Elective', utc('2026-07-01T00:00:00Z'), 'UTC'), 'Elective 2026-07-01 00:00:00');
  assert.equal(isoFromMs(utc('2026-11-17T15:11:44Z')), '2026-11-17T15:11:44.000Z');
});

test('century years follow the Gregorian rule: 1900 and 2100 are not leap years, 2000 is', () => {
  assert.equal(wall(utc('1900-06-15T12:00:00Z'), 'UTC'), '1900,6,15,12,0,0');
  assert.equal(wall(shiftInstant(utc('1900-02-28T12:00:00Z'), 'UTC', 'day', 1), 'UTC'), '1900,3,1,12,0,0');
  assert.equal(wall(shiftInstant(utc('2000-02-28T12:00:00Z'), 'UTC', 'day', 1), 'UTC'), '2000,2,29,12,0,0');
  assert.equal(wall(shiftInstant(utc('2100-02-28T12:00:00Z'), 'UTC', 'day', 1), 'UTC'), '2100,3,1,12,0,0');
  assert.equal(wall(shiftInstant(utc('2000-02-29T12:00:00Z'), 'UTC', 'year', 1), 'UTC'), '2001,2,28,12,0,0');
  assert.equal(wall(shiftInstant(utc('2000-01-31T12:00:00Z'), 'UTC', 'month', 1), 'UTC'), '2000,2,29,12,0,0');
  assert.equal(wall(stepInstant(utc('1900-01-01T00:00:00Z'), 'UTC', 'd', 30, 1), 'UTC'), '1900,1,31,0,0,0');
  assert.equal(fieldTexts(utc('1900-03-01T00:00:00Z'), 'UTC').year, '1900');
  assert.notEqual(shiftInstant(utc('2100-01-31T12:00:00Z'), 'UTC', 'month', -1), null);
});
