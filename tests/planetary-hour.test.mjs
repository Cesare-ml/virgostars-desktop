import test from 'node:test';
import assert from 'node:assert/strict';
import {rendererPlanetaryHours} from '../src/app/astro/planetary-hour.ts';
import {buildPlanetaryHours} from 'astrological-functions';

const jd = iso => Date.parse(iso) / 86400000 + 2440587.5;
test('planetary day uses the local weekday of sunrise, including across UTC midnight', () => {
  const day = {sunriseJdUt:jd('2024-01-07T23:00:00Z'), sunsetJdUt:jd('2024-01-08T11:00:00Z'), nextSunriseJdUt:jd('2024-01-08T23:00:00Z')};
  const result = rendererPlanetaryHours(day, '2024-01-08T00:00:00Z', 'Asia/Tokyo', buildPlanetaryHours);
  assert.equal(result.dh.diurne[0].pianeta, 'Moon');
  assert.equal(result.dh.notturne.length, 12);
  assert.equal(rendererPlanetaryHours(day, '2024-01-08T00:00:00Z', 'bad/zone', buildPlanetaryHours), null);
});
