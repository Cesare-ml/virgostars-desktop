import test from 'node:test';
import assert from 'node:assert/strict';
import {addExtraHouses, EXTRA_HOUSE_SYSTEM_IDS} from '../src/app/astro/extra-houses.ts';

const theta = 61.66688244516181, epsilon = 23.437859777570328, r = Math.PI / 180;
const norm = x => ((x % 360) + 360) % 360;
const asc = norm(Math.atan2(-Math.cos(theta*r), Math.sin(epsilon*r)*Math.tan(40*r) + Math.cos(epsilon*r)*Math.sin(theta*r))/r + 180);
const mc = norm(Math.atan2(Math.sin(theta*r), Math.cos(theta*r)*Math.cos(epsilon*r))/r);
const snapshot = {julianDayUt:2451545, houseAngleContext:{ttJulianDay:2451545.0008, trueObliquityDeg:epsilon},
  bodies:[{id:'Sun', declinationDeg:0}], houses:[{ascendantDeg:asc, mcDeg:mc, armcDeg:theta, vertexDeg:220}]};

test('native angle evidence feeds all 18 additional twelve-cusp methods', async () => {
  const data = {houses:{}};
  const sectors = await addExtraHouses(data, snapshot, {id:'virgostars_ephemeris', engineVersion:'test'}, '2000-01-01T12:00:00Z', 40000000, 12496400);
  assert.deepEqual(Object.keys(data.houses).sort(), [...EXTRA_HOUSE_SYSTEM_IDS].sort());
  for (const house of Object.values(data.houses)) assert.equal(house.house.length, 12);
  assert.equal(sectors.length, 36);
});
test('missing native angle evidence does not invent extra methods', async () => {
  const data = {houses:{}};
  await addExtraHouses(data, {...snapshot, houseAngleContext:null}, {id:'virgostars_ephemeris', engineVersion:'test'}, '2000-01-01T12:00:00Z', 40000000, 12496400);
  assert.deepEqual(data.houses, {});
});
