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


test('calculation draft getters are read only once and queued values match validated values',async()=>{
  const original=valid(42), reads={};
  const input=Object.create(null);
  for(const [field,value] of Object.entries(original)) {
    Object.defineProperty(input,field,{enumerable:true,get(){
      reads[field]=(reads[field]??0)+1;
      return reads[field]===1?value:'changed-after-validation';
    }});
  }
  const started=[],observed=[];
  const queue=new LatestCalculationQueue('session_1',req=>{
    started.push(req);return Promise.resolve(reply(req));
  },validate,x=>observed.push(x));
  assert.equal(queue.submit(input),1);
  await settle();
  assert.deepEqual(Object.values(reads),Array(6).fill(1));
  assert.equal(started.length,1);
  for(const [field,value] of Object.entries(original)) {
    assert.equal(started[0][field],value,field);
  }
  assert.deepEqual(observed.map(x=>x.kind),['ready']);
  queue.dispose();
});

test('throwing or revoked draft accessors fail closed without superseding valid work',async()=>{
  const gate=deferred(),started=[],observed=[];
  const queue=new LatestCalculationQueue('session_1',req=>{
    started.push(req);return gate.promise;
  },validate,x=>observed.push(x));
  assert.equal(queue.submit(valid(1)),1);
  await settle();
  const throwing=new Proxy(valid(2),{get(target,key){
    if(key==='timeZone')throw new Error('private UI getter diagnostic');
    return Reflect.get(target,key);
  }});
  assert.equal(validCalculationDraft(throwing),false);
  assert.equal(queue.submit(throwing),null);
  const revoked=Proxy.revocable(valid(3),{});
  revoked.revoke();
  assert.equal(validCalculationDraft(revoked.proxy),false);
  assert.equal(queue.submit(revoked.proxy),null);
  assert.equal(started.length,1);
  assert.equal(started[0].requestSeq,1);
  gate.resolve(reply(started[0]));
  await settle();
  assert.deepEqual(observed.map(x=>x.kind),['ready']);
  assert.equal(observed[0].request.requestSeq,1);
  queue.dispose();
});


test('native reply envelope and ready payload getters are consumed exactly once',()=>{
  const req={...valid(1),protocolVersion:1,sessionId:'session_1',requestSeq:1};
  const expected=reply(req),reads=Object.create(null),mutable={};
  for(const [field,value] of Object.entries(expected)) {
    Object.defineProperty(mutable,field,{enumerable:true,get(){
      reads[field]=(reads[field]??0)+1;
      if(reads[field]===1)return value;
      throw new Error('second IPC field read');
    }});
  }
  const decoded=decodeCalculationReply(mutable,req,validate);
  assert.equal(decoded.kind,'ready');
  assert.equal(decoded.providerVersion,'fake-test-port-v1');
  assert.equal(decoded.value,expected.snapshot);
  for(const field of Object.keys(expected))assert.equal(reads[field],1,field);
});

test('unavailable replies do not inspect attached native payload or providerVersion',()=>{
  const req={...valid(1),protocolVersion:1,sessionId:'session_1',requestSeq:1};
  for(const status of ['unavailable','unsupported']) {
    const raw={...reply(req),status};
    Object.defineProperties(raw,{
      snapshot:{get(){throw new Error('payload must not be read')}},
      providerVersion:{get(){throw new Error('version must not be read')}},
    });
    let validationCount=0;
    const result=decodeCalculationReply(raw,req,()=>{validationCount++;return true});
    assert.deepEqual(result,{kind:status,request:req});
    assert.equal(validationCount,0);
  }
});

