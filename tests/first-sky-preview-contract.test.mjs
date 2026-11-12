import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeFirstSkyPreview,validateFirstSkyInput,
  FIRST_SKY_APPROXIMATIONS,FIRST_SKY_BODIES,
} from '../src/app/native/first-sky-preview-contract.ts';

const utc='2026-11-10T12:30:00.000Z';
const observer={latitudeMicrodegrees:45464200,longitudeMicrodegrees:9190000,heightMeters:120};
const request={
  protocolVersion:1,sessionId:'natal-A',requestSeq:7,calculationKey:'sky:epoch-7',
  input:{utcInstant:utc,observer,requestedBodies:['Sun','MarsBarycenter']},
};
const position=(body)=>({
  body,meanEclipticLongitudeDeg:40,meanEclipticLatitudeDeg:1.1,
  meanRightAscensionDeg:42,meanDeclinationDeg:10,altitudeDeg:30,
  azimuthDeg:200,distanceKm:1_000_000,
});
const result={
  provider:'VirgoStars-Ephemeris',model:'experimental_first_sky',
  quality:'unverified_geometric',chartEligible:false,
  frame:'topocentric_mean_of_date',kernelFormat:'classic_DE441',
  kernelSha256:'a'.repeat(64),coreVersion:'0.1.0',
  computedUtc:utc,approximations:[...FIRST_SKY_APPROXIMATIONS],
  positions:[position('Sun'),position('MarsBarycenter')],
};
const wire={protocolVersion:1,sessionId:request.sessionId,requestSeq:request.requestSeq,
  calculationKey:request.calculationKey,result};
