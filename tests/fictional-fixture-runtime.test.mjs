import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { buildFictionalAngles } from '../src/app/fictional-geometry.ts';
import { buildSyntheticChartCsv, SYNTHETIC_DATA_STATUS } from '../src/app/synthetic-csv-export.ts';

// This test imports the REAL fixture TypeScript. Only the uninstalled external
// renderer constructor is stubbed, never the demo's coordinates or CSV encoder.
register(new URL('./helpers/fixture-renderer-loader.mjs', import.meta.url));
const { DEMO_NAMES, makeFictionalTheme, fictionalPlanets, fictionalHouses } =
  await import('../src/app/fictional-fixture.ts');

const PLANET_COUNT = 10;
const HOUSE_COUNT = 12;

test('the actual fixture inspector and actual chart builder agree for all 22 natal coordinates', () => {
  const inspectorPlanets = fictionalPlanets();
  const inspectorHouses = fictionalHouses();
  const chart = makeFictionalTheme(0);
  const geometry = buildFictionalAngles(0);

  assert.equal(inspectorPlanets.length, PLANET_COUNT);
  assert.equal(inspectorHouses.length, HOUSE_COUNT);
  assert.deepEqual(inspectorPlanets.map(x => x.name), [...DEMO_NAMES]);
  for (let i = 0; i < PLANET_COUNT; i++) {
    assert.equal(chart.planets[DEMO_NAMES[i]].longitude, inspectorPlanets[i].longitude);
    assert.equal(inspectorPlanets[i].longitude, geometry.planetLongitudes[i]);
  }
  assert.deepEqual(chart.houses.egizia.house, inspectorHouses.map(x => x.longitude));
  assert.deepEqual(inspectorHouses.map(x => x.longitude), [...geometry.houseCusps]);
  assert.equal(chart.as, geometry.ascendant);
  assert.equal(chart.ds, geometry.descendant);
  assert.equal(chart.mc, geometry.mediumCoeli);
  assert.equal(chart.ic, geometry.imumCoeli);

  const csv = buildSyntheticChartCsv(inspectorPlanets, inspectorHouses);
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines.length, 23);
  assert.ok(lines.slice(1).every(line => line.endsWith(',' + SYNTHETIC_DATA_STATUS)));
  for (let i = 0; i < PLANET_COUNT; i++) {
    assert.equal(lines[1+i], `planet,${DEMO_NAMES[i]},${chart.planets[DEMO_NAMES[i]].longitude.toFixed(1)},${SYNTHETIC_DATA_STATUS}`);
  }
  for (let i = 0; i < HOUSE_COUNT; i++) {
    assert.equal(lines[11+i], `house,${i+1},${chart.houses.egizia.house[i].toFixed(1)},${SYNTHETIC_DATA_STATUS}`);
  }
});

test('renderer receives an independent mutable house copy, not the frozen source', () => {
  const geometry = buildFictionalAngles(0);
  const chart = makeFictionalTheme(0);
  const original = geometry.houseCusps[0];
  assert.notStrictEqual(chart.houses.egizia.house, geometry.houseCusps);
  assert.ok(!Object.isFrozen(chart.houses.egizia.house));
  chart.houses.egizia.house[0] = 234;
  assert.equal(geometry.houseCusps[0], original);
  assert.equal(fictionalHouses()[0].longitude, original);
});

test('actual transit and synastry fixture shifts preserve stable unshifted natal values', () => {
  const originalPlanets = fictionalPlanets();
  const originalHouses = fictionalHouses();
  for (const shift of [23, 58]) {
    const chart = makeFictionalTheme(shift);
    const expected = buildFictionalAngles(shift);
    for (let i = 0; i < PLANET_COUNT; i++) {
      assert.equal(chart.planets[DEMO_NAMES[i]].longitude, expected.planetLongitudes[i]);
    }
    assert.deepEqual(chart.houses.egizia.house, [...expected.houseCusps]);
  }
  assert.deepEqual(fictionalPlanets(), originalPlanets);
  assert.deepEqual(fictionalHouses(), originalHouses);
});
