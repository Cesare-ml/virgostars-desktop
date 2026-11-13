import test from 'node:test';
import assert from 'node:assert/strict';
import {OfflinePlaceSearch, PLACE_SEARCH_TIMEOUT_MS} from '../src/app/native/offline-places-contract.ts';

function harness() {
  const timers = new Map();
  const cleared = [];
  let next = 0;
  const driver = {
    set(callback, delay) {
      assert.equal(delay, PLACE_SEARCH_TIMEOUT_MS);
      const handle = ++next;
      timers.set(handle, callback);
      return handle;
    },
    clear(handle) { cleared.push(handle); timers.delete(handle); },
  };
  return {driver, timers, cleared, fire(handle) { timers.get(handle)?.(); }};
}

const empty = {protocolVersion:1,items:[]};
const native = invoke => ({isNative:()=>true,invoke});

test('hung native IPC becomes a sanitized unavailable state at the fixed deadline',async()=>{
  const h=harness(); let callCount=0;
  const search=new OfflinePlaceSearch(native(()=>{callCount++; return new Promise(()=>{});}),h.driver);
  const pending=search.search('Firenze');
  assert.equal(callCount,0,'invocation is deferred until deadline is armed');
  await Promise.resolve();
  assert.equal(callCount,1);
  assert.equal(h.timers.size,1);
  h.fire(1);
  assert.deepEqual(await pending,{kind:'unavailable',items:[]});
  assert.deepEqual(h.cleared,[1]);
  assert.equal(h.timers.size,0);
});

test('success and native failure release the timer without changing statuses',async()=>{
  const h=harness();
  const ok=new OfflinePlaceSearch(native(async()=>empty),h.driver);
  assert.deepEqual(await ok.search('Roma'),{kind:'ready',items:[]});
  const failing=new OfflinePlaceSearch(native(async()=>{throw 'PLACE_SEARCH_BUSY';}),h.driver);
  assert.deepEqual(await failing.search('Roma'),{kind:'busy',items:[]});
  assert.deepEqual(h.cleared,[1,2]);
  assert.equal(h.timers.size,0);
});

test('late native success after timeout cannot promote a result',async()=>{
  const h=harness(); let resolve;
  const search=new OfflinePlaceSearch(native(()=>new Promise(r=>{resolve=r;})),h.driver);
  const pending=search.search('Bologna');
  await Promise.resolve();
  h.fire(1);
  assert.deepEqual(await pending,{kind:'unavailable',items:[]});
  resolve(empty);
  await Promise.resolve();
  assert.equal(h.timers.size,0);
});

test('stale timeout cannot overwrite a newer successful query',async()=>{
  const h=harness();
  const search=new OfflinePlaceSearch(native((_command,args)=>args.query==='Firenze' ? new Promise(()=>{}) : Promise.resolve(empty)),h.driver);
  const first=search.search('Firenze');
  const second=search.search('Roma');
  assert.deepEqual(await second,{kind:'ready',items:[]});
  h.fire(1);
  assert.deepEqual(await first,{kind:'stale',items:[]});
  assert.equal(h.timers.size,0);
});

test('a broken or missing deadline fails closed without starting IPC',async()=>{
  for(const set of [()=>null,()=>undefined,()=>{throw Error('bad scheduler');}]) {
    let invokes=0;
    const search=new OfflinePlaceSearch(native(async()=>{invokes++;return empty;}),{set,clear(){}});
    assert.deepEqual(await search.search('Roma'),{kind:'unavailable',items:[]});
    assert.equal(invokes,0);
  }
});

test('a synchronously fired deadline cannot launch stale native work',async()=>{
  let invokes=0,clears=0;
  const search=new OfflinePlaceSearch(native(async()=>{invokes++;return empty;}),{
    set(callback){callback();return 1;},
    clear(){clears++;},
  });
  assert.deepEqual(await search.search('Roma'),{kind:'unavailable',items:[]});
  assert.equal(invokes,0);
  assert.equal(clears,1);
});

test('a scheduler that fires and throws does not create unhandled rejections or invoke IPC',async()=>{
  let invokes=0;
  const search=new OfflinePlaceSearch(native(async()=>{invokes++;return empty;}),{
    set(callback){callback();throw Error('scheduler invalid');}, clear(){},
  });
  assert.deepEqual(await search.search('Roma'),{kind:'unavailable',items:[]});
  assert.equal(invokes,0);
});

test('invalid search and browser preview do not allocate a timer',async()=>{
  let scheduled=0;
  const timers={set(){scheduled++;return 1;},clear(){}};
  const search=new OfflinePlaceSearch({isNative:()=>false,invoke:async()=>empty},timers);
  assert.deepEqual(await search.search('x'),{kind:'query_too_short',items:[]});
  assert.deepEqual(await search.search('Roma'),{kind:'not_native',items:[]});
  assert.equal(scheduled,0);
});

test('failed timer cleanup does not turn a valid native answer into failure',async()=>{
  const search=new OfflinePlaceSearch(native(async()=>empty),{
    set(){return 1;},clear(){throw new Error('ignored cleanup failure');},
  });
  assert.deepEqual(await search.search('Roma'),{kind:'ready',items:[]});
});
