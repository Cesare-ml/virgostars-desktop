import test from 'node:test';
import assert from 'node:assert/strict';
import {fixedStarContact, fixedStarChartContact, dodecatemoriaContactPoints, starAzimuthNorthEast, starWithinMagnitude} from '../src/app/astro/fixed-star-contacts.ts';

// Fictional directions and chart axes, with no birth date or personal data.
const star = azimuthSouthWestDeg => ({id:1,name:'Test Star',longitudeDeg:12,
  latitudeDeg:0,magnitude:1,trueAltitudeDeg:0.2,azimuthSouthWestDeg,
  approximate:true,constellation:null,interpretations:{}});
const house = {ascendant:40,ds:220,mc:130,ic:310};

test('display azimuth uses north as zero and increases eastwards', () => {
  assert.equal(starAzimuthNorthEast(180),0);
  assert.equal(starAzimuthNorthEast(270),90);
  assert.equal(starAzimuthNorthEast(0),180);
  assert.equal(starAzimuthNorthEast(90),270);
});

test('a star on the western horizon is displayed on the descendant', () => {
  // South-through-west 135° is northwest, north-through-east 315°.
  const contact=fixedStarContact(star(135),{},house);
  assert.equal(contact.axis,'DS');
  assert.equal(contact.longitude,house.ds);
});

test('a star on the eastern horizon is displayed on the ascendant', () => {
  // South-through-west 225° is northeast, north-through-east 45°.
  const contact=fixedStarContact(star(225),{},house);
  assert.equal(contact.axis,'AS');
  assert.equal(contact.longitude,house.ascendant);
});

test('the southern and northern parts of each horizon keep the same axis', () => {
  for (const azimuth of [20, 90, 160]) {
    assert.equal(fixedStarContact({...star(azimuth),trueAltitudeDeg:-0.3},{},house).axis,'DS');
  }
  for (const azimuth of [200, 270, 340]) {
    assert.equal(fixedStarContact({...star(azimuth),trueAltitudeDeg:-0.3},{},house).axis,'AS');
  }
});

test('a planetary conjunction away from an axis keeps its ecliptic longitude', () => {
  const contact=fixedStarContact({...star(100),trueAltitudeDeg:20},{Sun:12.5},house);
  assert.equal(contact.axis,null);
  assert.deepEqual(contact.conjunctions,['Sun']);
  assert.equal(contact.longitude,12);
});

test('longitude and axis orbs are independent, and zero disables each contact type', () => {
  const example={...star(135),trueAltitudeDeg:0.7};
  const points={Sun:12.8};
  const longitudeOnly=fixedStarContact(example,points,house,{longitudeOrb:1,axisOrb:0.5});
  assert.equal(longitudeOnly.axis,null);
  assert.deepEqual(longitudeOnly.conjunctions,['Sun']);
  const axisOnly=fixedStarContact(example,points,house,{longitudeOrb:0.5,axisOrb:1});
  assert.equal(axisOnly.axis,'DS');
  assert.deepEqual(axisOnly.conjunctions,[]);
  assert.equal(fixedStarContact(example,points,house,{longitudeOrb:0,axisOrb:0}),null);
});

test('maximum magnitude keeps brighter stars and handles unknown values explicitly', () => {
  const settings={magnitudeLimit:2,includeUnknownMagnitude:false,longitudeOrb:1,axisOrb:1};
  assert.equal(starWithinMagnitude({magnitude:-3},settings),true);
  assert.equal(starWithinMagnitude({magnitude:2},settings),true);
  assert.equal(starWithinMagnitude({magnitude:5},settings),false);
  assert.equal(starWithinMagnitude({magnitude:null},settings),false);
  assert.equal(starWithinMagnitude({magnitude:null},{...settings,includeUnknownMagnitude:true}),true);
  assert.equal(starWithinMagnitude({magnitude:15},{...settings,magnitudeLimit:null}),true);
});

test('projected star conjunctions use visible selected dodecatemoria and remain separate from natal and axes', () => {
  const data={planets:{Sun:{longitude:10,dodecatemoria:{longitude:130}},Moon:{longitude:45,dodecatemoria:{longitude:200}},
    Venus:{longitude:60,dodecatemoria:{longitude:130}},Mars:{longitude:70}}};
  const visible={Sun:{shown:true},Moon:{shown:true},Venus:{shown:false},Mars:{shown:true}};
  assert.deepEqual(dodecatemoriaContactPoints(data,visible,'tutti'),{Sun:130,Moon:200});
  assert.deepEqual(dodecatemoriaContactPoints(data,visible,'Moon'),{Moon:200});
  const example={...star(90),longitudeDeg:130.2,trueAltitudeDeg:30};
  const settings={longitudeOrb:1,axisOrb:1};
  const match=fixedStarChartContact(example,{Sun:10},dodecatemoriaContactPoints(data,visible,'tutti'),house,settings);
  assert.deepEqual(match.conjunctions,[]);
  assert.deepEqual(match.dodecatemoriaConjunctions,['Sun']);
  assert.equal(match.axis,null);
  assert.equal(match.longitude,130.2);
  assert.equal(fixedStarChartContact(example,{Sun:10},dodecatemoriaContactPoints(data,visible,'Moon'),house,settings),null);
  assert.equal(fixedStarChartContact(example,{Sun:10},{Sun:130},house,{longitudeOrb:0,axisOrb:1}),null);
  const both=fixedStarChartContact({...example,longitudeDeg:10.1},{Sun:10},{Moon:10.2},house,settings);
  assert.deepEqual(both.conjunctions,['Sun']);
  assert.deepEqual(both.dodecatemoriaConjunctions,['Moon']);
});
