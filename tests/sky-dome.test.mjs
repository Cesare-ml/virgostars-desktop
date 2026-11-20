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
  points:Array.from({length:31},(_,i)=>sampleDirection(0,signIndex*30+i)),
  label:sampleDirection(0,signIndex*30+15),
}));
const reply=()=>({
  protocolVersion:1,status:'ok',providerId:'virgostars_ephemeris',
  planets:[fixture('Sun',50,180),fixture('Moon',-20,90)],
  stars:[fixture('Sirius',-2,225,true,-1.44)],
  zodiacSegments:zodiacFixture(),
});

test('3D renderer uses true north/east/up and supports underground points',()=>{
  const n=observerVector(0,0),e=observerVector(90,0),s=observerVector(180,0),w=observerVector(270,0);
  near(n.x,0);near(n.z,1);
  near(e.x,1);near(e.z,0);
  near(s.z,-1);near(w.x,-1);
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
  ]){
    const modified=reply();mutation(modified);
    assert.throws(()=>decodeSkyDome(modified),/protocol/);
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
  assert.match(rust,/topocentric_horizontal/);
  assert.match(rust,/zodiac_direction/);
  assert.match(viewer,/zodiacGlyphUrl/);
  assert.match(viewer,/data.zodiacSegments/);
  assert.match(read('src/app/sky-dome.component.html'),/toggleLayer\('zodiac'\)/);
  assert.match(viewer,/calculateSkyDome/);
  assert.doesNotMatch(viewer,/Math\.random\(|synthetic|fakePlanet/);
});
