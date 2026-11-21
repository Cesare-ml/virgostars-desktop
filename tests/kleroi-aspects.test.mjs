import test from 'node:test';
import assert from 'node:assert/strict';
import {enableKleroiAspects,isKlerosSelected} from '../src/app/astro/kleroi-aspects.ts';

test('only displayed lots become aspect endpoints for each filter',()=>{
  const lots={Tyche:0,Daimon:60,Basis:120,Ananke:180,Eros:240,Hermes:300,Tolma:20,Nike:80,Nemesi:140};
  for(const [filter,count] of [['all',9],['principal',4],['planetary',5]]) {
    const points=Object.fromEntries(Object.keys(lots).map(name=>[name,{aspVerso:false}]));
    enableKleroiAspects(points,lots,filter);
    assert.equal(Object.values(points).filter(point=>point.aspVerso).length,count);
    for(const name of Object.keys(lots)) assert.equal(points[name].aspVerso,isKlerosSelected(name,filter));
  }
});
