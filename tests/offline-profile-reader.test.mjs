import test from 'node:test';
import assert from 'node:assert/strict';
import {LatestOfflineProfileReader} from '../src/app/native/offline-profile-reader.ts';
import {LatestProfileStatus} from '../src/app/native/latest-profile-status.ts';

const DENIED=Object.freeze({status:'invalid_evidence',canReadLocal:false});
const READY=Object.freeze({status:'ready_offline',canReadLocal:true});
const assess=value=>value==='synthetic-only-ready'?READY:DENIED;
const create=(read,changed)=>new LatestOfflineProfileReader(new LatestProfileStatus(assess,DENIED),read,changed);
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};}

test('initial and pending status are always blocked, then valid synthetic status can be presented',async()=>{
  const notifications=[];
  const reader=create(async()=> 'synthetic-only-ready',v=>notifications.push(v));
  assert.equal(reader.decision,DENIED);
  assert.equal(reader.refresh(),true);
  assert.equal(reader.decision,DENIED);
  await settle();
  assert.equal(reader.decision,READY);
  assert.deepEqual(notifications,[DENIED,READY]);
  reader.dispose();
});

test('ten thousand updates retain only first active and final pending port call',async()=>{
  const first=deferred(),second=deferred(),calls=[],notified=[];
  const reader=create(signal=>{calls.push(signal);return calls.length===1?first.promise:second.promise},v=>notified.push(v));
  reader.refresh();await settle();
  for(let i=0;i<10000;i++)reader.refresh();
  assert.equal(calls.length,1);
  assert.equal(calls[0].aborted,true);
  first.resolve('synthetic-only-ready');await settle();
  assert.equal(calls.length,2);
  assert.equal(reader.decision,DENIED);
  second.resolve('synthetic-only-ready');await settle();
  assert.equal(reader.decision,READY);
  assert.equal(notified.filter(x=>x===READY).length,1);
  reader.dispose();
});

test('same-turn rapid refresh does not start abandoned reads',async()=>{
  let calls=0;
  const reader=create(async()=>{calls++;return 'synthetic-only-ready'});
  for(let i=0;i<200;i++)reader.refresh();
  await settle();
  assert.equal(calls,1);
  assert.equal(reader.decision,READY);
  reader.dispose();
});

test('aborted port that ignores cancellation cannot publish success',async()=>{
  const first=deferred(),second=deferred();let calls=0;
  const reader=create(()=>++calls===1?first.promise:second.promise);
  reader.refresh();await settle();reader.refresh();
  first.resolve('synthetic-only-ready');await settle();
  assert.equal(reader.decision,DENIED);
  second.resolve(null);await settle();
  assert.equal(reader.decision,DENIED);
  reader.dispose();
});

test('logout invalidates the active read before a late ready result',async()=>{
  const first=deferred();let signal;
  const reader=create(s=>{signal=s;return first.promise});
  reader.refresh();await settle();
  reader.invalidate();
  assert.equal(signal.aborted,true);
  first.resolve('synthetic-only-ready');await settle();
  assert.equal(reader.decision,DENIED);
  reader.dispose();
});

test('logout abandons pending refresh instead of running it on a new profile',async()=>{
  const first=deferred();let calls=0;
  const reader=create(()=>{calls++;return first.promise});
  reader.refresh();await settle();reader.refresh();reader.invalidate();
  first.resolve('synthetic-only-ready');await settle();
  assert.equal(calls,1);
  assert.equal(reader.decision,DENIED);
  reader.dispose();
});

test('dispose before microtask prevents any native status read',async()=>{
  let calls=0;const reader=create(async()=>{calls++;return 'synthetic-only-ready'});
  reader.refresh();reader.dispose();await settle();
  assert.equal(calls,0);
  assert.equal(reader.refresh(),false);
  assert.equal(reader.decision,DENIED);
});

test('rejected and malformed status replies fail closed, with later recovery',async()=>{
  let calls=0;
  const reader=create(()=>{
    if(++calls===1) return Promise.reject(new Error('private diagnostics'));
    if(calls===2) return Promise.resolve({secret:'synthetic'});
    return Promise.resolve('synthetic-only-ready');
  });
  reader.refresh();await settle();assert.equal(reader.decision,DENIED);
  reader.refresh();await settle();assert.equal(reader.decision,DENIED);
  reader.refresh();await settle();assert.equal(reader.decision,READY);
  reader.dispose();
});

test('subscriber exception cannot prevent a later valid read',async()=>{
  let calls=0;
  const reader=create(async()=>{calls++;return 'synthetic-only-ready'},()=>{throw Error('UI failed')});
  reader.refresh();await settle();
  assert.equal(reader.decision,READY);
  reader.refresh();await settle();
  assert.equal(calls,2);assert.equal(reader.decision,READY);
  reader.dispose();
});

test('unsettled abort-ignoring port holds the newest pending read safely blocked',async()=>{
  let calls=0;
  const unresolved=new Promise(()=>{});
  const reader=create(()=>{calls++;return unresolved});
  reader.refresh();await settle();
  for(let i=0;i<1000;i++) reader.refresh();
  await settle();
  assert.equal(calls,1);
  assert.equal(reader.decision,DENIED);
  reader.dispose();
});

test('observer-triggered invalidation never revives an outdated ready state',async()=>{
  let reader;
  const events=[];
  reader=create(async()=> 'synthetic-only-ready', decision=>{
    events.push(decision.status);
    if(decision===READY)reader.invalidate();
  });
  reader.refresh();await settle();
  assert.deepEqual(events,['invalid_evidence','ready_offline','invalid_evidence']);
  assert.equal(reader.decision,DENIED);
  reader.dispose();
});
