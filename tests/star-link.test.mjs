import test from 'node:test';
import assert from 'node:assert/strict';
import {requestStarPage} from '../src/app/native/star-link-contract.ts';

test('only bounded star IDs are passed to the native opener', async () => {
  const calls=[];
  const port={isNative:()=>true, invoke:async (...args)=>{calls.push(args); return true;}};
  for (const id of [0, -1, 1.5, 1_000_001, NaN, Infinity, '1']) assert.equal(await requestStarPage(port,id),false);
  assert.equal(calls.length,0);
  assert.equal(await requestStarPage(port,541),true);
  assert.deepEqual(calls,[['open_star_page',{id:541}]]);
});

test('browser previews and native errors fail without claiming success', async () => {
  assert.equal(await requestStarPage({isNative:()=>false, invoke:()=>{throw Error();}},1),false);
  assert.equal(await requestStarPage({isNative:()=>true, invoke:async()=>{throw Error();}},1),false);
  assert.equal(await requestStarPage({isNative:()=>true, invoke:async()=>({ok:true})},1),false);
});