test('throwing, revoked or mutable IPC replies fail closed without leaking details',()=>{
  const req={...valid(1),protocolVersion:1,sessionId:'session_1',requestSeq:1};
  const broken={...reply(req)};
  Object.defineProperty(broken,'requestSeq',{get(){throw new Error('private IPC failure')}});
  const badSnapshot={...reply(req)};
  Object.defineProperty(badSnapshot,'snapshot',{get(){throw new Error('private snapshot failure')}});
  const revoked=Proxy.revocable(reply(req),{});
  revoked.revoke();
  for(const raw of [broken,badSnapshot,revoked.proxy]) {
    assert.deepEqual(decodeCalculationReply(raw,req,validate),{kind:'invalid_reply',request:req});
  }
  assert.deepEqual(decodeCalculationReply(reply(req),req,()=>{
    throw new Error('private validator failure');
  }),{kind:'invalid_reply',request:req});
});

test('queue recovers when a native reply field throws during decoding',async()=>{
  let calls=0;
  const observed=[];
  const queue=new LatestCalculationQueue('session_1',req=>{
    calls++;
    if(calls===1) {
      const broken=reply(req);
      Object.defineProperty(broken,'status',{get(){throw new Error('native secret')}});
      return Promise.resolve(broken);
    }
    return Promise.resolve(reply(req));
  },validate,output=>observed.push(output));
  queue.submit(valid(1));await settle();
  queue.submit(valid(2));await settle();
  assert.deepEqual(observed.map(v=>v.kind),['invalid_reply','ready']);
  assert.equal(JSON.stringify(observed).includes('native secret'),false);
  queue.dispose();
});


test('validated request is immutable through native provider and observer boundaries',async()=>{
  const received=[];
  const queue=new LatestCalculationQueue('session_1',request=>{
    assert.equal(Object.isFrozen(request),true);
    assert.throws(()=>{request.requestSeq=5000},TypeError);
    assert.throws(()=>{request.calculationKey='forged'},TypeError);
    assert.throws(()=>{delete request.sessionId},TypeError);
    return Promise.resolve(reply(request));
  },validate,outcome=>received.push(outcome));
  assert.equal(queue.submit(valid(1)),1);
  await settle();
  assert.deepEqual(received.map(x=>x.kind),['ready']);
  assert.equal(received[0].request.requestSeq,1);
  assert.equal(received[0].request.calculationKey,'fixture.1');
  assert.equal(Object.isFrozen(received[0].request),true);
  queue.dispose();
});

test('pending request remains frozen and detached from later UI draft edits',async()=>{
  const gate=deferred(),started=[],received=[];
  const queue=new LatestCalculationQueue('session_1',request=>{
    started.push(request);
    assert.equal(Object.isFrozen(request),true);
    return started.length===1?gate.promise:Promise.resolve(reply(request));
  },validate,outcome=>received.push(outcome));
  queue.submit(valid(1));await settle();
  const mutableDraft=valid(2);
  assert.equal(queue.submit(mutableDraft),2);
  mutableDraft.calculationKey='modified.by.ui';
  mutableDraft.timeZone='Not/AZone';
  gate.resolve(reply(started[0]));
  await settle();
  assert.equal(started.length,2);
  assert.equal(started[1].calculationKey,'fixture.2');
  assert.equal(started[1].timeZone,'Europe/Rome');
  assert.equal(started[1].requestSeq,2);
  assert.deepEqual(received.map(x=>x.kind),['ready']);
  queue.dispose();
});

test('provider mutation attempt fails safely and does not poison later valid work',async()=>{
  let count=0;const observed=[];
  const queue=new LatestCalculationQueue('session_1',request=>{
    if(++count===1)request.calculationKey='corrupt';
    return Promise.resolve(reply(request));
  },validate,outcome=>observed.push(outcome));
  queue.submit(valid(1));await settle();
  assert.equal(observed[0].kind,'transport_error');
  assert.equal(observed[0].request.calculationKey,'fixture.1');
  queue.submit(valid(2));await settle();
  assert.deepEqual(observed.map(x=>x.kind),['transport_error','ready']);
  assert.equal(observed[1].request.calculationKey,'fixture.2');
  queue.dispose();
});
