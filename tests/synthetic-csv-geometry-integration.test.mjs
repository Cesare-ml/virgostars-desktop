import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFictionalAngles } from '../src/app/fictional-geometry.ts';
import { buildSyntheticChartCsv, SYNTHETIC_DATA_STATUS } from '../src/app/synthetic-csv-export.ts';

const NAMES = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars',
  'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];

function exportSharedNatalGeometry() {
  const geometry = buildFictionalAngles(0);
  const planets = NAMES.map((name, index) => ({
    name, longitude: geometry.planetLongitudes[index],
  }));
  const houses = geometry.houseCusps.map((longitude, index) => ({
    number: index + 1, longitude,
  }));
  return { geometry, csv: buildSyntheticChartCsv(planets, houses) };
}

test('natal CSV values exactly correspond to the geometry used by the fictional chart', () => {
  const { geometry, csv } = exportSharedNatalGeometry();
  const rows = csv.trimEnd().split('\r\n').map(row => row.split(','));
  assert.equal(rows.length, 23);
  assert.deepEqual(rows[0], ['record_type', 'object_name', 'longitude_degrees', 'data_quality']);

  for (let index = 0; index < 10; index++) {
    assert.deepEqual(rows[index + 1], [
      'planet', NAMES[index], geometry.planetLongitudes[index].toFixed(1), SYNTHETIC_DATA_STATUS,
    ]);
  }
  for (let index = 0; index < 12; index++) {
    assert.deepEqual(rows[index + 11], [
      'house', String(index + 1), geometry.houseCusps[index].toFixed(1), SYNTHETIC_DATA_STATUS,
    ]);
  }
});

test('repeated export is deterministic, without mutating shared frozen fixture data', () => {
  const before = buildFictionalAngles(0);
  const first = exportSharedNatalGeometry().csv;
  const second = exportSharedNatalGeometry().csv;
  assert.equal(first, second);
  assert.deepEqual(buildFictionalAngles(0), before);
  assert.ok(Object.isFrozen(before.houseCusps));
  assert.ok(Object.isFrozen(before.planetLongitudes));
});

test('shifted overlay geometry stays separate from exported natal base values', () => {
  const { geometry, csv } = exportSharedNatalGeometry();
  for (const shift of [23, 58]) {
    const overlay = buildFictionalAngles(shift);
    assert.notDeepEqual(overlay.planetLongitudes, geometry.planetLongitudes);
    assert.notDeepEqual(overlay.houseCusps, geometry.houseCusps);
  }
  assert.ok(csv.includes('planet,Sun,19.3,FICTIONAL_NOT_CALCULATED'));
  assert.ok(!csv.includes('planet,Sun,42.3,FICTIONAL_NOT_CALCULATED'));
});

test('the chart and inspector source share one fictional geometry; no alternative degree array', () => {
  const source = readFileSync(new URL('../src/app/fictional-fixture.ts', import.meta.url), 'utf8');
  const component = readFileSync(new URL('../src/app/desktop-app.component.ts', import.meta.url), 'utf8');
  assert.ok(source.includes("from './fictional-geometry'"));
  assert.ok(source.includes('buildFictionalAngles(shift)'));
  assert.ok(source.includes('const angles = buildFictionalAngles(0);'));
  assert.ok(source.includes('house:[...angles.houseCusps]'));
  assert.ok(!source.includes('const degrees ='));
  assert.ok(component.includes('buildSyntheticChartCsv(this.planets, this.houses)'));
  assert.ok(component.includes("this.mode !== 'natal'"));
});
