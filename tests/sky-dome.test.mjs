import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {observerVector,validOverlay} from '../src/app/sky-dome-geometry.ts';
import {decodeSkyDome,requestSkyDome} from '../src/app/native/sky-dome-contract.ts';

const near=(value,expected)=>assert.ok(Math.abs(value-expected)<1e-10,`expected ${value} near ${expected}`);
const fixture=(id,alt,az,approximate=false,magnitude=null)=>({
  id,altitudeDeg:alt,azimuthNorthEastDeg:az,approximate,magnitude,
});
const sampleDirection=(altitudeDeg,azimuthNorthEastDeg)=>({altitudeDeg,azimuthNorthEastDeg});
const zodiacFixture=()=>Array.from({length:12},(_,signIndex)=>({
  signIndex,
  // Fixtures test the IPC schema; they are not astronomical predictions.
  points:Array.from({length:31},(_,i)=>sampleDirection(0,(signIndex*30+i)%360)),
  label:sampleDirection(0,signIndex*30+15),
}));
const gridFixture=()=>({
  northEdge:Array.from({length:361},(_,i)=>sampleDirection(8,i%360)),
  southEdge:Array.from({length:361},(_,i)=>sampleDirection(-8,i%360)),
  signDividers:Array.from({length:12},(_,i)=>Array.from({length:9},(_,j)=>
    sampleDirection(-8+2*j,i*30))),
  decadeTicks:Array.from({length:24},(_,i)=>Array.from({length:5},(_,j)=>
    sampleDirection(-4+2*j,(Math.floor(i/2)*30+10+(i%2)*10)%360))),
});
const reply=()=>({
  protocolVersion:1,status:'ok',providerId:'virgostars_ephemeris',
  planets:[fixture('Sun',50,180),fixture('Moon',-20,90)],
  stars:[fixture('Sirius',-2,225,true,-1.44)],
  zodiacSegments:zodiacFixture(),
  zodiacGrid:gridFixture(),
  angles:['ASC','DSC','MC','IC'].map((id,i)=>({
    id,zodiacLongitudeDeg:i*90,position:sampleDirection(i*20-30,i*90),
  })),
  houseGrids:[
    {
      id:'egizia',
      cuspLongitudesDeg:Array.from({length:12},(_,i)=>(i*30+12)%360),
      separators:Array.from({length:12},(_,i)=>Array.from({length:9},(_,j)=>
        sampleDirection(-8+2*j,(i*30+12)%360))),
      labels:Array.from({length:12},(_,i)=>sampleDirection(0,(i*30+27)%360)),
    },
  ],
});

