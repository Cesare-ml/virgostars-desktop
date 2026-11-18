import test from 'node:test';
import assert from 'node:assert/strict';
import {requestConflicts} from '../src/app/native/group-conflicts-contract.ts';

const attemptId='123e4567-e89b-42d3-a456-426614174000';
const item={chartId:'11111111-1111-4111-8111-111111111111',chartName:'Fittizio',localGroups:['Locale'],serverGroups:['Web']};
const operation={operation:'list',attemptId};
const native=reply=>({isNative:()=>true,invoke:async()=>reply});

test('lists conflict values with no account identifiers',async()=>{
  const reply={protocolVersion:1,status:'ok',conflicts:[item]};
  const result=await requestConflicts(native(reply),operation);
  assert.deepEqual(result,{kind:'ok',conflicts:[item]});
  assert.ok(Object.isFrozen(result.conflicts[0]));
  assert.ok(Object.isFrozen(result.conflicts[0].localGroups));
});

test('resolution sends exactly the versions shown to the user',async()=>{
  let observed;
  const port={isNative:()=>true,invoke:async(command,args)=>{observed={command,args};return {protocolVersion:1,status:'resolved'};}};
  assert.deepEqual(await requestConflicts(port,{operation:'resolve',attemptId,conflict:item,choice:'local'}),{kind:'resolved'});
  assert.deepEqual(observed,{command:'desktop_group_conflicts_v1',args:{request:{protocolVersion:1,operation:'resolve',attemptId,
    chartId:item.chartId,localGroups:item.localGroups,serverGroups:item.serverGroups,choice:'local'}}});
  assert.deepEqual(await requestConflicts(native({protocolVersion:1,status:'stale'}),{operation:'resolve',attemptId,conflict:item,choice:'server'}),{kind:'stale'});
});

test('rejects duplicate charts, unsafe groups and extra native fields',async()=>{
  for(const bad of [
    {protocolVersion:1,status:'ok',conflicts:[item,item]},
    {protocolVersion:1,status:'ok',conflicts:[{...item,localGroups:['x','x']}]},
    {protocolVersion:1,status:'ok',conflicts:[{...item,serverGroups:['secret\nvalue']}]},
    {protocolVersion:1,status:'ok',conflicts:[{...item,profileRef:'not allowed'}]},
    {protocolVersion:1,status:'ok',conflicts:[item],accessToken:'not allowed'},
  ]) assert.deepEqual(await requestConflicts(native(bad),operation),{kind:'unavailable'});
});
