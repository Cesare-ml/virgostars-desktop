import test from 'node:test';
import assert from 'node:assert/strict';
import {LatestOfflineProfileReader} from '../src/app/native/offline-profile-reader.ts';
import {LatestProfileStatus} from '../src/app/native/latest-profile-status.ts';

const BLOCKED=Object.freeze({status:'invalid_evidence',canReadLocal:false});
const READY=Object.freeze({status:'ready_offline',canReadLocal:true});
const assess=evidence=>evidence==='synthetic'?READY:BLOCKED;
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function create(port,listener=()=>{}) {
  return new LatestOfflineProfileReader(new LatestProfileStatus(assess,BLOCKED),port,listener);
}

test('observer-triggered lock delivers final blocked state without recursion',async()=>{
  const statuses=[];
  let reader;
  reader=create(async()=> 'synthetic',value=>{
    statuses.push(value.status);
    if(value===READY) reader.invalidate();
  });
  assert.equal(reader.refresh(),true);
  await settle();
  assert.deepEqual(statuses,['invalid_evidence','ready_offline','invalid_evidence']);
  assert.equal(reader.decision,BLOCKED);
  reader.dispose();
});

test('pathological observer invalidation is capped and cannot exhaust stack',()=>{
  let callbacks=0,reader;
  reader=create(async()=> 'synthetic',()=>{callbacks++;reader.invalidate()});
  reader.refresh();
  assert.equal(callbacks,2);
  assert.equal(reader.decision,BLOCKED);
  reader.dispose();
  assert.equal(callbacks,3);
});

test('observer disposal during status refresh does not revive a profile',async()=>{
  const events=[];let reader;
  reader=create(async()=> 'synthetic',value=>{
    events.push(value.status);
    if(events.length===1)reader.dispose();
  });
  reader.refresh();await settle();
  assert.deepEqual(events,['invalid_evidence','invalid_evidence']);
  assert.equal(reader.decision,BLOCKED);
  assert.equal(reader.refresh(),false);
});

test('subscriber exception remains contained even when it triggers nested lock',()=>{
  let calls=0,reader;
  reader=create(async()=> 'synthetic',()=>{
    calls++;if(calls===1){reader.invalidate();throw Error('private error');}
  });
  assert.equal(reader.refresh(),true);
  assert.equal(calls,2);
  assert.equal(reader.decision,BLOCKED);
  reader.dispose();
});

test('ordinary status refresh notifies blocked then ready exactly once each',async()=>{
  const states=[];
  const reader=create(async()=> 'synthetic',state=>states.push(state));
  reader.refresh();await settle();
  assert.deepEqual(states,[BLOCKED,READY]);
  reader.dispose();
});