const decode=(response=wire,req=request)=>decodeFirstSkyPreview(response,req);
test('valid experimental output stays ineligible for a natal chart',()=>{
 const out=decode();
 assert.equal(out.kind,'experimental_geometric_preview');
 assert.equal(out.chartEligible,false);
 assert.equal(out.response.result.chartEligible,false);
 assert.equal(out.response.result.quality,'unverified_geometric');
 assert.equal(out.response.result.positions[1].body,'MarsBarycenter');
});
test('only upstream supported first_sky body names are permitted',()=>{
 assert.deepEqual(FIRST_SKY_BODIES,[
   'Sun','Moon','Mercury','Venus','MarsBarycenter','JupiterBarycenter',
   'SaturnBarycenter','UranusBarycenter','NeptuneBarycenter','PlutoBarycenter',
 ]);
 assert.equal(FIRST_SKY_BODIES.includes('Mars'),false);
});
test('offset-free canonical UTC instant is mandatory',()=>{
 for(const bad of ['2026-11-10T13:30:00+01:00','2026-11-10','2026-11-10T12:30:00Z',
  '2026-02-29T00:00:00.000Z','2026-11-10T12:30:60.000Z','2026-11-10T12:30:00.000+00:00']){
  assert.throws(()=>validateFirstSkyInput({...request.input,utcInstant:bad}),/FIRST_SKY_INVALID_INPUT/);
 }
});
test('upstream leap-second table window fails closed at expiry',()=>{
 for(const bad of ['1971-12-31T23:59:59.000Z','2027-06-28T00:00:00.000Z','2040-01-01T00:00:00.000Z']){
  assert.throws(()=>validateFirstSkyInput({...request.input,utcInstant:bad}),/FIRST_SKY_INVALID_INPUT/);
 }
 validateFirstSkyInput({...request.input,utcInstant:'1972-01-01T00:00:00.000Z'});
 validateFirstSkyInput({...request.input,utcInstant:'2027-06-27T23:59:59.000Z'});
});
test('observer uses exact signed microdegrees and height in metres',()=>{
 const valid={latitudeMicrodegrees:-90_000_000,longitudeMicrodegrees:180_000_000,heightMeters:-12_000};
 validateFirstSkyInput({...request.input,observer:valid});
 for(const bad of [
  {...observer,latitudeMicrodegrees:90_000_001},
  {...observer,longitudeMicrodegrees:180_000_001},
  {...observer,heightMeters:100_001},
  {...observer,heightMeters:Infinity},
  {...observer,latitudeMicrodegrees:42.5},
 ])assert.throws(()=>validateFirstSkyInput({...request.input,observer:bad}),/FIRST_SKY_INVALID_INPUT/);
});
test('body request must be supported, unique and bounded',()=>{
 for(const bodies of [[],['Mars'],['Sun','Sun'],['Sun',null],new Array(20).fill('Moon')]){
  assert.throws(()=>validateFirstSkyInput({...request.input,requestedBodies:bodies}),/FIRST_SKY_INVALID_INPUT/);
 }
});
test('envelope must echo same request sequence/session/key/version',()=>{
 for(const fields of [{requestSeq:8},{sessionId:'other'},{calculationKey:'k'},
    {protocolVersion:2},{result:null}]){
  assert.throws(()=>decode({...wire,...fields}),/FIRST_SKY_INVALID_ENVELOPE/);
 }
});
test('request sequence and token cannot be unbounded',()=>{
 for(const r of [{...request,requestSeq:0},{...request,requestSeq:2**53},
   {...request,sessionId:''},{...request,calculationKey:'hello world'}]){
  assert.throws(()=>decode(wire,r),/FIRST_SKY_INVALID_REQUEST/);
 }
});
test('a synthetic probe cannot masquerade as a real sky result',()=>{
 const fake={...wire,result:{syntheticOnly:true,fixtureKind:'synthetic_ipc_probe',
   iterations:10,checksumHex:'1234abcd',workerMicros:20}};
 assert.throws(()=>decode(fake),/FIRST_SKY_INVALID_MODEL/);
});
test('do not allow a provider to claim independently validated or chart ready',()=>{
 for(const patch of [{quality:'reference_verified'},{chartEligible:true},
    {model:'apparent_swiss_equivalent'},{provider:'Swiss Ephemeris'},
    {frame:'J2000'},{kernelFormat:'SPK'}]){
  assert.throws(()=>decode({...wire,result:{...result,...patch}}),/FIRST_SKY_INVALID_MODEL/);
 }
});
test('kernel digest, core version and computed UTC are required',()=>{
 for(const patch of [{kernelSha256:'hello'},{kernelSha256:'A'.repeat(64)},
   {kernelSha256:null},{coreVersion:'unknown'},{computedUtc:'2026-11-10T12:31:00.000Z'}]){
  assert.throws(()=>decode({...wire,result:{...result,...patch}}),/FIRST_SKY_INVALID_MODEL/);
 }
});
test('all upstream approximation warnings must be preserved exactly',()=>{
 for(const approximation of [[],FIRST_SKY_APPROXIMATIONS.slice(1),
   [...FIRST_SKY_APPROXIMATIONS.slice(1),FIRST_SKY_APPROXIMATIONS[1]],
   [...FIRST_SKY_APPROXIMATIONS.slice(1),'CorrectedForAberration']]){
  assert.throws(()=>decode({...wire,result:{...result,approximations:approximation}}),/FIRST_SKY_INVALID_MODEL/);
 }
});
test('Sun and Mars barycenter cannot be replaced or duplicated silently',()=>{
 for(const bodies of [
  [position('Sun'),position('Sun')],
  [position('Sun'),position('Mars')],
  [position('Sun'),position('Moon')],
  [position('Sun')],
 ]){
  assert.throws(()=>decode({...wire,result:{...result,positions:bodies}}));
 }
});
test('longitude and right ascension are normalized [0,360)',()=>{
 for(const patch of [{meanEclipticLongitudeDeg:360},{meanEclipticLongitudeDeg:-1},
   {meanRightAscensionDeg:360},{meanRightAscensionDeg:NaN}]){
  assert.throws(()=>decode({...wire,result:{...result,positions:[{...position('Sun'),...patch},position('MarsBarycenter')]}}),/FIRST_SKY_INVALID_POSITION/);
 }
});
test('latitude/declination/altitude and distance are finite bounded quantities',()=>{
 for(const patch of [{meanEclipticLatitudeDeg:91},{meanDeclinationDeg:-91},
   {altitudeDeg:Infinity},{distanceKm:0},{distanceKm:1e16}]){
  assert.throws(()=>decode({...wire,result:{...result,positions:[{...position('Sun'),...patch},position('MarsBarycenter')]}}),/FIRST_SKY_INVALID_POSITION/);
 }
});
test('azimuth is optional only as null for zenith and nadir',()=>{
 const positions=[{...position('Sun'),azimuthDeg:null},position('MarsBarycenter')];
 assert.equal(decode({...wire,result:{...result,positions}}).response.result.positions[0].azimuthDeg,null);
 for(const value of [-1,360,'',undefined]){
  assert.throws(()=>decode({...wire,result:{...result,positions:[{...position('Sun'),azimuthDeg:value},position('MarsBarycenter')]}}),/FIRST_SKY_INVALID_POSITION/);
 }
});
test('decoder emits only approved keys and never preserves injected positions elsewhere',()=>{
 const response=decode({...wire,planets:[{body:'invented'}],result:{...result,secret:'not allowed'}});
 assert.equal('planets' in response.response,false);
 assert.equal('secret' in response.response.result,false);
 assert.equal('chartReady' in response.response.result,false);
});
test('no geometry or ephemeris calculation is performed in the type guard',async()=>{
 // The decoder validates already computed numeric quantities; no algorithms or file access.
 const file=(await import('node:fs')).readFileSync(new URL('../src/app/native/first-sky-preview-contract.ts',import.meta.url),'utf8');
 assert.doesNotMatch(file,/\b(?:invoke|fetch|localStorage|sessionStorage|indexedDB|sin|cos|atan2|sqrt)\s*\(/);
});
