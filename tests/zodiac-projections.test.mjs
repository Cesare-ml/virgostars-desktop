import test from 'node:test';
import assert from 'node:assert/strict';
import {zodiacProjectionPoints} from '../src/app/astro/zodiac-projections.ts';

test('reflections match Regolo axes and normalize around the zodiac seam', () => {
  const data = {planets:{Sun:{longitude:15,longitudeSpeed:1},Moon:{longitude:359,longitudeSpeed:-1}}};
  const visible = {Sun:{shown:true},Moon:{shown:true}};
  for (const [axis,sun,moon] of [['Cardinale',165,181],['Fissa',225,241],['Mutevole',285,301]]) {
    const result = zodiacProjectionPoints(data,axis,visible);
    assert.deepEqual(result.map(point => point.antiscia),[sun,moon]);
    assert.deepEqual(result.map(point => point.contraAntiscia),[(sun+180)%360,(moon+180)%360]);
    assert.equal(result[1].retrograde,true);
  }
});

test('missing and hidden planets are not invented or projected', () => {
  const data = {planets:{Sun:{longitude:0,longitudeSpeed:1},Moon:{longitude:NaN,longitudeSpeed:1},Mars:{longitude:50,longitudeSpeed:1}}};
  const result = zodiacProjectionPoints(data,'Cardinale',{Sun:{shown:true},Moon:{shown:true},Mars:{shown:false}});
  assert.deepEqual(result.map(point=>point.name),['Sun']);
  assert.equal(result[0].antiscia,180);
  assert.equal(result[0].contraAntiscia,0);
});
