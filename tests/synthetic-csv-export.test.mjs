import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSyntheticChartCsv, SYNTHETIC_CSV_FILENAME, SYNTHETIC_DATA_STATUS } from '../src/app/synthetic-csv-export.ts';

const values = [19.3, 83.1, 44.8, 129.4, 167.1, 208.6, 278.1, 305.6, 347.7, 6.5];
const names = ['Sun','Moon','Mercury','Venus','Mars','Jupiter','Saturn','Uranus','Neptune','Pluto'];
const fixture = () => ({
  planets: names.map((name, i) => ({ name, longitude: values[i] })),
  houses: Array.from({ length: 12 }, (_, i) => ({ number: i + 1, longitude: (103 + i * 30) % 360 })),
});
const exportFixture = ({ planets, houses } = fixture()) => buildSyntheticChartCsv(planets, houses);

test('exports 22 fictional planet/house rows with stable schema and explicit data-quality flags', () => {
  const csv = exportFixture();
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 24); // header + 22 entries + trailing empty line
  assert.equal(lines[0], 'record_type,object_name,longitude_degrees,data_quality');
  assert.equal(lines[1], 'planet,Sun,19.3,' + SYNTHETIC_DATA_STATUS);
  assert.equal(lines[10], 'planet,Pluto,6.5,' + SYNTHETIC_DATA_STATUS);
  assert.equal(lines[11], 'house,1,103.0,' + SYNTHETIC_DATA_STATUS);
  assert.equal(lines[22], 'house,12,73.0,' + SYNTHETIC_DATA_STATUS);
  assert.equal(lines[23], '');
  assert.equal(SYNTHETIC_CSV_FILENAME, 'virgostars-FICTIONAL-NOT-CALCULATED.csv');
  assert.doesNotMatch(csv, /2001-|dataora|birth|timezone|profile_id|token/i);
});

test('produces deterministic ordering and leaves both caller arrays unchanged', () => {
  const inputs = fixture();
  const original = JSON.stringify(inputs);
  const sorted = exportFixture(inputs);
  assert.equal(exportFixture({planets: inputs.planets.toReversed(),houses: inputs.houses.toReversed()}), sorted);
  assert.equal(JSON.stringify(inputs), original);
  assert.ok(!sorted.includes('NaN'));
});

for (const mutation of [
  f => f.planets.pop(),
  f => f.planets.push({name:'Other',longitude:12}),
  f => {f.planets[1] = {...f.planets[0]};},
  f => {f.planets[0].name='=HYPERLINK("https://bad.invalid")';},
  f => {f.planets[0].name='+SUM(1,1)';},
  f => {f.planets[0].name='@SUM(1,1)';},
  f => {f.planets[0].name='\t=SUM(1,1)';},
  f => {f.planets[0].name='sun';},
  f => {f.planets[0].longitude=Infinity;},
  f => {f.planets[0].longitude=NaN;},
  f => {f.planets[0].longitude=-0;},
  f => {f.planets[0].longitude=-1;},
  f => {f.planets[0].longitude=360;},
  f => {f.planets[0].longitude=12.34;},
  f => f.houses.pop(),
  f => f.houses.push({number:13,longitude:10}),
  f => {f.houses[1] = {...f.houses[0]};},
  f => {f.houses[0].number=0;},
  f => {f.houses[0].number=1.5;},
  f => {f.houses[0].longitude=359.99;},
]) {
  test('rejects malformed synthetic rows without leaking values', () => {
    const f = fixture();
    mutation(f);
    assert.throws(() => exportFixture(f), err => {
      assert.equal(err.message, 'Invalid fictional CSV fixture');
      assert.doesNotMatch(err.message, /HYPERLINK|bad\.invalid|SUM|Sun/);
      return true;
    });
  });
}

test('rejects untrusted object kinds and arrays rather than exporting partial tables', () => {
  const valid = fixture();
  assert.throws(() => buildSyntheticChartCsv(null, valid.houses), /Invalid fictional CSV fixture/);
  assert.throws(() => buildSyntheticChartCsv(valid.planets, {}), /Invalid fictional CSV fixture/);
  const malformed = fixture();
  malformed.planets[0] = null;
  assert.throws(() => exportFixture(malformed), /Invalid fictional CSV fixture/);
});
