import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanChartName, formatUtcOffset, parseDegreesMicro, resolveNewChart, resolveNowChart, selectedPlaceTimeZone,
} from '../src/app/new-chart-form.ts';
import {resolveCivilTime} from '../src/app/native/civil-time.ts';

// Visibly fictional subject and place.
const FIELDS = Object.freeze({
  name: '  Soggetto di prova  ', date: '2001-02-03', time: '04:05:06', timeZone: 'Europe/Rome',
  latitude: '44.697805', longitude: '11,805778', placeName: 'Luogo di prova',
});

test('a complete form resolves to one UTC instant and micro-degree coordinates', () => {
  const result = resolveNewChart(FIELDS, resolveCivilTime);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.input, {
    name: 'Soggetto di prova', utcIso: '2001-02-03T03:05:06.000Z',
    localDate: '2001-02-03', localTime: '04:05:06', timeZone: 'Europe/Rome', offsetSeconds: 3600,
    latMicro: 44_697_805, lngMicro: 11_805_778, placeName: 'Luogo di prova',
  });
});

test('coordinates accept comma or point and reject everything ambiguous', () => {
  assert.equal(parseDegreesMicro('44.5', 90), 44_500_000);
  assert.equal(parseDegreesMicro(' -33,8688 ', 90), -33_868_800);
  assert.equal(parseDegreesMicro('+180', 180), 180_000_000);
  assert.equal(parseDegreesMicro('0', 90), 0);
  for (const bad of ['', '90.1', '-91', "44°30'", '44 30', '4e1', '1.2.3', 'N44', '44.123456789', 'NaN']) {
    assert.equal(parseDegreesMicro(bad, 90), null, bad);
  }
  assert.equal(parseDegreesMicro('180.000001', 180), null);
  assert.deepEqual(resolveNewChart({...FIELDS, latitude: 'x'}, resolveCivilTime),
    {status: 'problem', problem: 'latitude_invalid'});
  assert.deepEqual(resolveNewChart({...FIELDS, longitude: '181'}, resolveCivilTime),
    {status: 'problem', problem: 'longitude_invalid'});
});

test('each invalid field is reported by name, never repaired', () => {
  const problem = fields => resolveNewChart({...FIELDS, ...fields}, resolveCivilTime).problem;
  assert.equal(problem({date: '2001-02-30'}), 'date_invalid');
  assert.equal(problem({date: ''}), 'date_invalid');
  assert.equal(problem({time: '25:00'}), 'time_invalid');
  assert.equal(problem({timeZone: '+01:00'}), 'zone_invalid');
  assert.equal(problem({timeZone: 'Mars/Olympus_Mons'}), 'zone_invalid');
});

test('a daylight-saving gap is refused and a fold needs an explicit choice', () => {
  // Europe/Rome: 02:30 did not exist on 2021-03-28 and occurred twice on 2021-10-31.
  assert.deepEqual(resolveNewChart({...FIELDS, date: '2021-03-28', time: '02:30'}, resolveCivilTime),
    {status: 'problem', problem: 'time_nonexistent'});
  const fold = {...FIELDS, date: '2021-10-31', time: '02:30'};
  const ambiguous = resolveNewChart(fold, resolveCivilTime);
  assert.equal(ambiguous.status, 'choice_required');
  assert.deepEqual(ambiguous.choices.map(choice => choice.offsetSeconds), [7200, 3600]);
  // A stale or foreign selection is not accepted in place of a real choice.
  assert.equal(resolveNewChart(fold, resolveCivilTime, '2021-10-31T05:00:00.000Z').status, 'choice_required');
  const later = resolveNewChart(fold, resolveCivilTime, ambiguous.choices[1].instantUtc);
  assert.equal(later.status, 'ready');
  assert.equal(later.input.utcIso, '2021-10-31T01:30:00.000Z');
  assert.equal(later.input.offsetSeconds, 3600);
});

test('a resolver failure becomes a zone problem instead of an exception', () => {
  const broken = () => { throw new Error('ICU missing'); };
  assert.deepEqual(resolveNewChart(FIELDS, broken), {status: 'problem', problem: 'zone_unavailable'});
});

test('names are trimmed, bounded and stripped of control characters', () => {
  assert.equal(cleanChartName('  Ada\u0000 \u0007Prova\n '), 'Ada Prova');
  assert.equal(cleanChartName('x'.repeat(200)).length, 80);
  assert.equal(cleanChartName(undefined), '');
});

test('UTC offsets are labelled with sign, hours, minutes and historical seconds', () => {
  assert.equal(formatUtcOffset(3600), '+01:00');
  assert.equal(formatUtcOffset(-12600), '-03:30');
  assert.equal(formatUtcOffset(0), '+00:00');
  assert.equal(formatUtcOffset(2996), '+00:49:56');
});


test('current-moment chart uses the injected UTC instant and the exact selected place', () => {
  const result = resolveNowChart({
    name: '  Cielo presente  ', timeZone: ' Europe/Rome ',
    latitude: '44.697805', longitude: '11,805778', placeName: ' Bologna ',
  }, new Date('2026-11-16T11:28:42.123Z'));
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.input, {
    name: 'Cielo presente',
    utcIso: '2026-11-16T11:28:42.123Z',
    localDate: '2026-11-16',
    localTime: '12:28:42',
    timeZone: 'Europe/Rome',
    offsetSeconds: 3600,
    latMicro: 44_697_805,
    lngMicro: 11_805_778,
    placeName: 'Bologna',
  });
});

