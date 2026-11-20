import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanChartName, cleanPlaceName, formatUtcOffset, parseDegreesMicro, resolveNewChart, savedChartFields,
} from '../src/app/new-chart-form.ts';
import {resolveCivilTime} from '../src/app/native/civil-time.ts';

// Visibly fictional subject and place.
const FIELDS = Object.freeze({
  name: '  Soggetto di prova  ', date: '2001-02-03', time: '04:05:06', timeZone: 'Europe/Rome',
  latitude: '44.697805', longitude: '11,805778', placeName: 'Luogo di prova',
});

test('extended-year civil inputs and stored instants keep the local date', () => {
  for (const year of ['0800','2200']) {
    const fields={...FIELDS,date:`${year}-03-20`,time:'12:00:00',timeZone:'Europe/Rome'};
    const result=resolveNewChart(fields, value=>resolveCivilTime(value,{yearRange:'archive'}));
    assert.equal(result.status,'ready');
    const restored=savedChartFields({...result.input,id:'11111111-1111-4111-8111-111111111111',createdAtMs:1,updatedAtMs:1});
    assert.equal(restored.date,fields.date);
    assert.equal(restored.time,fields.time);
    assert.equal(restored.timeZone,fields.timeZone);
  }
});

test('a saved chart prefills its original local birth date, time and coordinates', () => {
  const chart = {
    id:'11111111-1111-4111-8111-111111111111', name:'Persona immaginaria',
    utcIso:'2001-02-03T03:05:06.000Z', timeZone:'Europe/Rome',
    latMicro:44_697_805, lngMicro:11_805_778, placeName:'Luogo di prova',
    createdAtMs:1000, updatedAtMs:2000,
  };
  assert.deepEqual(savedChartFields(chart), {
    name:'Persona immaginaria', date:'2001-02-03', time:'04:05:06',
    timeZone:'Europe/Rome', latitude:'44.697805', longitude:'11.805778', placeName:'Luogo di prova',
  });
  const ambiguous = savedChartFields({...chart, utcIso:'2025-10-26T01:30:00.000Z'});
  assert.equal(ambiguous.time, '02:30:00', 'fall-back ambiguity preserves local time');
  const resolved = resolveNewChart(ambiguous, resolveCivilTime, '2025-10-26T01:30:00.000Z');
  assert.equal(resolved.status, 'ready');
  assert.equal(resolved.input.utcIso, '2025-10-26T01:30:00.000Z');
  assert.equal(savedChartFields({...chart, timeZone:'Invalid/Zone'}).timeZone, 'Invalid/Zone',
    'an unsupported saved zone is still editable');
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

test('manual place labels preserve the full native archive allowance of 160 characters', () => {
  assert.equal(cleanPlaceName('x'.repeat(190)).length, 160);
  assert.equal(resolveNewChart({...FIELDS,placeName:'x'.repeat(130)}, resolveCivilTime).input.placeName.length, 130);
});

test('UTC offsets are labelled with sign, hours, minutes and historical seconds', () => {
  assert.equal(formatUtcOffset(3600), '+01:00');
  assert.equal(formatUtcOffset(-12600), '-03:30');
  assert.equal(formatUtcOffset(0), '+00:00');
  assert.equal(formatUtcOffset(2996), '+00:49:56');
});
