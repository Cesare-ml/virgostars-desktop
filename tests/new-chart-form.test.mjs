import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanChartName, formatUtcOffset, parseDegreesMicro, resolveCurrentSky, resolveNewChart,
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


const CURRENT_FIELDS = Object.freeze({
  name: '  Cielo attuale  ', timeZone: 'Europe/Rome',
  latitude: '44.697805', longitude: '11,805778', placeName: 'Luogo di prova',
});

test('current sky captures one UTC instant and derives winter civil metadata', () => {
  let reads = 0;
  const result = resolveCurrentSky(CURRENT_FIELDS, () => {
    reads++;
    return new Date('2026-01-15T12:34:56.789Z');
  });
  assert.equal(reads, 1);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.input, {
    name: 'Cielo attuale', utcIso: '2026-01-15T12:34:56.789Z',
    localDate: '2026-01-15', localTime: '13:34:56', timeZone: 'Europe/Rome',
    offsetSeconds: 3600, latMicro: 44_697_805, lngMicro: 11_805_778,
    placeName: 'Luogo di prova',
  });
});

test('current sky derives daylight-saving metadata without changing the UTC instant', () => {
  const result = resolveCurrentSky(CURRENT_FIELDS, () => new Date('2026-07-15T12:34:56.789Z'));
  assert.equal(result.status, 'ready');
  assert.equal(result.input.utcIso, '2026-07-15T12:34:56.789Z');
  assert.equal(result.input.localDate, '2026-07-15');
  assert.equal(result.input.localTime, '14:34:56');
  assert.equal(result.input.offsetSeconds, 7200);
});

test('current sky uses UTC when the optional display timezone is blank', () => {
  const result = resolveCurrentSky({...CURRENT_FIELDS, timeZone: '  '},
    () => new Date('2026-11-16T08:09:10.123Z'));
  assert.equal(result.status, 'ready');
  assert.equal(result.input.timeZone, 'UTC');
  assert.equal(result.input.localDate, '2026-11-16');
  assert.equal(result.input.localTime, '08:09:10');
  assert.equal(result.input.offsetSeconds, 0);
});

test('current sky rejects invalid coordinates, zones and clock readings safely', () => {
  let reads = 0;
  assert.deepEqual(resolveCurrentSky({...CURRENT_FIELDS, latitude: '91'}, () => {
    reads++;
    return new Date();
  }), {status: 'problem', problem: 'latitude_invalid'});
  assert.equal(reads, 0);
  assert.deepEqual(resolveCurrentSky({...CURRENT_FIELDS, timeZone: 'Mars/Olympus_Mons'},
    () => new Date('2026-01-01T00:00:00Z')),
  {status: 'problem', problem: 'zone_invalid'});
  assert.deepEqual(resolveCurrentSky(CURRENT_FIELDS, () => new Date(Number.NaN)),
    {status: 'problem', problem: 'zone_unavailable'});
  assert.deepEqual(resolveCurrentSky(CURRENT_FIELDS, () => { throw new Error('clock unavailable'); }),
    {status: 'problem', problem: 'zone_unavailable'});
});
