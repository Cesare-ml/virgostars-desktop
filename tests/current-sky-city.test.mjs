import test from 'node:test';
import assert from 'node:assert/strict';
import {CURRENT_SKY_CITY_KEY, loadCurrentSkyCity, saveCurrentSkyCity} from '../src/app/astro/current-sky-city.ts';

function storage() {
  const values = new Map();
  return {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)};
}
const city = {id: 42, name: 'Rome', latMicro: 41902800, lngMicro: 12496200, timeZone: 'Europe/Rome'};

test('chosen city survives restart without storing unrelated place metadata', () => {
  const local = storage();
  assert.equal(saveCurrentSkyCity(local, {...city, secret: 'not saved'}), true);
  assert.deepEqual(loadCurrentSkyCity(local).name, 'Rome');
  assert.equal(local.getItem(CURRENT_SKY_CITY_KEY).includes('secret'), false);
  assert.equal(saveCurrentSkyCity(local, null), true);
  assert.equal(loadCurrentSkyCity(local), null);
});

test('corrupt or invalid saved city is never restored', () => {
  const local = storage();
  for (const value of ['{', JSON.stringify({...city, version: 1, latMicro: 100000000}),
    JSON.stringify({...city, version: 2}), JSON.stringify({...city, version: 1, name: ''})]) {
    local.setItem(CURRENT_SKY_CITY_KEY, value);
    assert.equal(loadCurrentSkyCity(local), null);
  }
  assert.equal(saveCurrentSkyCity(local, {...city, lngMicro: 181000000}), false);
});
