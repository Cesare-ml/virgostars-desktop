import test from 'node:test';
import assert from 'node:assert/strict';
import {elementDistribution, ELEMENT_ORDER, MODALITY_ORDER} from '../src/app/astro/element-distribution.ts';
import {buildTemaRenderData,houseDisplay} from '../src/app/astro/tema-render-data.ts';

// Fictional and deliberately simple 30-degree house cusps; no user birth data.
const body = (id, longitudeDeg) => ({
  id, longitudeDeg, latitudeDeg:0, distanceAu:1, longitudeSpeed:1,
  latitudeSpeed:0, distanceSpeed:0, rightAscensionDeg:0, declinationDeg:0,
  ephemerisSource:'jpl',
});
const houses = offset => [{
  id:'egizia', cuspsDeg:Array.from({length:12},(_,i)=>(offset+i*30)%360),
  ascendantDeg:120, mcDeg:30, armcDeg:0, vertexDeg:10,
}];
const snapshot = () => ({
  bodies: [
    body('Sun',10), body('Moon',45), body('Mercury',65), body('Venus',95),
    body('Mars',190), body('Jupiter',265), body('Saturn',310), body('Uranus',130),
  ],
  houses:houses(120),
});
const element = (result,id) => result.strips.find(row=>row.id===id);
const names = placements => placements.map(item=>item.name);
const summarize = (data,system,includeTransaturnians=false) =>
  elementDistribution(data,system,house=>houseDisplay(house)?.element ?? null,includeTransaturnians);

test('sign distribution includes exactly the seven traditional planets, not Uranus',()=>{
  const data=buildTemaRenderData(snapshot(),'2000-01-01T12:00:00Z');
  const result=summarize(data,'egizia');
  assert.equal(result.countedPlanets,7);
  assert.deepEqual(ELEMENT_ORDER,['fire','air','water','earth']);
  assert.deepEqual(names(element(result,'fire').signPlanets),['Sun','Jupiter']);
  assert.deepEqual(names(element(result,'air').signPlanets),['Mercury','Mars','Saturn']);
  assert.deepEqual(names(element(result,'earth').signPlanets),['Moon']);
  assert.deepEqual(names(element(result,'water').signPlanets),['Venus']);
  assert.equal(result.strips.flatMap(row=>row.signPlanets).length,7);
});

test('optional transaturnians enter element and modality counts, but not unavailable dodecatemoria',()=>{
  const data=buildTemaRenderData({...snapshot(),bodies:[
    ...snapshot().bodies,body('Neptune',235),body('Pluto',282),
  ]},'2000-01-01T12:00:00Z');
  const classic=summarize(data,'egizia');
  const extended=summarize(data,'egizia',true);
  assert.equal(classic.countedPlanets,7);
  assert.equal(extended.countedPlanets,10);
  assert.deepEqual(names(element(extended,'fire').signPlanets),['Sun','Jupiter','Uranus']);
  assert.deepEqual(names(element(extended,'water').signPlanets),['Venus','Neptune']);
  assert.deepEqual(names(element(extended,'earth').signPlanets),['Moon','Pluto']);
  assert.equal(extended.modalities.reduce((count,row)=>count+row.planets.length,0),10);
  assert.equal(extended.strips.flatMap(row=>row.signDodecatemoria).length,7);
  assert.equal(extended.strips.flatMap(row=>row.houseDodecatemoria).length,7);
  assert.equal(classic.strips.flatMap(row=>row.signPlanets).length,7,'toggle never mutates original');
});

test('house groups use the chosen house cusps and do not assume sign elements',()=>{
  const data=buildTemaRenderData(snapshot(),'2000-01-01T12:00:00Z');
  const original=summarize(data,'egizia');
  assert.deepEqual(names(element(original,'fire').housePlanets),['Sun','Jupiter']);
  const rotated=structuredClone(data);
  rotated.houses.egizia.house=houses(150)[0].cuspsDeg;
  const changed=summarize(rotated,'egizia');
  assert.deepEqual(names(element(changed,'fire').signPlanets),names(element(original,'fire').signPlanets));
  assert.notDeepEqual(names(element(changed,'fire').housePlanets),names(element(original,'fire').housePlanets));
});

test('ASC/DS track signs, and dodecatemoria are placed in signs AND houses',()=>{
  const data=buildTemaRenderData(snapshot(),'2000-01-01T12:00:00Z');
  const result=summarize(data,'egizia');
  assert.deepEqual([result.ascSign,result.dsSign,result.ascElement,result.dsElement],[4,10,'fire','air']);
  assert.deepEqual(names(element(result,'fire').signDodecatemoria),['Sun','Mercury']);
  assert.deepEqual(names(element(result,'water').signDodecatemoria),['Moon']);
  assert.deepEqual(names(element(result,'earth').signDodecatemoria),['Venus']);
  assert.deepEqual(names(element(result,'air').signDodecatemoria),['Mars','Jupiter','Saturn']);
  assert.equal(result.strips.flatMap(row=>row.signDodecatemoria).length,7);
  assert.equal(result.strips.flatMap(row=>row.houseDodecatemoria).length,7);
  const moon=element(result,'water').houseDodecatemoria.find(item=>item.name==='Moon');
  assert.equal(moon.longitude,225);
  assert.equal(moon.house,4);
});

test('missing bodies/dodecatemoria and unavailable houses never create fabricated placements',()=>{
  const data=buildTemaRenderData({...snapshot(),bodies:[body('Sun',10)]},'2000-01-01T12:00:00Z');
  const noHouse=summarize(data,'placido');
  assert.equal(noHouse.countedPlanets,1);
  assert.equal(noHouse.strips.flatMap(row=>row.housePlanets).length,0);
  assert.equal(noHouse.strips.flatMap(row=>row.houseDodecatemoria).length,0);
  assert.equal(noHouse.strips.flatMap(row=>row.signDodecatemoria).length,1);
  delete data.planets.Sun.dodecatemoria;
  assert.equal(summarize(data,'egizia').strips.flatMap(row=>row.signDodecatemoria).length,0);
});

test('modality groups use sign quality, preserving exactly seven planets and chart order',()=>{
  const result=summarize(buildTemaRenderData(snapshot(),'2000-01-01T12:00:00Z'),'egizia');
  assert.deepEqual(MODALITY_ORDER,['cardinal','fixed','mutable']);
  assert.deepEqual(result.modalities.map(group=>group.id),['cardinal','fixed','mutable']);
  assert.deepEqual(result.modalities.map(group=>names(group.planets)),[
    ['Sun','Venus','Mars'],['Moon','Saturn'],['Mercury','Jupiter'],
  ]);
  assert.equal(result.modalities.reduce((total,group)=>total+group.planets.length,0),7);
});
