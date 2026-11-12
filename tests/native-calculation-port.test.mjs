import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeCalculationPort } from '../src/app/native/calculation-port.ts';
import { LatestCalculationQueue, validCalculationDraft } from '../src/app/native/calculation-queue.ts';

const draft = n => ({
  intent:'scrub', utcIso:'2026-11-12T12:00:00.000Z',
  latMicro:44_123_456, lngMicro:11_345_678, timeZone:'Europe/Rome',
  calculationKey:'fixture.'+n,
});
const request = n => ({protocolVersion:1,sessionId:'session_A',requestSeq:n,...draft(n)});
const unavailable = req => ({protocolVersion:1,sessionId:req.sessionId,
  requestSeq:req.requestSeq,calculationKey:req.calculationKey,
  status:'unavailable',reasonCode:'EPHEMERIS_NOT_INTEGRATED'});
const settle = () => new Promise(resolve=>setImmediate(resolve));

test('browser mode does not invoke native command or fake a sky', async () => {
  let calls=0;
  const port=createNativeCalculationPort({isNative:()=>false,invoke:async()=>{calls++;return null;}},validCalculationDraft);
  await assert.rejects(port(request(1),new AbortController().signal),/CALC_NATIVE_UNAVAILABLE/);
  assert.equal(calls,0);
});

test('native command receives only strictly versioned, bounded input', async () => {
  const seen=[];
  const port=createNativeCalculationPort({isNative:()=>true,invoke:async(command,args)=>{
    seen.push({command,args});return unavailable(args.request);
  }},validCalculationDraft);
  const reply=await port({...request(1),password:'must-not-cross-ipc'},new AbortController().signal);
  assert.equal(seen.length,1);
  assert.equal(seen[0].command,'desktop_calculation_probe');
  assert.deepEqual(Object.keys(seen[0].args.request).sort(),[
    'calculationKey','intent','latMicro','lngMicro','protocolVersion','requestSeq',
    'sessionId','timeZone','utcIso',
  ].sort());
  assert.equal(JSON.stringify(seen[0]).includes('password'),false);
  assert.equal(reply.status,'unavailable');
  assert.equal('snapshot' in reply,false);
});

test('invalid request and aborted request never touch native IPC', async()=>{
  let calls=0;const port=createNativeCalculationPort({isNative:()=>true,invoke:async()=>{calls++;}},validCalculationDraft);
  for(const req of [
    {...request(1),protocolVersion:2},
    {...request(0)},
    {...request(1),requestSeq:Number.MAX_SAFE_INTEGER+1},
    {...request(1),sessionId:'bad session'},
    {...request(1),utcIso:'not-a-timestamp'},
  ]) await assert.rejects(port(req,new AbortController().signal));
  const controller=new AbortController();controller.abort();
  await assert.rejects(port(request(1),controller.signal));
  assert.equal(calls,0);
});

test('aborted native invocation cannot return its stale reply',async()=>{
  let resolve;const controller=new AbortController();
  const port=createNativeCalculationPort({isNative:()=>true,invoke:()=>new Promise(done=>resolve=done)},validCalculationDraft);
  const pending=port(request(1),controller.signal);
  await settle();controller.abort();resolve(unavailable(request(1)));
  await assert.rejects(pending,/CALC_ABORTED/);
});

test('queue + adapter forward only correlated unavailable and never claim ready astronomy',async()=>{
  const outcomes=[];
  const port=createNativeCalculationPort({isNative:()=>true,invoke:async(_command,args)=>unavailable(args.request)},validCalculationDraft);
  const queue=new LatestCalculationQueue('session_A',port,()=>false,x=>outcomes.push(x));
  queue.submit(draft(1));await settle();
  assert.deepEqual(outcomes.map(x=>x.kind),['unavailable']);
  assert.deepEqual(outcomes.map(x=>x.request.calculationKey),['fixture.1']);
  queue.dispose();
});

test('native transport rejection surfaces only sanitized queue error',async()=>{
  const outcomes=[];
  const port=createNativeCalculationPort({isNative:()=>true,invoke:async()=>{throw new Error('sensitive file path');}},validCalculationDraft);
  const queue=new LatestCalculationQueue('session_A',port,()=>false,x=>outcomes.push(x));
  queue.submit(draft(1));await settle();
  assert.equal(outcomes.length,1);
  assert.equal(outcomes[0].kind,'transport_error');
  assert.equal(JSON.stringify(outcomes).includes('sensitive file path'),false);
  queue.dispose();
});
