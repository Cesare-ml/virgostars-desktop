import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {formatLatitudeDms, formatLongitudeDms, formatSpeed, houseDisplay, planetRows, buildTemaRenderData}
  from '../src/app/astro/tema-render-data.ts';

test('longitude is shown as degrees, sign, minutes and seconds within the sign', () => {
  // 28 deg 27' 36" in Libra: sign 6 (Libra) starts at 180.
  assert.equal(formatLongitudeDms(180 + 28 + 27 / 60 + 36 / 3600), "28° Bil 27' 36\"");
  assert.equal(formatLongitudeDms(0), "00° Ari 00' 00\"");
  assert.equal(formatLongitudeDms(359.99999999), "29° Pes 59' 59\"");
  assert.equal(formatLongitudeDms(-0.5), "29° Pes 30' 00\"");
  assert.equal(formatLongitudeDms(30 + 4 + 44 / 60, 'en'), "04° Tau 44' 00\"");
  assert.equal(formatLongitudeDms(Number.NaN), '—');
});

test('latitude keeps its sign, and a negative value that rounds to zero is not shown as negative', () => {
  assert.equal(formatLatitudeDms(-5 - 9 / 60 - 35 / 3600), "-05° 09' 35\"");
  assert.equal(formatLatitudeDms(1 + 55 / 60 + 32 / 3600), "01° 55' 32\"");
  assert.equal(formatLatitudeDms(0.0000001), "00° 00' 00\"");
  assert.equal(formatLatitudeDms(-0.0000001), "00° 00' 00\"");
  assert.equal(formatLatitudeDms(Number.POSITIVE_INFINITY), '—');
});

test('speed uses at most two decimals and the locale separator, never negative zero', () => {
  assert.equal(formatSpeed(0.9856), '0,99');
  assert.equal(formatSpeed(13), '13');
  assert.equal(formatSpeed(-0.03), '-0,03');
  assert.equal(formatSpeed(-0.001), '0');
  assert.equal(formatSpeed(1.67, 'en'), '1.67');
});

test('angular houses are Roman, the others Arabic, and the colour follows the element', () => {
  assert.deepEqual(houseDisplay(10), {text: 'X', element: 'earth'});
  assert.deepEqual(houseDisplay(4), {text: 'IV', element: 'water'});
  assert.deepEqual(houseDisplay(1), {text: 'I', element: 'fire'});
  assert.deepEqual(houseDisplay(7), {text: 'VII', element: 'air'});
  assert.deepEqual(houseDisplay(5), {text: '5', element: 'fire'});
  assert.deepEqual(houseDisplay(12), {text: '12', element: 'water'});
  assert.equal(houseDisplay(0), null);
  assert.equal(houseDisplay(13), null);
  assert.equal(houseDisplay(2.5), null);
});

test('planet rows carry the speed and latitude the provider gave, nothing else', () => {
  const body = (id, longitudeDeg, latitudeDeg, longitudeSpeed) => ({id, longitudeDeg, latitudeDeg, distanceAu: 1,
    longitudeSpeed, latitudeSpeed: 0, distanceSpeed: 0, rightAscensionDeg: 0, declinationDeg: 0, ephemerisSource: 'jpl'});
  const cusps = Array.from({length: 12}, (_, i) => i * 30);
  const data = buildTemaRenderData({julianDayUt: 2451545, unavailableBodies: [], unavailableHouseSystems: [],
    bodies: [body('Sun', 45, 0.0003, 0.99), body('Neptune', 340, -0.1, -0.01)],
    houses: [{id: 'egizia', cuspsDeg: cusps, ascendantDeg: 0, mcDeg: 270, armcDeg: 0, vertexDeg: 0}]}, '2000-01-01T12:00:00Z');
  const rows = planetRows(data, 'egizia');
  assert.deepEqual(rows.map(row => [row.name, row.latitude, row.speed, row.retrograde, row.house]),
    [['Sun', 0.0003, 0.99, false, 2], ['Neptune', -0.1, -0.01, true, 12]]);
});

test('the planet tab is one table and the house cusps list is gone', () => {
  const html = readFileSync(new URL('../src/app/desktop-app.component.html', import.meta.url), 'utf8');
  assert.match(html, /class="planet-table"/);
  for (const key of ['column.lng', 'column.house', 'column.speed', 'column.lat']) assert.ok(html.includes(key), key);
  assert.doesNotMatch(html, /id="tab-houses"|cuspRows|tab\.houses/);
  const component = readFileSync(new URL('../src/app/desktop-app.component.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(component, /cuspRows/);
});