test('3D renderer uses true north/east/up and supports underground points',()=>{
  const n=observerVector(0,0),e=observerVector(90,0),s=observerVector(180,0),w=observerVector(270,0);
  near(n.x,0);near(n.z,-1);
  near(e.x,1);near(e.z,0);
  near(s.z,1);near(w.x,-1);
  near(observerVector(0,90).y,1);
  near(observerVector(0,-90).y,-1);
  assert.equal(observerVector(0,-91),null);
  assert.equal(observerVector(0,20,0),null);
});
test('future primary directions require provenance and computed curves, not empty decoration',()=>{
  assert.equal(validOverlay({id:'test',kind:'primary-directions',provenance:'provider-v1',
    points:[{altitudeDeg:20,azimuthNorthEastDeg:0},{altitudeDeg:30,azimuthNorthEastDeg:20}]}),true);
  assert.equal(validOverlay({id:'test',kind:'primary-directions',provenance:'',
    points:[{altitudeDeg:20,azimuthNorthEastDeg:0},{altitudeDeg:30,azimuthNorthEastDeg:20}]}),false);
  assert.equal(validOverlay({id:'test',kind:'houses',provenance:'author',
    points:[{altitudeDeg:100,azimuthNorthEastDeg:0},{altitudeDeg:0,azimuthNorthEastDeg:20}]}),false);
});
test('sky dome protocol accepts only bounded, finite, uniquely named real positions',()=>{
  const decoded=decodeSkyDome(reply());
  assert.equal(decoded.kind,'ready');
  assert.equal(decoded.data.stars[0].approximate,true);
  assert.ok(Object.isFrozen(decoded.data.planets));
  assert.ok(Object.isFrozen(decoded.data.zodiacSegments));
  assert.equal(decoded.data.zodiacSegments.length,12);
  assert.equal(decoded.data.zodiacSegments[0].points.length,31);
  assert.equal(decoded.data.zodiacGrid.northEdge.length,361);
  assert.equal(decoded.data.zodiacGrid.southEdge.length,361);
  assert.equal(decoded.data.zodiacGrid.signDividers.length,12);
  assert.equal(decoded.data.zodiacGrid.decadeTicks.length,24);
  assert.ok(Object.isFrozen(decoded.data.zodiacGrid));
  assert.deepEqual(decoded.data.angles.map(a=>a.id),['ASC','DSC','MC','IC']);
  assert.equal(decoded.data.houseGrids.length,1);
  assert.equal(decoded.data.houseGrids[0].id,'egizia');
  assert.equal(decoded.data.houseGrids[0].separators.length,12);
  assert.equal(decoded.data.houseGrids[0].separators[3].length,9);
  for(const mutation of [
    r=>r.planets[0].altitudeDeg=NaN,
    r=>r.planets[1].azimuthNorthEastDeg=-1,
    r=>r.planets.push({...r.planets[0]}),
    r=>r.stars[0].magnitude=Infinity,
    r=>r.planets[0].id='Invented planet',
    r=>r.planets.splice(1,1),
    r=>r.protocolVersion=2,
    r=>r.zodiacSegments.pop(),
    r=>r.zodiacSegments[3].signIndex=0,
    r=>r.zodiacSegments[2].points.pop(),
    r=>r.zodiacSegments[4].label.altitudeDeg=Infinity,
    r=>r.zodiacSegments[5].points[7].azimuthNorthEastDeg=-2,
    r=>r.zodiacGrid.northEdge.pop(),
    r=>r.zodiacGrid.southEdge[20].altitudeDeg=100,
    r=>r.zodiacGrid.signDividers.pop(),
    r=>r.zodiacGrid.signDividers[2][1].azimuthNorthEastDeg=Infinity,
    r=>r.zodiacGrid.decadeTicks[2].pop(),
    r=>r.angles.pop(),
    r=>r.angles[1].id='ASC',
    r=>r.angles[2].zodiacLongitudeDeg=Infinity,
    r=>r.angles[3].position.altitudeDeg=91,
    r=>r.houseGrids[0].id='invented',
    r=>r.houseGrids[0].cuspLongitudesDeg.pop(),
    r=>r.houseGrids[0].separators[4].pop(),
    r=>r.houseGrids[0].labels[2].altitudeDeg=100,
    r=>r.houseGrids.push({...r.houseGrids[0]}),
  ]){
    const modified=reply();mutation(modified);
    assert.throws(()=>decodeSkyDome(modified),/protocol/);
  }
});
test('computed lunar illumination is bounded, native-only and visible in the detail card',()=>{
  const data=reply();
  data.planets[1].illuminatedFraction=0.503;
  const decoded=decodeSkyDome(data);
  assert.equal(decoded.kind,'ready');
  assert.equal(decoded.data.planets[1].illuminatedFraction,0.503);
  assert.equal(decoded.data.planets[0].illuminatedFraction,null);
  assert.equal(decoded.data.stars[0].illuminatedFraction,null);
  const impossible=[
    r=>r.planets[1].illuminatedFraction=-0.01,
    r=>r.planets[1].illuminatedFraction=1.01,
    r=>r.planets[1].illuminatedFraction=Number.NaN,
    r=>r.planets[0].illuminatedFraction=0.9,
    r=>r.stars[0].illuminatedFraction=0.9,
  ];
  for(const mutate of impossible){
    const bad=reply();
    mutate(bad);
    assert.throws(()=>decodeSkyDome(bad),/protocol/);
  }
  const rust=readFileSync(new URL('../src-tauri/src/sky_dome.rs',import.meta.url),'utf8');
  const viewer=readFileSync(new URL('../src/app/sky-dome.component.ts',import.meta.url),'utf8');
  const template=readFileSync(new URL('../src/app/sky-dome.component.html',import.meta.url),'utf8');
  assert.match(rust,/lunar_illumination_fraction\(sun,moon\)/);
  assert.match(rust,/if body\.id=="Moon"\{lunar_fraction\}/);
  assert.match(viewer,/this\.sunLight\.position\.copy/);
  assert.match(viewer,/sun\.azimuthNorthEastDeg,sun\.altitudeDeg,70/);
  assert.match(template,/selection\.point\.illuminatedFraction/);
  assert.match(template,/word\('illuminatedFraction'\)/);
});

