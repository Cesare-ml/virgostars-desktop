import test from 'node:test';
import assert from 'node:assert/strict';
import {packageRequest} from '../src/app/native/de441-packages-contract.ts';

const valid={status:'ok',busy:false,current:null,downloaded:0,total:0,outcome:null,
  packages:[{id:'base',firstYear:1000,lastYear:2200,bytes:100,required:true,installed:true}],planned:['history-00800-00999'],plannedBytes:42,freeBytes:1000};

test('uses only the package command and validates the returned inventory',async()=>{
  let called;
  const result=await packageRequest({invoke:async(command,args)=>{called={command,args};return valid;}},{action:'plan',firstYear:800,lastYear:999});
  assert.equal(called.command,'de441_packages');
  assert.equal(result.plannedBytes,42);
  assert.equal(result.packages[0].required,true);
});
test('refuses unsafe inputs and malformed native replies',async()=>{
  let calls=0; const port={invoke:async()=>{calls++;return {...valid,packages:[{id:'../bad'}]};}};
  assert.equal((await packageRequest(port,{action:'remove',id:'../bad'})).status,'unavailable');
  assert.equal(calls,0);
  assert.equal((await packageRequest(port,{action:'status'})).status,'unavailable');
  assert.equal(calls,1);
});
