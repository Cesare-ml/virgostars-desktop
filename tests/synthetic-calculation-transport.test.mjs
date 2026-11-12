import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SyntheticCalculationTransport,decodeSyntheticResponse} from '../src/app/native/synthetic-calculation-transport.ts';
const req={protocolVersion:1,sessionId:'chart-A',requestSeq:5,calculationKey:'scrub:time',input:{seed:17,iterations:100}};
const response={protocolVersion:1,sessionId:'chart-A',requestSeq:5,calculationKey:'scrub:time',result:{syntheticOnly:true,fixtureKind:'synthetic_ipc_probe',iterations:100,checksumHex:'abcdef01',workerMicros:10}};
test('mock Tauri roundtrip uses exact command and only synthetic fields',async()=>{
 let calls=0;
 const t=new SyntheticCalculationTransport({isNative:()=>true,invoke:async(command,args)=>{calls++;assert.equal(command,'synthetic_calculation_probe');assert.deepEqual(args,{request:req});return {...response,extraneous:'do-not-forward'};}});
 const out=await t.calculate(req);assert.equal(calls,1);assert.deepEqual(out,response);
});
test('browser mode fails closed before IPC invocation',async()=>{
 const t=new SyntheticCalculationTransport({isNative:()=>false,invoke:async()=>{throw Error('should never invoke');}});
 await assert.rejects(t.calculate(req),/SYNTHETIC_NOT_NATIVE/);
});
test('invalid seed and overlong work never reach Rust',async()=>{
 let calls=0;const t=new SyntheticCalculationTransport({isNative:()=>true,invoke:async()=>{calls++;return response;}});
 for(const input of [{seed:-1,iterations:100},{seed:0,iterations:200001},{seed:0,iterations:0},{seed:2**32,iterations:1},{seed:0.1,iterations:10}]) {
  await assert.rejects(t.calculate({...req,input}),/SYNTHETIC_INVALID_REQUEST/);
 }assert.equal(calls,0);
});
test('invalid session, sequence and key do not issue IPC',async()=>{
 const t=new SyntheticCalculationTransport({isNative:()=>true,invoke:async()=>{throw Error('should never invoke')}});
 for(const malformed of [{sessionId:'Jane Doe'},{sessionId:'x'.repeat(129)},{requestSeq:2**53},{requestSeq:0},{calculationKey:'hello world'}]){
  await assert.rejects(t.calculate({...req,...malformed}),/SYNTHETIC_INVALID_REQUEST/);
 }
});
test('malformed and unmarked results are rejected',()=>{
 for(const bad of [null,{},[],{...response,result:{...response.result,syntheticOnly:false}},{...response,result:{...response.result,fixtureKind:'astronomy'}},{...response,result:{...response.result,checksumHex:'bad'}},{...response,result:{...response.result,workerMicros:-1}},{...response,result:{...response.result,iterations:99}}]){
  assert.throws(()=>decodeSyntheticResponse(bad,req),/SYNTHETIC_INVALID_RESPONSE/);
 }
});
test('mismatching protocol echo or session is rejected',()=>{
 for(const update of [{protocolVersion:2},{sessionId:'other'},{requestSeq:4},{calculationKey:'other'}])assert.throws(()=>decodeSyntheticResponse({...response,...update},req),/SYNTHETIC_INVALID_RESPONSE/);
});
test('unknown response keys and planetary payload are stripped',()=>{
 const out=decodeSyntheticResponse({...response,planets:[{id:'sun'}],result:{...response.result,positions:[1,2,3]}},req);
 assert.deepEqual(out,response);assert.equal('planets' in out,false);assert.equal('positions' in out.result,false);
});
test('transport surfaces native busy as an error instead of fake completion',async()=>{
 const t=new SyntheticCalculationTransport({isNative:()=>true,invoke:async()=>{throw 'SYNTHETIC_BUSY'}});
 await assert.rejects(t.calculate(req));
});
test('Rust native synthetic command is registered with a hard limit',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 const rust=read('src-tauri/src/synthetic_calculation_probe.rs');
 const lib=read('src-tauri/src/lib.rs');
 assert.match(lib,/synthetic_calculation_probe::SyntheticProbeGate::default/);
 assert.match(lib,/synthetic_calculation_probe::synthetic_calculation_probe/);
 assert.match(rust,/MAX_ACTIVE: usize = 2/);
 assert.match(rust,/MAX_ITERATIONS: u32 = 200_000/);
 assert.match(rust,/spawn_blocking/);
 assert.match(rust,/synthetic_only: true/);
 assert.doesNotMatch(rust,/https?:\/\/|reqwest|SQLITE|planets.*:/);
});

test('cross-language synthetic checksum golden values are explicit and stable',()=>{
 const fnv=(seed,iterations)=>{
  let checksum=2_166_136_261;
  for(let i=0;i<iterations;i++){
    checksum=Math.imul(checksum ^ ((seed+i)>>>0),16_777_619)>>>0;
  }
  return checksum.toString(16).padStart(8,'0');
 };
 for(const [seed,iterations,expected] of [
  [17,1,'140c74bc'],[17,10,'fa5e06d2'],
  [17,10_000,'b9cc73d5'],[0,200_000,'4b726605']
 ]) assert.equal(fnv(seed,iterations),expected);
 const rust=readFileSync(new URL('../src-tauri/src/synthetic_calculation_probe.rs',import.meta.url),'utf8');
 for(const expected of ['140c74bc','fa5e06d2','b9cc73d5','4b726605'])assert.ok(rust.includes(expected));
});
