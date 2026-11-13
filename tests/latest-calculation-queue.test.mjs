import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LatestCalculationQueue, validCalculationDraft, decodeCalculationReply
} from '../src/app/native/calculation-queue.ts';

const valid = n => ({
  intent: 'scrub', utcIso: '2026-11-12T12:00:00.000Z',
  latMicro: 44123456, lngMicro: 11345678, timeZone: 'Europe/Rome',
  calculationKey: `fixture.${n}`,
});
const reply = (req, snapshot = {tag:'synthetic-only'}) => ({
  protocolVersion:1, sessionId:req.sessionId, requestSeq:req.requestSeq,
  calculationKey:req.calculationKey, status:'ready',
  providerVersion:'fake-test-port-v1',snapshot,
});
const validate = v => !!v && typeof v === 'object' && v.tag === 'synthetic-only';
const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};}

test('validates UTC ISO, microdegree bounds and stable request keys',()=>{
  assert.equal(validCalculationDraft(valid(1)),true);
  for(const bad of [
    {...valid(1),utcIso:'2026-02-31T12:00:00.000Z'},
    {...valid(1),utcIso:'2026-11-12T12:00:00+01:00'},
    {...valid(1),latMicro:90_000_001},
    {...valid(1),lngMicro:NaN},
    {...valid(1),timeZone:'https://example.com'},
    {...valid(1),timeZone:'Nonexistent/Invalid'},
    {...valid(1),calculationKey:'<script>'},
    {...valid(1),intent:'unknown'},
  ]) assert.equal(validCalculationDraft(bad),false);
});

test('strictly rejects mismatched, incomplete or malformed native replies',()=>{
  const req={...valid(1),protocolVersion:1,sessionId:'session_1',requestSeq:1};
  for(const malformed of [null,{}, {...reply(req),requestSeq:2},
    {...reply(req),sessionId:'session_2'},
    {...reply(req),calculationKey:'wrong'},
    {...reply(req),snapshot:{tag:'unverified'}},
    {...reply(req),providerVersion:''},
  ]) assert.equal(decodeCalculationReply(malformed,req,validate).kind,'invalid_reply');
  assert.equal(decodeCalculationReply(reply(req),req,validate).kind,'ready');
  assert.equal(decodeCalculationReply({...reply(req),status:'unavailable',snapshot:{secret:'no'}},req,validate).kind,'unavailable');
});

test('200 rapid changes keep one active and exactly the latest pending request',async()=>{
  const gate1=deferred();const gate2=deferred();
  const started=[];const accepted=[];const aborted=[];
  const queue=new LatestCalculationQueue('session_1',(req,signal)=>{
    started.push(req);aborted.push(()=>signal.aborted);
    return started.length===1?gate1.promise:gate2.promise;
  },validate,outcome=>accepted.push(outcome));
  queue.submit(valid(0));await settle();
  for(let i=1;i<200;i++)queue.submit(valid(i));
  assert.equal(started.length,1);
  assert.equal(aborted[0](),true);
  gate1.resolve(reply(started[0]));await settle();
  assert.equal(started.length,2);
  assert.equal(started[1].calculationKey,'fixture.199');
  assert.equal(accepted.length,0);
  gate2.resolve(reply(started[1]));await settle();
  assert.equal(accepted.length,1);
  assert.equal(accepted[0].request.requestSeq,200);
  queue.dispose();
});

test('ten thousand scrub events remain bounded and deliver only the newest snapshot',async()=>{
  const first=deferred();const next=deferred();const started=[];const notified=[];
  const queue=new LatestCalculationQueue('session_1',req=>{
    started.push(req);return started.length===1?first.promise:next.promise;
  },validate,result=>notified.push(result));
  queue.submit(valid(0));await settle();
  for(let i=1;i<10000;i++)queue.submit(valid(i));
  assert.equal(started.length,1);
  first.resolve(reply(started[0]));await settle();
  assert.equal(started.length,2);
  assert.equal(started[1].requestSeq,10000);
  next.resolve(reply(started[1]));await settle();
  assert.deepEqual(notified.map(r=>r.request.calculationKey),['fixture.9999']);
  queue.dispose();
});

