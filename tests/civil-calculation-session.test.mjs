import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';

// Angular uses extensionless TypeScript relative imports; Node's isolated test
// loader resolves them without modifying production TypeScript import paths.
register(new URL('./ts-relative-resolution-loader.mjs', import.meta.url), import.meta.url);
const {CivilCalculationSession} = await import('../src/app/native/civil-calculation-session.ts');

const rome = (date, time) => ({date, time, timeZone:'Europe/Rome'});
const loc = Object.freeze({latMicro:43769560,lngMicro:11255810});
const settle = () => new Promise(resolve => setImmediate(resolve));
const response = (req, status='unavailable', extras={}) => ({
  protocolVersion:1, sessionId:req.sessionId, requestSeq:req.requestSeq,
  calculationKey:req.calculationKey, status, ...extras,
});
function deferred() {
  let resolve, reject;
  const promise = new Promise((a,b) => {resolve=a;reject=b});
  return {promise, resolve, reject};
}
function harness(port) {
  const requests=[], outcomes=[];
  const s = new CivilCalculationSession('civil_fixture_1', port ?? (async req => {
    requests.push(req);
    return response(req);
  }), outcome => outcomes.push(outcome));
  return {s, requests, outcomes};
}

test('real queue dispatches selected canonical UTC to an injected unavailable native port',async()=>{
  const h=harness();
  const x=h.s.submit(rome('2026-01-15','08:05'),loc,'fixture_a');
  assert.equal(x.status,'submitted');
  assert.equal(x.selection.instantUtc,'2026-01-15T07:05:00.000Z');
  await settle();
  assert.equal(h.requests.length,1);
  assert.deepEqual(h.requests[0],{
    protocolVersion:1,sessionId:'civil_fixture_1',requestSeq:1,
    intent:'committed',utcIso:'2026-01-15T07:05:00.000Z',
    latMicro:loc.latMicro,lngMicro:loc.lngMicro,timeZone:'Europe/Rome',
    calculationKey:'fixture_a',
  });
  assert.deepEqual(h.outcomes.map(o=>o.kind),['unavailable']);
  h.s.dispose();
});

test('ambiguous autumn hour stops before actual queue dispatch',async()=>{
  const h=harness();
  const x=h.s.submit(rome('2026-10-25','02:30'),loc,'fixture_b');
  assert.equal(x.status,'choice_required');
  assert.deepEqual(x.choices.map(c=>c.instantUtc),[
    '2026-10-25T00:30:00.000Z','2026-10-25T01:30:00.000Z',
  ]);
  await settle();assert.equal(h.requests.length,0);assert.equal(h.outcomes.length,0);
  h.s.dispose();
});

test('explicit later fold choice reaches queue with the exact UTC instant',async()=>{
  const h=harness();
  const x=h.s.submit(rome('2026-10-25','02:30'),loc,'fixture_c','2026-10-25T01:30:00.000Z');
  assert.equal(x.status,'submitted');assert.equal(x.selection.offsetSeconds,3600);
  await settle();assert.equal(h.requests[0].utcIso,'2026-10-25T01:30:00.000Z');
  assert.deepEqual(h.outcomes.map(o=>o.kind),['unavailable']);
  h.s.dispose();
});

test('invalid edited local time cancels a queued request before a native call',async()=>{
  const h=harness();
  assert.equal(h.s.submit(rome('2026-01-15','08:05'),loc,'fixture_a').status,'submitted');
  assert.equal(h.s.submit(rome('2026-03-29','02:30'),loc,'fixture_b').status,'nonexistent');
  await settle();assert.equal(h.requests.length,0);assert.equal(h.outcomes.length,0);
  h.s.dispose();
});

test('input edit invalidates a running port even when it ignores the abort signal',async()=>{
  const gate=deferred(),requests=[],outcomes=[];
  const s=new CivilCalculationSession('session_delay',req=>{requests.push(req);return gate.promise},o=>outcomes.push(o));
  s.submit(rome('2026-01-15','08:05'),loc,'fixture_a');
  await settle();assert.equal(requests.length,1);
  s.invalidate();gate.resolve(response(requests[0]));
  await settle();assert.deepEqual(outcomes,[]);
  s.dispose();
});

