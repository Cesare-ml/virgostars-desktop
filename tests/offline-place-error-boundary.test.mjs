import test from 'node:test';
import assert from 'node:assert/strict';
import {OfflinePlaceSearch} from '../src/app/native/offline-places-contract.ts';

function rejectingSearch(reason) {
  return new OfflinePlaceSearch({isNative:()=>true,invoke:async()=>{throw reason;}});
}

test('string and Error native status codes keep their canonical meanings',async()=>{
  for (const [reason,kind] of [
    ['PLACE_SEARCH_BUSY','busy'],[new Error('PLACE_SEARCH_BUSY'),'busy'],
    ['PLACE_CATALOG_UNAVAILABLE','catalog_unavailable'],
    [new Error('PLACE_CATALOG_UNAVAILABLE'),'catalog_unavailable'],
  ]) assert.deepEqual(await rejectingSearch(reason).search('Firenze'),{kind,items:[]});
});

test('hostile thrown objects cannot crash search through coercion',async()=>{
  for (const reason of [
    {toString(){throw new Error('private path');}},
    {[Symbol.toPrimitive](){throw new Error('secret');}},
    Object.create(null),
    Symbol('private'),
  ]) assert.deepEqual(await rejectingSearch(reason).search('Firenze'),{kind:'unavailable',items:[]});
});

test('spoofed native-status objects never get privileged status classification',async()=>{
  for (const reason of [
    {toString(){return 'PLACE_SEARCH_BUSY';}},
    {message:'PLACE_CATALOG_UNAVAILABLE'},
    {code:'PLACE_SEARCH_BUSY'},
  ]) assert.deepEqual(await rejectingSearch(reason).search('Firenze'),{kind:'unavailable',items:[]});
});

test('throwing Error.message getter is contained without logging private text',async()=>{
  const error=new Error('redacted');
  Object.defineProperty(error,'message',{get(){throw new Error('private');}});
  assert.deepEqual(await rejectingSearch(error).search('Firenze'),{kind:'unavailable',items:[]});
});

test('late malformed rejection stays stale after a newer successful request',async()=>{
  let rejectFirst;
  const search=new OfflinePlaceSearch({
    isNative:()=>true,
    invoke:(_command,args)=>args.query==='Firenze'
      ? new Promise((_resolve,reject)=>{rejectFirst=reject;})
      : Promise.resolve({protocolVersion:1,items:[]}),
  });
  const first=search.search('Firenze');
  const second=search.search('Bologna');
  assert.deepEqual(await second,{kind:'ready',items:[]});
  rejectFirst({toString(){throw new Error('secret');}});
  assert.deepEqual(await first,{kind:'stale',items:[]});
});
