import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';

const bundle=await build({
  entryPoints:[new URL('../src/app/native/solar-events-contract.ts',import.meta.url).pathname],
  bundle:true,platform:'node',format:'esm',write:false,
});
const {requestAutomaticHour}=await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const natal=Object.freeze({
  utcIso:'2024-06-20T10:00:00.000Z',timeZone:'Europe/Rome',
  latMicro:41_902_800,lngMicro:12_496_400,
});
const snapshot={
  weekday:'THURSDAY',
  observer:{latitudeDeg:41.9028,longitudeDegEast:12.4964,elevationMeters:0},
  model:{horizonDefinitionId:'USNO_MINUS_50_ARCMIN',refractionModelId:'STANDARD',eventAlgorithmId:'EXPERIMENTAL'},
  source:{engineId:'VIRGOSTARS_EPHEMERIS',engineVersion:'0.1.0',kernelSetId:'DE441_TEST',timeModelId:'EXPLICIT_UT1_TT_TDB',evidence:'CALLER_ASSERTED_NOT_VERIFIED'},
  events:{availability:'AVAILABLE',sunriseUtc:'2024-06-20T03:00:00.000Z',sunsetUtc:'2024-06-20T19:00:00.000Z',nextSunriseUtc:'2024-06-21T03:00:00.000Z'},
};
const transport=(response,options={})=>({
  isNative:()=>options.isNative??true,
  invoke:async(command,args)=>{
    options.calls?.push({command,args});
    if (response instanceof Error) throw response;
    return response;
  },
});
const reply=(status,snapshotValue=null)=>({protocolVersion:1,status,snapshot:snapshotValue});

test('non-native and provider-unavailable builds never invent an hour ruler',async()=>{
  const calls=[];
  assert.deepEqual(await requestAutomaticHour(transport(reply('ok',snapshot),{isNative:false,calls}),natal),{kind:'not_native'});
  assert.equal(calls.length,0);
  assert.deepEqual(await requestAutomaticHour(transport(reply('provider_unavailable')),natal),{kind:'provider_unavailable'});
  for(const status of ['invalid_request','out_of_range','calculation_failed']) {
    assert.deepEqual(await requestAutomaticHour(transport(reply(status)),natal),{kind:status});
  }
});

test('synthetic solar snapshot passes strict native contract and resolves real Chaldean sequence',async()=>{
  const calls=[];
  const result=await requestAutomaticHour(transport(reply('ok',snapshot),{calls}),natal);
  assert.equal(result.kind,'ready');
  assert.equal(result.ruler,'MOON');
  assert.equal(result.number,6);
  assert.equal(result.provenance,'CALLER_ASSERTED_NOT_SCIENTIFICALLY_VERIFIED');
  assert.equal(result.source.kernelSetId,'DE441_TEST');
  assert.deepEqual(calls,[{command:'calculate_solar_events',args:{request:{protocolVersion:1,utcIso:natal.utcIso,latMicro:natal.latMicro,lngMicro:natal.lngMicro}}}]);
});

test('native solar event snapshot must match natal location, local weekday and sunrise interval',async()=>{
  for(const [change,expected] of [
    [{observer:{...snapshot.observer,longitudeDegEast:8.5}},'mismatched_observer'],
    [{weekday:'WEDNESDAY'},'weekday_mismatch'],
    [{events:{...snapshot.events,sunriseUtc:'2024-06-20T10:30:00.000Z',sunsetUtc:'2024-06-20T19:00:00.000Z'}},'outside_interval'],
    [{events:{availability:'UNAVAILABLE',reason:'POLAR_DAY'}},'unavailable'],
  ]) {
    const result=await requestAutomaticHour(transport(reply('ok',{...snapshot,...change})),natal);
    assert.equal(result.kind,expected);
    assert.notEqual(result.kind,'ready');
  }
});

test('tampered, unexpected, getter-backed and inconsistent native replies fail closed',async()=>{
  const getterSnapshot={...snapshot};
  Object.defineProperty(getterSnapshot,'events',{enumerable:true,get(){throw new Error('private data');}});
  for(const replyValue of [
    null,{},reply('ok',null),reply('ok',{...snapshot,secret:'sensitive'}),
    reply('ok',getterSnapshot),reply('ok',{...snapshot,source:{...snapshot.source,evidence:'SCIENTIFICALLY_VERIFIED'}}),
    reply('ok',{...snapshot,events:{...snapshot.events,nextSunriseUtc:'not a date'}}),
    reply('provider_unavailable',snapshot),reply('unknown'),
    {...reply('ok',snapshot),protocolVersion:2},
    new Error('private path error'),
  ]) {
    assert.deepEqual(await requestAutomaticHour(transport(replyValue),natal),{kind:'unavailable'});
  }
});

test('invalid natal inputs never reach the native command',async()=>{
  const calls=[];
  assert.deepEqual(await requestAutomaticHour(transport(reply('ok',snapshot),{calls}),{
    ...natal,latMicro:100_000_000,
  }),{kind:'invalid_request'});
  assert.equal(calls.length,0);
});

test('a missing native reply expires after a bounded deadline without leaking late responses',async()=>{
  let expire,cleared=false;
  const calls=[];
  const pending=requestAutomaticHour({
    isNative:()=>true,
    invoke:async(command,args)=>{calls.push({command,args});return new Promise(()=>{});},
    timers:{set:(callback,ms)=>{assert.equal(ms,5000);expire=callback;return 42;},clear:handle=>{assert.equal(handle,42);cleared=true;}},
  },natal);
  await new Promise(resolve=>queueMicrotask(resolve));
  assert.equal(calls.length,1);
  expire();
  assert.deepEqual(await pending,{kind:'unavailable'});
  assert.equal(cleared,true);
});

test('failed or synchronous timeout setup never starts the native call',async()=>{
  let calls=0;
  for(const set of [()=>{throw new Error('scheduler failure');},callback=>{callback();return 4;}]) {
    assert.deepEqual(await requestAutomaticHour({
      isNative:()=>true,invoke:async()=>{++calls;return reply('ok',snapshot);},
      timers:{set,clear:()=>{}},
    },natal),{kind:'unavailable'});
  }
  assert.equal(calls,0);
});

test('the primary Desktop cross prioritizes automatic ruler and guards against late chart responses',()=>{
  const ts=readFileSync(new URL('../src/app/desktop-app.component.ts',import.meta.url),'utf8');
  const html=readFileSync(new URL('../src/app/desktop-app.component.html',import.meta.url),'utf8');
  const ruler=ts.indexOf('get selectedCrossHourRuler()');
  assert.ok(ruler>=0 && ts.indexOf("this.automaticHour?.kind === 'ready'",ruler) < ts.indexOf('this.manualHourRuler ||',ruler));
  assert.match(ts,/generation!==this\.automaticHourGeneration/);
  assert.match(ts,/current\.utcIso!==natal\.utcIso/);
  assert.match(ts,/current\.latMicro!==natal\.latMicro/);
  assert.match(ts,/current\.lngMicro!==natal\.lngMicro/);
  assert.match(ts,/\+\+this\.automaticHourGeneration;/);
  assert.match(html,/automaticHourPending/);
  assert.match(html,/automaticHourSummary/);
});
