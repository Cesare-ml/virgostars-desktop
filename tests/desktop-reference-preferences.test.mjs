import test from 'node:test';
import assert from 'node:assert/strict';
import {loadReferencePlace,saveReferencePlace,loadAccountChart,saveAccountChart} from '../src/app/desktop-reference-preferences.ts';
const storage=()=>{const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)}};
test('reference place persists coordinates and timezone; malformed values fail closed',()=>{
  const s=storage(), p={name:'Latina',latMicro:41468000,lngMicro:12904000,timeZone:'Europe/Rome'};
  assert.equal(loadReferencePlace(s).name,'Roma');assert.equal(saveReferencePlace(s,p),true);assert.deepEqual(loadReferencePlace(s),p);
  assert.equal(saveReferencePlace(s,{...p,timeZone:'invalid'}),false);assert.deepEqual(loadReferencePlace(s),p);
});
test('account chart selection persists only a validated source and id',()=>{
  const s=storage(), a={source:'local',id:'00000000-0000-4000-8000-000000000001'};
  assert.equal(saveAccountChart(s,a),true);assert.deepEqual(loadAccountChart(s),a);
  assert.equal(saveAccountChart(s,{...a,id:'bad'}),false);assert.deepEqual(loadAccountChart(s),a);
  assert.equal(saveAccountChart(s,null),true);assert.equal(loadAccountChart(s),null);
});