test('current-moment chart refuses missing or unsupported time zones', () => {
  const fields = {name: '', timeZone: '', latitude: '0', longitude: '0', placeName: ''};
  assert.deepEqual(resolveNowChart(fields, new Date('2026-01-01T00:00:00Z')),
    {status: 'problem', problem: 'zone_invalid'});
  assert.deepEqual(resolveNowChart({...fields, timeZone: 'Mars/Olympus_Mons'}, new Date('2026-01-01T00:00:00Z')),
    {status: 'problem', problem: 'zone_invalid'});
  assert.deepEqual(resolveNowChart({...fields, timeZone: 'UTC'}, new Date('2026-01-01T00:00:00Z')),
    {status: 'ready', input: {
      name: '', utcIso: '2026-01-01T00:00:00.000Z', localDate: '2026-01-01', localTime: '00:00:00',
      timeZone: 'UTC', offsetSeconds: 0, latMicro: 0, lngMicro: 0, placeName: '',
    }});
});

test('current-moment chart never emits an invalid or fabricated instant', () => {
  const fields = {name: '', timeZone: 'Europe/Rome', latitude: '0', longitude: '0', placeName: ''};
  assert.deepEqual(resolveNowChart(fields, new Date(Number.NaN)),
    {status: 'problem', problem: 'instant_unavailable'});
  assert.deepEqual(resolveNowChart({...fields, latitude: '91'}, new Date('2026-01-01T00:00:00Z')),
    {status: 'problem', problem: 'latitude_invalid'});
  assert.deepEqual(resolveNowChart({...fields, longitude: '181'}, new Date('2026-01-01T00:00:00Z')),
    {status: 'problem', problem: 'longitude_invalid'});
});

test('selected offline place never inherits an earlier or host timezone', () => {
  assert.equal(selectedPlaceTimeZone(' Europe/Rome '), 'Europe/Rome');
  assert.equal(selectedPlaceTimeZone(null), '');
  assert.equal(selectedPlaceTimeZone(undefined), '');
  assert.equal(selectedPlaceTimeZone(''), '');
  const fields = {name: '', timeZone: selectedPlaceTimeZone(null), latitude: '44', longitude: '11', placeName: 'Catalog entry'};
  assert.deepEqual(resolveNowChart(fields, new Date('2026-11-16T12:00:00Z')),
    {status: 'problem', problem: 'zone_invalid'});
});


test('current-moment metadata follows daylight-saving changes while preserving UTC', () => {
  const fields = {name: '', timeZone: 'Europe/Rome', latitude: '0', longitude: '0', placeName: ''};
  const winter = resolveNowChart(fields, new Date('2026-01-15T12:34:56.789Z'));
  assert.equal(winter.status, 'ready');
  assert.equal(winter.input.utcIso, '2026-01-15T12:34:56.789Z');
  assert.equal(winter.input.localDate, '2026-01-15');
  assert.equal(winter.input.localTime, '13:34:56');
  assert.equal(winter.input.offsetSeconds, 3600);

  const summer = resolveNowChart(fields, new Date('2026-07-15T12:34:56.789Z'));
  assert.equal(summer.status, 'ready');
  assert.equal(summer.input.utcIso, '2026-07-15T12:34:56.789Z');
  assert.equal(summer.input.localDate, '2026-07-15');
  assert.equal(summer.input.localTime, '14:34:56');
  assert.equal(summer.input.offsetSeconds, 7200);
});

test('UTC is explicit and stable; extended ISO instants are rejected before IPC', () => {
  const fields = {name: '', timeZone: 'UTC', latitude: '0', longitude: '0', placeName: ''};
  const utc = resolveNowChart(fields, new Date('2026-11-16T08:09:10.123Z'));
  assert.equal(utc.status, 'ready');
  assert.equal(utc.input.localDate, '2026-11-16');
  assert.equal(utc.input.localTime, '08:09:10');
  assert.equal(utc.input.offsetSeconds, 0);

  assert.deepEqual(resolveNowChart(fields, new Date(8_640_000_000_000_000)),
    {status: 'problem', problem: 'instant_unavailable'});
});

test('current sky uses the exact UTC instant across the spring DST jump', () => {
  const fields = {name: '', timeZone: 'Europe/Rome', latitude: '0', longitude: '0', placeName: ''};
  const before = resolveNowChart(fields, new Date('2026-03-29T00:59:59.000Z'));
  const after = resolveNowChart(fields, new Date('2026-03-29T01:00:00.000Z'));
  assert.equal(before.status, 'ready');
  assert.equal(after.status, 'ready');
  assert.equal(before.input.localTime, '01:59:59');
  assert.equal(before.input.offsetSeconds, 3600);
  assert.equal(after.input.localTime, '03:00:00');
  assert.equal(after.input.offsetSeconds, 7200);
  assert.equal(after.input.utcIso, '2026-03-29T01:00:00.000Z');
});

test('current sky distinguishes repeated local clock times at the autumn DST fold', () => {
  const fields = {name: '', timeZone: 'Europe/Rome', latitude: '0', longitude: '0', placeName: ''};
  const earlier = resolveNowChart(fields, new Date('2026-10-25T00:30:00.000Z'));
  const later = resolveNowChart(fields, new Date('2026-10-25T01:30:00.000Z'));
  assert.equal(earlier.status, 'ready');
  assert.equal(later.status, 'ready');
  assert.equal(earlier.input.localTime, '02:30:00');
  assert.equal(later.input.localTime, '02:30:00');
  assert.equal(earlier.input.offsetSeconds, 7200);
  assert.equal(later.input.offsetSeconds, 3600);
  assert.notEqual(earlier.input.utcIso, later.input.utcIso);
});