test('planet and fixed-star metadata are validated and never invented in the browser',()=>{
  const item=reply();
  item.planets[0]={
    ...item.planets[0],
    eclipticLongitudeDeg:120.45,eclipticLatitudeDeg:0.001,
    rightAscensionDeg:122.33,declinationDeg:17.5,
    distanceAu:1.02,longitudeSpeedDegPerDay:1.02,
    constellation:null,catalogId:null,ephemerisSource:'de441',
  };
  item.stars[0]={
    ...item.stars[0],
    eclipticLongitudeDeg:104.9,eclipticLatitudeDeg:-39.6,
    rightAscensionDeg:null,declinationDeg:null,
    distanceAu:null,longitudeSpeedDegPerDay:null,
    constellation:'CMa',catalogId:93,ephemerisSource:null,
  };
  const decoded=decodeSkyDome(item);
  assert.equal(decoded.kind,'ready');
  assert.equal(decoded.data.planets[0].distanceAu,1.02);
  assert.equal(decoded.data.stars[0].constellation,'CMa');
  const longName=structuredClone(item);
  longName.stars[0].constellation='O'.repeat(160);
  assert.equal(decodeSkyDome(longName).kind,'ready');
  for(const modify of [
    raw=>raw.planets[0].distanceAu=Infinity,
    raw=>raw.planets[0].rightAscensionDeg=-1,
    raw=>raw.stars[0].catalogId=-9,
    raw=>raw.stars[0].constellation='x'.repeat(161),
  ]){
    const broken=structuredClone(item);
    modify(broken);
    assert.throws(()=>decodeSkyDome(broken),/protocol/);
  }
});

test('failed or unsupported native calculation never displays fictional stars or planets',async()=>{
  const request={utcIso:'2026-11-20T13:00:00Z',latMicro:45_000_000,lngMicro:9_000_000};
  assert.deepEqual(await requestSkyDome({isNative:()=>false,invoke:()=>Promise.reject()},request),{kind:'not_native'});
  assert.deepEqual(await requestSkyDome({isNative:()=>true,invoke:()=>Promise.reject()},request),{kind:'unavailable'});
  const calls=[];
  const port={isNative:()=>true,invoke:async (command,args)=>{
    calls.push({command,args});return reply();
  }};
  assert.equal((await requestSkyDome(port,request)).kind,'ready');
  assert.equal(calls[0].command,'calculate_sky_dome');
  assert.deepEqual(calls[0].args.request,{protocolVersion:1,...request});
  assert.deepEqual(await requestSkyDome(port,{...request,latMicro:Infinity}),{kind:'invalid_request'});
  assert.equal(calls.length,1);
});
test('Desktop chart uses separate 3D presentation, not a second synthetic natal renderer',()=>{
  const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
  const template=read('src/app/desktop-app.component.html');
  const controller=read('src/app/desktop-app.component.ts');
  const viewer=read('src/app/sky-dome.component.ts');
  const rust=read('src-tauri/src/sky_dome.rs');
  assert.match(template,/<vs-sky-dome \*ngIf="view==='chart'/);
  assert.match(template,/\(click\)="toggleSkyDome\(\)"/);
  assert.match(controller,/chartPresentation: 'wheel' \| 'elements' \| 'aspects' \| 'sky3d'/);
  assert.match(controller,/this\.mode !== 'natal'\) this\.setMode\('natal'\)/);
  assert.match(controller,/this\.chartPresentation === 'sky3d'\) this\.chartPresentation = 'wheel'/);
  assert.match(rust,/topocentric_horizontal/);
  assert.match(rust,/zodiac_direction/);
  assert.match(rust,/SkyAngleV1/);
  assert.match(rust,/SkyZodiacGridV1/);
  assert.match(rust,/fn ecliptic_to_equatorial\(/);
  assert.match(rust,/let \(star_ra,star_dec\)=ecliptic_to_equatorial\(/);
  assert.match(rust,/zodiac_latitude_direction/);
  assert.match(viewer,/buildAngles/);
  assert.match(viewer,/zodiacGlyphUrl/);
  assert.match(viewer,/data.zodiacSegments/);
  assert.match(read('src/app/sky-dome.component.html'),/toggleLayer\('zodiac'\)/);
  assert.match(read('src/app/sky-dome.component.html'),/toggleLayer\('zodiacGrid'\)/);
  assert.match(read('src/app/sky-dome.component.html'),/toggleLayer\('angles'\)/);
  assert.match(viewer,/calculateSkyDome/);
  assert.doesNotMatch(viewer,/Math\.random\(|synthetic|fakePlanet/);
});
