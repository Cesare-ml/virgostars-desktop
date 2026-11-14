import test from 'node:test';
import assert from 'node:assert/strict';
import {LatestOfflineProfileReader} from '../src/app/native/offline-profile-reader.ts';
import {LatestProfileStatus} from '../src/app/native/latest-profile-status.ts';

const DENIED=Object.freeze({status:'blocked'});
const READY=Object.freeze({status:'ready'});
const assess=x=>x==='synthetic'?READY:DENIED;
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const pending=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
function scheduler(){let next=1;const callbacks=new Map();const canceled=[];return {
 timers:{schedule(cb,delay){assert.equal(delay,25);callbacks.set(next,cb);return next++},cancel(handle){canceled.push(handle);callbacks.delete(handle)}},
 fire(){for(const cb of [...callbacks.values()])cb()},size(){return callbacks.size},canceled
}}
function create(port,watch=()=>{},sched=scheduler()){
 const reader=new LatestOfflineProfileReader(new LatestProfileStatus(assess,DENIED),port,watch,{timeoutMs:25,timers:sched.timers});return {reader,sched};
}
test('a timeout blocks an unresponsive status read and aborts it',async()=>{
 const gate=pending();let signal;const events=[];
 const {reader,sched}=create(s=>{signal=s;return gate.promise},d=>events.push(d));
 reader.refresh();await settle();assert.equal(sched.size(),1);
 sched.fire();assert.equal(reader.decision,DENIED);assert.equal(signal.aborted,true);
 gate.resolve('synthetic');await settle();assert.equal(reader.decision,DENIED);
 assert.deepEqual(events,[DENIED,DENIED]);reader.dispose();
});
test('a hanging aborted read cannot release the native slot and spawn more',async()=>{
 let calls=0;const {reader,sched}=create(()=>{calls++;return new Promise(()=>{})});
 reader.refresh();await settle();sched.fire();
 for(let i=0;i<1000;i++)reader.refresh();await settle();
 assert.equal(calls,1);assert.equal(reader.decision,DENIED);reader.dispose();
});
test('normal completion clears timer and never emits timeout failure later',async()=>{
 const {reader,sched}=create(async()=> 'synthetic');reader.refresh();await settle();
 assert.equal(reader.decision,READY);assert.equal(sched.size(),0);
 sched.fire();assert.equal(reader.decision,READY);reader.dispose();
});
test('pending read starts only after timed-out native read really settles',async()=>{
 const old=pending(),later=pending(),signals=[];let calls=0;
 const {reader,sched}=create(s=>{signals.push(s);return ++calls===1?old.promise:later.promise});
 reader.refresh();await settle();sched.fire();reader.refresh();await settle();
 assert.equal(calls,1);old.resolve('synthetic');await settle();assert.equal(calls,2);
 assert.equal(reader.decision,DENIED);later.resolve('synthetic');await settle();
 assert.equal(reader.decision,READY);reader.dispose();
});
test('supersession cancels timer and ignores its obsolete callback',async()=>{
 const old=pending(),later=pending();let calls=0;
 const {reader,sched}=create(()=>++calls===1?old.promise:later.promise);
 reader.refresh();await settle();const prev=[...sched.canceled];
 reader.refresh();assert.equal(sched.size(),0);assert.equal(sched.canceled.length,prev.length+1);
 old.resolve('synthetic');await settle();assert.equal(calls,2);
 later.resolve('synthetic');await settle();assert.equal(reader.decision,READY);reader.dispose();
});
test('logout and dispose cancel outstanding timer and suppress late success',async()=>{
 const old=pending();let signal;const {reader,sched}=create(s=>{signal=s;return old.promise});
 reader.refresh();await settle();reader.invalidate();assert.equal(sched.size(),0);
 assert.equal(signal.aborted,true);old.resolve('synthetic');await settle();
 assert.equal(reader.decision,DENIED);reader.dispose();assert.equal(sched.size(),0);
});
test('dispose before first microtask does not create a timer or issue port request',async()=>{
 let reads=0;const {reader,sched}=create(()=>{reads++;return Promise.resolve('synthetic')});
 reader.refresh();reader.dispose();await settle();assert.equal(reads,0);assert.equal(sched.size(),0);
});
test('invalid timeout is rejected without invoking any native port',()=>{
 for(const timeoutMs of [0,-1,30001,NaN,Infinity,1.5,'100']){
  assert.throws(()=>new LatestOfflineProfileReader(new LatestProfileStatus(assess,DENIED),()=>Promise.resolve(null),()=>{},{timeoutMs}),/Invalid profile status timeout/);
 }
});
test('timer scheduling failure blocks UI and never invokes native port',async()=>{
 let reads=0;
 const {reader}=create(()=>{reads++;return Promise.resolve('synthetic')},()=>{},
  {timers:{schedule(){throw Error('private path')},cancel(){}}});
 reader.refresh();await settle();assert.equal(reader.decision,DENIED);
 assert.equal(reads,0);reader.dispose();
});
test('synchronously firing scheduler never invokes native port',async()=>{
 let reads=0,cancel=0;
 const {reader}=create(()=>{reads++;return Promise.resolve('synthetic')},()=>{},
  {timers:{schedule(cb){cb();return 37},cancel(h){assert.equal(h,37);cancel++}}});
 reader.refresh();await settle();assert.equal(reader.decision,DENIED);
 assert.equal(reads,0);assert.equal(cancel,1);reader.dispose();
});
test('null timer handle fails closed and skips port invocation',async()=>{
 let reads=0;
 const {reader}=create(()=>{reads++;return Promise.resolve('synthetic')},()=>{},
  {timers:{schedule(){return null},cancel(){}}});
 reader.refresh();await settle();assert.equal(reader.decision,DENIED);assert.equal(reads,0);
 reader.dispose();
});
test('throwing timer cancellation does not interrupt logout and invalidation',async()=>{
 const gate=pending();let signal;
 const {reader,sched}=create(s=>{signal=s;return gate.promise},()=>{},
  {timers:{schedule(){return 25},cancel(){throw Error('internal path')}}});
 reader.refresh();await settle();reader.invalidate();assert.equal(signal.aborted,true);
 gate.resolve('synthetic');await settle();assert.equal(reader.decision,DENIED);
 reader.dispose();
});
test('10k refreshes continue to coalesce despite deadline support',async()=>{
 const a=pending(),b=pending();let calls=0;const {reader,sched}=create(()=>++calls===1?a.promise:b.promise);
 reader.refresh();await settle();for(let i=0;i<10000;i++)reader.refresh();
 assert.equal(calls,1);assert.equal(sched.size(),0);
 a.resolve('synthetic');await settle();assert.equal(calls,2);
 b.resolve('synthetic');await settle();assert.equal(reader.decision,READY);reader.dispose();
});
