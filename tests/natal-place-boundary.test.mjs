import test from 'node:test';
import assert from 'node:assert/strict';
import {NatalDraftState} from '../src/app/natal-draft-state.ts';

// Deliberately fictional inputs. No real birth details or private catalog.
const place = Object.freeze({
  id: 42,
  name: 'Fictional City',
  italianName: null,
  latMicro: 43_769_560,
  lngMicro: 11_255_810,
  population: 100,
  stateId: 1,
  region: 'Fictional Region',
  timeZone: 'Europe/Rome',
  countryName: 'Fictional Country',
  countryCode: 'IT',
});

function readyDraft(birthTimeKnown = true) {
  const draft = new NatalDraftState();
  draft.update('name', 'Synthetic Subject');
  draft.update('year', '2024');
  draft.update('month', '10');
  draft.update('day', '27');
  draft.update('hour', '02');
  draft.update('minute', '30');
  draft.setBirthTimeKnown(birthTimeKnown);
  return draft;
}

test('well-formed local city metadata survives a natal preview as a detached snapshot', () => {
  const draft = readyDraft();
  const selected = {...place};
  draft.setPlace(selected);
  assert.equal(draft.showPreview(), true);
  assert.deepEqual(draft.issues, []);
  assert.equal(draft.preview.place.stateId, 1);
  assert.equal(draft.preview.place.region, 'Fictional Region');
  assert.equal(draft.preview.place.countryName, 'Fictional Country');
  assert.equal(draft.preview.place.timeZone, 'Europe/Rome');
  selected.region = 'Changed outside editor';
  assert.equal(draft.preview.place.region, 'Fictional Region');
});

test('malformed nullable metadata is rejected even for valid coordinates and name', () => {
  const malformed = [
    {stateId: -1},
    {stateId: 1.5},
    {stateId: '1'},
    {region: 13},
    {region: 'R'.repeat(256)},
    {timeZone: {name: 'Europe/Rome'}},
    {timeZone: 'Z'.repeat(256)},
    {countryName: 12},
    {countryName: 'C'.repeat(256)},
    {countryCode: 'ITA'},
    {countryCode: 'it'},
    {italianName: 17},
    {italianName: 'I'.repeat(256)},
    {population: -3},
    {population: Infinity},
    {population: '100'},
  ];
  for (const changed of malformed) {
    const draft = readyDraft();
    draft.setPlace({...place, ...changed});
    assert.equal(draft.showPreview(), false, JSON.stringify(changed));
    assert.deepEqual(draft.issues, ['place'], JSON.stringify(changed));
    assert.equal(draft.preview, null);
  }
});

test('missing nullable location metadata remains backward compatible', () => {
  const draft = readyDraft(false);
  draft.setPlace({...place, italianName: null, population: null, stateId: null,
    region: null, timeZone: null, countryName: null, countryCode: null});
  assert.equal(draft.showPreview(), true);
  assert.equal(draft.preview.utcResolution, 'unknown_birth_time');
  assert.equal(draft.preview.place.timeZone, null);
});

test('known birth time without zone reports time-zone issue instead of inventing UTC', () => {
  const draft = readyDraft(true);
  draft.setPlace({...place, timeZone: null});
  assert.equal(draft.showPreview(), false);
  assert.deepEqual(draft.issues, ['time_zone']);
});

test('missing optional keys are not silently accepted as null', () => {
  // The trusted offline decoder materializes null values for v1 countries.
  // Bypassing that decoder must not silently pass incomplete metadata.
  for (const key of ['italianName', 'population', 'stateId', 'region', 'timeZone', 'countryName']) {
    const incomplete = {...place};
    delete incomplete[key];
    const draft = readyDraft(false);
    draft.setPlace(incomplete);
    assert.equal(draft.showPreview(), false, key);
    assert.deepEqual(draft.issues, ['place'], key);
  }
});