test('invalidate and dispose ignore stale successes and failures',async()=>{
  const gates=[deferred(),deferred()];const notified=[];let invoked=0;
  const queue=new LatestCalculationQueue('session_1',()=>gates[invoked++].promise,validate,x=>notified.push(x));
  queue.submit(valid(1));await settle();queue.invalidate();gates[0].resolve({status:'unavailable'});
  await settle();assert.equal(notified.length,0);
  queue.submit(valid(2));await settle();queue.dispose();
  gates[1].resolve({status:'unavailable'});await settle();
  assert.equal(queue.submit(valid(3)),null);
  assert.equal(notified.length,0);
});

test('transient port errors are sanitized and do not starve the pending request',async()=>{
  const first=deferred();const started=[];const outcomes=[];
  const queue=new LatestCalculationQueue('session_1',req=>{
    started.push(req);return started.length===1?first.promise:Promise.resolve(reply(req));
  },validate,x=>outcomes.push(x));
  queue.submit(valid(1));await settle();
  queue.submit(valid(2));
  first.reject(new Error('private path should not be exposed'));
  await settle();
  assert.equal(started.length,2);
  assert.deepEqual(outcomes.map(x=>x.kind),['ready']);
  queue.submit(valid(3));await settle();
  assert.equal(outcomes.length,2);
  queue.dispose();
});

test('invalid drafts do not call native port; each queue has an isolated session',async()=>{
  const seen=[];const out=[];
  const queue=new LatestCalculationQueue('session_A',req=>{seen.push(req);return Promise.resolve(reply(req))},validate,x=>out.push(x));
  assert.equal(queue.submit({...valid(2),utcIso:'bad'}),null);
  assert.equal(seen.length,0);
  assert.equal(queue.submit(valid(1)),1);
  await settle();
  assert.equal(seen[0].sessionId,'session_A');
  assert.equal(out[0].kind,'ready');
  queue.dispose();
});


test('dispose before the first microtask does not invoke abandoned native work',async()=>{
  let invoked=0;const notified=[];
  const queue=new LatestCalculationQueue('session_1',req=>{
    invoked++;return Promise.resolve(reply(req));
  },validate,result=>notified.push(result));
  queue.submit(valid(1));
  queue.dispose();
  await settle();
  assert.equal(invoked,0);
  assert.deepEqual(notified,[]);
});

test('same-turn scrub coalesces before the first native port invocation',async()=>{
  const started=[],out=[];
  const queue=new LatestCalculationQueue('session_1',req=>{
    started.push(req);return Promise.resolve(reply(req));
  },validate,result=>out.push(result));
  for(let i=0;i<200;i++)queue.submit(valid(i));
  await settle();
  assert.equal(started.length,1);
  assert.equal(started[0].calculationKey,'fixture.199');
  assert.deepEqual(out.map(x=>x.request.requestSeq),[200]);
  queue.dispose();
});

test('stale replies never execute an expensive snapshot validator',async()=>{
  const first=deferred();let calls=0,started=0;const out=[];
  const queue=new LatestCalculationQueue('session_1',req=>{
    started++;return started===1?first.promise:Promise.resolve(reply(req));
  },v=>{calls++;return validate(v)},x=>out.push(x));
  queue.submit(valid(1));await settle();
  queue.submit(valid(2));
  first.resolve(reply({protocolVersion:1,sessionId:'session_1',requestSeq:1,...valid(1)}));
  await settle();
  assert.equal(calls,1);
  assert.deepEqual(out.map(x=>x.request.requestSeq),[2]);
  queue.dispose();
});

test('throwing snapshot validator fails closed without poisoning the next calculation',async()=>{
  const observed=[];let n=0;
  const queue=new LatestCalculationQueue('session_1',req=>Promise.resolve(reply(req)),
    () => { if(++n===1)throw new Error('private validator diagnostic');return true; },
    x=>observed.push(x));
  queue.submit(valid(1));await settle();
  queue.submit(valid(2));await settle();
  assert.deepEqual(observed.map(x=>x.kind),['invalid_reply','ready']);
  assert.equal(JSON.stringify(observed).includes('private validator diagnostic'),false);
  queue.dispose();
});
