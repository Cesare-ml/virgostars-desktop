import test from 'node:test';
import assert from 'node:assert/strict';
import {requestSynods} from '../src/app/native/synod-events-contract.ts';
const instant = Date.parse('2026-11-18T12:00:00.000Z');
const record = {body:'Moon', startMillis:instant-86_400_000, phase:'CRESC1', phaseStatus:'derived_from_recorded_thresholds'};
const reply = {protocolVersion:1,status:'ok',records:[record]};
const port = response => ({isNative:()=>true, invoke:async (command,args) => {
  assert.equal(command,'synod_events'); assert.equal(args.request.utcMicros,instant*1000); return response;
}});

test('recorded synods pass through the versioned local protocol',async () => {
  assert.deepEqual(await requestSynods(port(reply),instant),{kind:'ready',records:[{...record,phaseStartsMillis:null}]});
  assert.equal((await requestSynods(port({...reply,records:[{...record,startMillis:null,phase:null,phaseStatus:null}]}),instant)).kind,'ready');
});
test('phase boundaries must be ordered and start at the recorded cycle',async () => {
  const starts=[record.startMillis,record.startMillis+1000,record.startMillis+2000,record.startMillis+3000];
  assert.deepEqual((await requestSynods(port({...reply,records:[{...record,phaseStartsMillis:starts}]}),instant)).records[0].phaseStartsMillis,starts);
  assert.equal((await requestSynods(port({...reply,records:[{...record,phaseStartsMillis:[starts[0],starts[2],starts[1],starts[3]]}]}),instant)).kind,'unavailable');
});
test('browser and invalid inputs never invoke the host',async () => {
  const browser={isNative:()=>false,invoke:()=>{throw Error('unexpected');}};
  assert.deepEqual(await requestSynods(browser,instant),{kind:'not_native'});
  assert.deepEqual(await requestSynods(browser,NaN),{kind:'invalid_request'});
});
test('historical and future dates pass exact microseconds to the host',async()=>{
  for(const iso of ['0800-01-01T00:00:00.000Z','2200-01-01T00:00:00.000Z']) {
    const ms=Date.parse(iso);
    const transport={isNative:()=>true,invoke:async (_command,{request})=>{
      assert.equal(BigInt(request.utcMicros),BigInt(ms)*1000n);
      return {protocolVersion:1,status:'ok',records:[]};
    }};
    assert.equal((await requestSynods(transport,ms)).kind,'ready');
  }
  const never={isNative:()=>{throw Error('unexpected');},invoke:()=>{throw Error('unexpected');}};
  assert.equal((await requestSynods(never,Date.parse('3001-01-01T00:00:00.000Z'))).kind,'invalid_request');
});
test('bad archives, future records, duplicate bodies and malformed IPC fail closed',async () => {
  assert.equal((await requestSynods(port({...reply,status:'archive_invalid',records:[]}),instant)).kind,'archive_invalid');
  for(const data of [null, {...reply,protocolVersion:2}, {...reply,records:[record,record]},
    {...reply,records:[{...record,startMillis:instant+1}]}, {...reply,records:[{...record,phase:'bad phase'}]}]) {
    assert.equal((await requestSynods(port(data),instant)).kind,'unavailable');
  }
});
