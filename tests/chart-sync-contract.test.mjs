import test from 'node:test';
import assert from 'node:assert/strict';
import {requestChartSync} from '../src/app/native/chart-sync-contract.ts';

const attemptId='123e4567-e89b-42d3-a456-426614174000';
const item={id:'11111111-1111-4111-8111-111111111111',name:'Persona fittizia',civilDate:'1984-03-25',
  civilTime:null,timeUnknown:true,timeZone:'Europe/Rome',latMicro:44000000,lngMicro:11000000,
  placeName:'Luogo fittizio',groups:['Gruppo'],syncStatus:'clean',sourceUpdatedAtMs:1000};
const native=reply=>({isNative:()=>true,invoke:async()=>reply});

test('keeps an unknown birth time explicitly null on imported charts',async()=>{
  const result=await requestChartSync(native({protocolVersion:1,status:'ok',charts:[item]}),{operation:'list',attemptId});
  assert.equal(result.kind,'list');
  assert.equal(result.charts[0].timeUnknown,true);
  assert.equal(result.charts[0].civilTime,null);
  assert.equal(Object.hasOwn(result.charts[0],'utcIso'),false);
  assert.ok(Object.isFrozen(result.charts[0]));
});

test('rejects impossible dates, fabricated time and unexpected personal fields',async()=>{
  for(const change of [{civilDate:'1984-02-30'}, {civilTime:'00:00:00'}, {utcIso:'1984-03-25T00:00:00Z'},
    {latMicro:null}, {groups:['dup','dup']}, {syncStatus:'unknown'}]) {
    const result=await requestChartSync(native({protocolVersion:1,status:'ok',charts:[{...item,...change}]}),{operation:'list',attemptId});
    assert.deepEqual(result,{kind:'unavailable'});
  }
});

test('group edits send local identity and bounded data only',async()=>{
  let sent;
  const port={isNative:()=>true,invoke:async(command,args)=>{sent={command,args};return {protocolVersion:1,status:'ok'};}};
  const result=await requestChartSync(port,{operation:'set_groups',attemptId,chartId:item.id,baseGroups:item.groups,groups:['Locale']});
  assert.deepEqual(result,{kind:'saved'});
  assert.deepEqual(sent,{command:'desktop_chart_sync_v1',args:{request:{protocolVersion:1,operation:'set_groups',attemptId,chartId:item.id,baseGroups:item.groups,groups:['Locale']}}});
  assert.deepEqual(await requestChartSync(native({protocolVersion:1,status:'ok',summary:{imported:1,updated:0,alreadyLinked:0,uploaded:0,conflicts:0}}),{operation:'sync',attemptId}),
    {kind:'sync',imported:1,updated:0,alreadyLinked:0,uploaded:0,conflicts:0});
});

test('offline access never accepts a profile selector or invents a login',async()=>{
  let sent;
  const port={isNative:()=>true,invoke:async(command,args)=>{sent={command,args};return {protocolVersion:1,status:'ok',charts:[item]};}};
  const result=await requestChartSync(port,{operation:'offline_list'});
  assert.equal(result.kind,'list');
  assert.deepEqual(sent,{command:'desktop_chart_sync_v1',args:{request:{protocolVersion:1,operation:'offline_list'}}});
});

test('explicit association transmits both displayed versions and rejects a bad local id',async()=>{
  let sent;
  const port={isNative:()=>true,invoke:async(command,args)=>{sent=args.request;return {protocolVersion:1,status:'ok'};}};
  const operation={operation:'associate',attemptId,chartId:item.id,localChartId:'22222222-2222-4222-8222-222222222222',localUpdatedAtMs:2000,sourceUpdatedAtMs:1000,baseGroups:item.groups,groups:['Locale']};
  assert.deepEqual(await requestChartSync(port,operation),{kind:'saved'});
  assert.deepEqual(sent,{protocolVersion:1,...operation});
  assert.deepEqual(await requestChartSync(port,{...operation,localChartId:item.id}),{kind:'unavailable'});
  assert.deepEqual(await requestChartSync(native({protocolVersion:1,status:'stale'}),operation),{kind:'stale'});
});