test('200 rapid valid time updates send only the latest before first microtask',async()=>{
  const h=harness();
  for(let i=0;i<200;i++) {
    const value=String(i%60).padStart(2,'0');
    const x=h.s.submit(rome('2026-01-15','08:'+value),loc,'key_'+i);
    assert.equal(x.status,'submitted');
  }
  await settle();
  assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].requestSeq,200);
  assert.equal(h.requests[0].calculationKey,'key_199');
  assert.equal(h.requests[0].utcIso,'2026-01-15T07:19:00.000Z');
  assert.deepEqual(h.outcomes.map(o=>o.kind),['unavailable']);
  h.s.dispose();
});

test('running provider receives at most one latest pending request after supersession',async()=>{
  const gate=deferred(),started=[],outcomes=[];
  const session=new CivilCalculationSession('session_scrub',req=>{
    started.push(req);
    return started.length===1?gate.promise:Promise.resolve(response(req));
  },o=>outcomes.push(o));
  session.submit(rome('2026-01-15','08:00'),loc,'key_0');await settle();
  for(let i=1;i<=30;i++) session.submit(rome('2026-01-15','08:'+String(i).padStart(2,'0')),loc,'key_'+i);
  assert.equal(started.length,1);gate.resolve(response(started[0]));
  await settle();assert.equal(started.length,2);
  assert.equal(started[1].calculationKey,'key_30');
  assert.deepEqual(outcomes.map(o=>o.request.calculationKey),['key_30']);
  session.dispose();
});

test('a forged ready native snapshot is quarantined as invalid_reply',async()=>{
  const seen=[];
  const session=new CivilCalculationSession('session_quarantine',async req=>response(req,'ready',{
    providerVersion:'experimental-de441',snapshot:{scientificStatus:'validated',positions:[{body:'sun'}]},
  }),o=>seen.push(o));
  const x=session.submit(rome('2026-01-15','08:05'),loc,'key_0');
  assert.equal(x.status,'submitted');await settle();
  assert.equal(seen.length,1);assert.equal(seen[0].kind,'invalid_reply');
  assert.equal('value' in seen[0],false);
  assert.equal(JSON.stringify(seen).includes('experimental-de441'),false);
  session.dispose();
});

test('mismatched native envelope is rejected without forwarding payload',async()=>{
  const seen=[];
  const session=new CivilCalculationSession('session_bad',async req=>({
    ...response(req),sessionId:'wrong_session',snapshot:{privateRecord:'redacted'},
  }),o=>seen.push(o));
  session.submit(rome('2026-01-15','08:05'),loc,'key_0');await settle();
  assert.deepEqual(seen.map(x=>x.kind),['invalid_reply']);
  assert.equal(JSON.stringify(seen).includes('privateRecord'),false);
  session.dispose();
});

test('native transport errors are sanitized and later submissions can recover',async()=>{
  const seen=[];let calls=0;
  const session=new CivilCalculationSession('session_recovery',async req=>{
    calls++;if(calls===1)throw Error('private kernel path');return response(req);
  },o=>seen.push(o));
  session.submit(rome('2026-01-15','08:05'),loc,'key_0');await settle();
  session.submit(rome('2026-01-15','08:06'),loc,'key_1');await settle();
  assert.deepEqual(seen.map(x=>x.kind),['transport_error','unavailable']);
  assert.equal(JSON.stringify(seen).includes('private kernel path'),false);
  session.dispose();
});

test('disposing before microtask prevents native invocation and further submissions',async()=>{
  const h=harness();
  h.s.submit(rome('2026-01-15','08:05'),loc,'key_0');
  h.s.dispose();await settle();
  assert.deepEqual(h.requests,[]);assert.deepEqual(h.outcomes,[]);
  assert.deepEqual(h.s.submit(rome('2026-01-15','08:05'),loc,'key_1'),{status:'queue_unavailable'});
  h.s.invalidate();
});

test('invalid coordinates and an expired DST selection never reach native port',async()=>{
  const h=harness();
  assert.equal(h.s.submit(rome('2026-01-15','08:05'),{latMicro:99_000_000,lngMicro:0},'key_0').status,'location_invalid');
  assert.equal(h.s.submit(rome('2026-10-25','03:30'),loc,'key_1','2026-10-25T00:30:00.000Z').status,'selection_invalid');
  await settle();assert.equal(h.requests.length,0);
  h.s.dispose();
});
