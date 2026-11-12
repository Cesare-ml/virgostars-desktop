import test from 'node:test';
import assert from 'node:assert/strict';
import {SyntheticIpcBenchmark} from '../src/app/native/synthetic-ipc-benchmark.ts';
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
const plan={samples:4,iterations:10,seed:17};
function setup(){
  let now=0;
  const requests=[];
  const time={now:()=>now};
  const transport={calculate:r=>new Promise((resolve,reject)=>requests.push({r,resolve,reject}))};
  const bench=new SyntheticIpcBenchmark(transport,time);
  return {bench,requests,add:n=>now+=n};
}
function result(request,ms=1500){return {...request,result:{syntheticOnly:true,fixtureKind:'synthetic_ipc_probe',workerMicros:ms,checksumHex:'140c74bc',iterations:request.input.iterations}};}
test('sequential four native round-trips capture exact latency percentiles',async()=>{
 const h=setup();const progress=[];const pending=h.bench.run(plan,(done,total)=>progress.push([done,total]));
 for(let i=0;i<4;i++){
  await flush();assert.equal(h.requests.length,i+1);
  h.add((i+1)*10);const request=h.requests[i];request.resolve(result(request.r,(i+1)*1000));
 }
 await flush();const report=await pending;
 assert.equal(report.status,'completed');assert.equal(report.completed,4);
 assert.deepEqual(progress,[[1,4],[2,4],[3,4],[4,4]]);
 assert.deepEqual(report.roundTripMs,{p50:20,p95:40,p99:40});
 assert.deepEqual(report.workerMs,{p50:2,p95:4,p99:4});
 assert.equal(report.lastChecksum,'140c74bc');
 assert.equal(h.bench.running,false);
});
test('only one native probe runs at a time even before response settles',async()=>{
 const h=setup();const pending=h.bench.run({samples:64,iterations:1,seed:0});
 await flush();assert.equal(h.requests.length,1);
 await flush();assert.equal(h.requests.length,1);
 h.bench.stop();h.requests[0].resolve(result(h.requests[0].r));assert.equal((await pending).status,'cancelled');
});
test('stop waits for bounded native completion and ignores its reply',async()=>{
 const h=setup();let updates=0;const pending=h.bench.run(plan,()=>updates++);await flush();
 h.bench.stop();h.requests[0].resolve(result(h.requests[0].r));const report=await pending;assert.equal(report.completed,0);assert.equal(report.status,'cancelled');
 await flush();assert.equal(updates,0);
 assert.equal(h.requests.length,1);
});
test('a native error finishes failed with no fake success',async()=>{
 const h=setup();const pending=h.bench.run(plan);await flush();h.requests[0].reject(new Error('path: do not show'));await flush();
 const report=await pending;assert.equal(report.status,'failed');assert.equal(report.completed,0);
 assert.equal(report.roundTripMs.p50,null);
});
test('invalid plans never start work',async()=>{
 const h=setup();for(const invalid of [
  {...plan,samples:0},{...plan,samples:65},{...plan,iterations:0},
  {...plan,iterations:200001},{...plan,seed:-1},{...plan,seed:2**32},
  {...plan,samples:1.5},
 ])await assert.rejects(h.bench.run(invalid),/BENCHMARK_INVALID_PLAN/);
 assert.equal(h.requests.length,0);
});
test('duplicate concurrent runs fail closed',async()=>{
 const h=setup();const pending=h.bench.run(plan);
 await assert.rejects(h.bench.run(plan),/BENCHMARK_RUNNING/);
 h.bench.dispose();await flush();h.requests[0].resolve(result(h.requests[0].r));assert.equal((await pending).status,'cancelled');
});
test('start again after cancelled run never mixes previous results',async()=>{
 const h=setup();const first=h.bench.run({samples:1,iterations:5,seed:1});await flush();h.bench.stop();h.requests[0].resolve(result(h.requests[0].r));await first;
 const second=h.bench.run({samples:1,iterations:7,seed:2});await flush();
 assert.equal(h.requests.length,2);
 h.requests[0].resolve(result(h.requests[0].r));await flush();
 assert.equal(h.bench.running,true);
 h.requests[1].resolve(result(h.requests[1].r));await flush();
 assert.equal((await second).lastChecksum,'140c74bc');
});
test('progress observer exception never wedges the queue',async()=>{
 const h=setup();const p=h.bench.run({samples:2,iterations:10,seed:17},()=>{throw Error('UI broke')});
 await flush();h.requests[0].resolve(result(h.requests[0].r));await flush();
 h.requests[1].resolve(result(h.requests[1].r));await flush();
 assert.equal((await p).status,'completed');
});
