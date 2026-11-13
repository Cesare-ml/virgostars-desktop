import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFictionalAngles } from '../src/app/fictional-geometry.ts';
import { buildSyntheticChartCsv, SYNTHETIC_DATA_STATUS } from '../src/app/synthetic-csv-export.ts';
import { formatEclipticLongitude } from '../src/app/format-longitude.ts';

const PLANET_NAMES = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars',
  'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];

function baseFixtureRows() {
  const angles = buildFictionalAngles(0);
  const planets = PLANET_NAMES.map((name, i) => ({name, longitude: angles.planetLongitudes[i]}));
  const houses = angles.houseCusps.map((longitude, i) => ({number: i + 1, longitude}));
  return { angles, planets, houses, csv: buildSyntheticChartCsv(planets, houses) };
}

test('all 22 fictional inspector longitudes match the exported CSV display precision', () => {
  const { planets, houses, csv } = baseFixtureRows();
  const rows = csv.trimEnd().split('\r\n').slice(1).map(row => row.split(','));
  assert.equal(rows.length, 22);
  const source = [
    ...planets.map(({name, longitude}) => ({kind: 'planet', name, longitude})),
    ...houses.map(({number, longitude}) => ({kind: 'house', name: String(number), longitude})),
  ];
  source.forEach((entry, i) => {
    assert.deepEqual(rows[i], [entry.kind, entry.name,
      formatEclipticLongitude(entry.longitude).replace('°', ''), SYNTHETIC_DATA_STATUS]);
  });
});

test('invalid inspector longitudes are unavailable, not silently normalized into CSV', () => {
  for (const invalid of [NaN, Infinity, -Infinity, -1, 360, 720, '42.0', null]) {
    assert.equal(formatEclipticLongitude(invalid), '—');
  }
  assert.equal(formatEclipticLongitude(359.96), '0.0°');
  const {planets, houses} = baseFixtureRows();
  assert.throws(() => buildSyntheticChartCsv([{...planets[0], longitude: 359.96}, ...planets.slice(1)], houses),
    /Invalid fictional CSV fixture/);
});

test('shifted fictional overlays remain finite, circular and displayable', () => {
  for (const shift of [0, 23, 58, 359.96, -Number.EPSILON, Number.MAX_VALUE]) {
    const angles = buildFictionalAngles(shift);
    for (const longitude of [...angles.planetLongitudes, ...angles.houseCusps]) {
      const formatted = formatEclipticLongitude(longitude);
      assert.match(formatted, /^\d{1,3}\.\d°$/);
      assert.notEqual(formatted, '360.0°');
    }
  }
});

test('actual desktop source uses the same formatter for planet and house inspector rows', () => {
  const component = readFileSync(new URL('../src/app/desktop-app.component.ts', import.meta.url), 'utf8');
  const template = readFileSync(new URL('../src/app/desktop-app.component.html', import.meta.url), 'utf8');
  assert.match(component, /import \{ formatEclipticLongitude \} from '\.\/format-longitude';/);
  assert.match(component, /formatDegrees\(value:number\): string \{ return formatEclipticLongitude\(value\); \}/);
  assert.match(component, /buildSyntheticChartCsv\(this\.planets, this\.houses\)/);
  assert.match(template, /formatDegrees\(planet\.longitude\)/);
  assert.match(template, /formatDegrees\(house\.longitude\)/);
});
