import test from 'node:test';
import assert from 'node:assert/strict';
import {LatestCalculationQueue} from '../src/app/native/calculation-queue.ts';
import {resolveCivilTime} from '../src/app/native/civil-time.ts';
import {selectCivilInstant} from '../src/app/native/civil-time-choice.ts';
import {replaceCivilCalculation} from '../src/app/native/civil-calculation-dispatch.ts';

// A fictional, unavailable-only provider. Never promote any sky snapshot.
const civil = (date='2026-01-15', time='08:05') => ({date,time,timeZone:'Europe/Rome'});
const location = () => ({latMicro:43_769_560,lngMicro:11_255_810});
const select = (input, chosen) => selectCivilInstant(input,resolveCivilTime,chosen);
const unavailable = request => ({
  protocolVersion:1,sessionId:request.sessionId,requestSeq:request.requestSeq,
  calculationKey:request.calculationKey,status:'unavailable',
});
const settle = () => new Promise(resolve=>setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(yes=>{resolve=yes;});
  return {promise,resolve};
}
function make(port=async req=>unavailable(req)) {
  const outcomes=[];
  const queue=new LatestCalculationQueue('fictional_session',port,()=>false,
    outcome=>outcomes.push({kind:outcome.kind,seq:outcome.request.requestSeq}));
  const send=(input,chosen=null,where=location(),key='opaque.fictional.1')=>
    replaceCivilCalculation(input,select,where,key,queue,chosen);
  return {queue,outcomes,send};
}

test('one selected winter time reaches the actual latest-only scheduler, but emits unavailable',async()=>{
  const seen=[];
  const h=make(async req=>{seen.push(req);return unavailable(req);});
  const result=h.send(civil());
  assert.equal(result.status,'submitted');
  await settle();
  assert.equal(seen.length,1);
  assert.deepEqual([seen[0].protocolVersion,seen[0].intent,seen[0].utcIso],
    [1,'committed','2026-01-15T07:05:00.000Z']);
  assert.deepEqual(h.outcomes,[{kind:'unavailable',seq:1}]);
  h.queue.dispose();
});

test('a new nonexistent civil hour aborts an older in-flight valid request',async()=>{
  const gate=deferred(),seen=[],aborted=[];
  const h=make((req,signal)=>{seen.push(req);aborted.push(signal);return gate.promise;});
  assert.equal(h.send(civil()).status,'submitted');
  await settle();
  const rejected=h.send(civil('2026-03-29','02:30'));
  assert.equal(rejected.status,'nonexistent');
  assert.equal(aborted[0].aborted,true);
  gate.resolve(unavailable(seen[0]));
  await settle();
  assert.deepEqual(h.outcomes,[]);
  h.queue.dispose();
});

test('an ambiguous DST fold retires prior work and only an explicit choice may submit',async()=>{
  const seen=[];
  const h=make(async req=>{seen.push(req);return unavailable(req);});
  h.send(civil());
  const fold=civil('2026-10-25','02:30');
  const unresolved=h.send(fold);
  assert.equal(unresolved.status,'choice_required');
  assert.equal(unresolved.choices.length,2);
  const chosen=h.send(fold,unresolved.choices[1].instantUtc);
  assert.equal(chosen.status,'submitted');
  await settle();
  await settle();
  assert.equal(seen.length,1);
  assert.equal(seen[0].utcIso,'2026-10-25T01:30:00.000Z');
  assert.deepEqual(h.outcomes,[{kind:'unavailable',seq:2}]);
  h.queue.dispose();
});

test('invalid coordinates after a valid request invalidate its obsolete pending result',async()=>{
  const gate=deferred(),seen=[];
  const h=make(async req=>{seen.push(req);return gate.promise;});
  h.send(civil());
  await settle();
  const bad={get latMicro(){throw Error('private location');},lngMicro:0};
  assert.deepEqual(h.send(civil(),null,bad),{status:'location_invalid'});
  gate.resolve(unavailable(seen[0]));
  await settle();
  assert.deepEqual(h.outcomes,[]);
  h.queue.dispose();
});

test('30 same-turn civil changes produce only the latest request in actual queue',async()=>{
  const seen=[];
  const h=make(async req=>{seen.push(req);return unavailable(req);});
  for(let i=0;i<30;i++) {
    const v=h.send(civil('2026-01-15',String(8+i%5).padStart(2,'0')+':05'),null,location(),`opaque.fixture.${i}`);
    assert.equal(v.status,'submitted');
  }
  await settle();await settle();
  assert.equal(seen.length,1);
  assert.equal(seen[0].calculationKey,'opaque.fixture.29');
  assert.deepEqual(h.outcomes,[{kind:'unavailable',seq:30}]);
  h.queue.dispose();
});

test('invalidation failures return sanitized unavailable state without submitting',()=>{
  let submissions=0;
  const queue={invalidate(){throw Error('private internal state');},submit(){submissions++;return 1;}};
  assert.deepEqual(replaceCivilCalculation(civil(),select,location(),'opaque.fictional.1',queue),
    {status:'queue_unavailable'});
  assert.equal(submissions,0);
  assert.deepEqual(replaceCivilCalculation(civil(),select,location(),'opaque.fictional.1',null),
    {status:'queue_unavailable'});
});

test('disposed queue declines replacement and does not invoke the synthetic port',async()=>{
  let invoked=0;
  const h=make(async req=>{invoked++;return unavailable(req);});
  h.queue.dispose();
  assert.deepEqual(h.send(civil()),{status:'queue_unavailable'});
  await settle();
  assert.equal(invoked,0);
  assert.deepEqual(h.outcomes,[]);
});
