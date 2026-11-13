import test from 'node:test';
import assert from 'node:assert/strict';
import {OfflineCityPickerState} from '../src/app/offline-city-picker-state.ts';

const a = Object.freeze({id:1,name:'Firenze',italianName:'Florence',latMicro:43769560,lngMicro:11255810,population:360000,stateId:1,region:'Toscana',timeZone:'Europe/Rome'});
const b = Object.freeze({...a,id:2,region:'Lazio'});
const harness=()=>{
  const tasks=new Map();let key=0,calls=[],clear=0,notices=0;
  const requests=[];
  const lookup={search:(query,limit)=>{calls.push([query,limit]);return new Promise((resolve,reject)=>requests.push({resolve,reject}));},clear:()=>clear++};
  const timers={set:(fn,delay)=>{tasks.set(++key,{fn,delay});return key;},clear:(id)=>tasks.delete(id)};
  const state=new OfflineCityPickerState(lookup,()=>notices++,timers);
  return {state,tasks,requests,calls,get clear(){return clear},get notices(){return notices},flush(){const entries=[...tasks.values()];tasks.clear();entries.forEach(x=>x.fn());}};
};

test('typing bursts coalesce to one bounded lookup with 180ms debounce',async()=>{
 const h=harness();h.state.input('Fi');h.state.input('Fir');h.state.input('Firenze');
 assert.equal(h.tasks.size,1);assert.equal(h.calls.length,0);h.flush();
 assert.deepEqual(h.calls,[['Firenze',12]]);h.requests[0].resolve({kind:'ready',items:[a,b]});
 await Promise.resolve();assert.equal(h.state.status,'ready');assert.equal(h.state.results.length,2);
});
test('short or empty queries never invoke backend',()=>{
 const h=harness();h.state.input('x');h.flush();assert.equal(h.calls.length,0);assert.equal(h.state.status,'query_too_short');
 h.state.input('');h.flush();assert.equal(h.state.status,'idle');
});
test('cancel queued timer by new shorter input',()=>{
 const h=harness();h.state.input('Rome');h.state.input('x');h.flush();assert.equal(h.calls.length,0);
});
test('latest wins even after an earlier native reply',async()=>{
 const h=harness();h.state.input('Roma');h.flush();h.state.input('Firenze');h.flush();
 h.requests[1].resolve({kind:'ready',items:[a]});await Promise.resolve();
 h.requests[0].resolve({kind:'ready',items:[b]});await Promise.resolve();
 assert.equal(h.state.results[0].id,1);
});
test('obsolete errors cannot replace current response',async()=>{
 const h=harness();h.state.input('Roma');h.flush();h.state.input('Firenze');h.flush();
 h.requests[1].resolve({kind:'ready',items:[a]});await Promise.resolve();
 h.requests[0].reject(new Error('private path'));await Promise.resolve();
 assert.equal(h.state.status,'ready');
});
test('keyboard navigation wraps and choice preserves a stable city id',async()=>{
 const h=harness();h.state.input('Firenze');h.flush();h.requests[0].resolve({kind:'ready',items:[a,b]});await Promise.resolve();
 h.state.move(-1);assert.equal(h.state.activeIndex,1);h.state.move(1);assert.equal(h.state.activeIndex,0);
 const chosen=h.state.chooseActive();assert.equal(chosen.id,1);assert.equal(h.state.query,'Firenze');
 assert.equal(h.state.results.length,0);assert.equal(h.state.status,'selected');
});
test('editing input invalidates previous selection',async()=>{
 const h=harness();h.state.restore(a);assert.equal(h.state.selected.id,1);
 h.state.input('Roma');assert.equal(h.state.selected,null);assert.equal(h.state.status,'typing');
});
test('empty results and safe native errors have explicit states',async()=>{
 const h=harness();h.state.input('Nobody');h.flush();h.requests[0].resolve({kind:'ready',items:[]});await Promise.resolve();assert.equal(h.state.status,'empty');
 h.state.input('Roma');h.flush();h.requests[1].resolve({kind:'catalog_unavailable',items:[]});await Promise.resolve();assert.equal(h.state.status,'catalog_unavailable');
});
test('dispose clears pending work and prevents callbacks',async()=>{
 const h=harness();h.state.input('Roma');h.flush();const old=h.notices;h.state.dispose();h.requests[0].resolve({kind:'ready',items:[a]});await Promise.resolve();assert.equal(h.notices,old);
 h.state.input('Firenze');assert.equal(h.tasks.size,0);
});
test('dismissing a suggestion list keeps chosen city but cancels pending requests',async()=>{
 const h=harness();h.state.restore(a);h.state.dismiss();assert.equal(h.state.selected.id,1);assert.equal(h.state.status,'selected');
 h.state.input('Roma');h.state.dismiss();h.flush();assert.equal(h.calls.length,0);
});


test('country metadata from an explicit v2 lookup survives selection without guessing',async()=>{
  const h=harness();
  const mapped={...a,countryName:'Italia',countryCode:'IT'};
  h.state.input('Firenze');h.flush();
  h.requests[0].resolve({kind:'ready',items:[mapped]});
  await Promise.resolve();
  const chosen=h.state.choose(0);
  assert.equal(chosen.countryName,'Italia');
  assert.equal(chosen.countryCode,'IT');
  assert.equal(chosen.stateId,1);
  assert.equal(h.state.selected.countryName,'Italia');
});


test('scheduler failure shows unavailable immediately and permits an explicit retry', async () => {
  let broken = true;
  let scheduled;
  const calls = [];
  const lookup = {clear() {}, async search(query) {calls.push(query); return {kind:'ready',items:[a]};}};
  const timers = {
    set(fn) { if (broken) throw new Error('sensitive scheduler detail'); scheduled = fn; return 0; },
    clear(id) { assert.equal(id, 0); },
  };
  const state = new OfflineCityPickerState(lookup, () => {}, timers);
  assert.doesNotThrow(() => state.input('Roma'));
  assert.equal(state.status, 'unavailable');
  assert.deepEqual(calls, []);
  broken = false;
  state.input('Firenze');
  assert.equal(state.status, 'typing');
  scheduled();
  await Promise.resolve();
  assert.equal(state.status, 'ready');
  assert.deepEqual(calls, ['Firenze']);
  state.dispose();
});

test('missing scheduler handles fail closed even when a callback appears later', async () => {
  let handle = null;
  let callback;
  let searches = 0;
  const lookup = {clear() {}, async search() {searches++; return {kind:'ready',items:[a]};}};
  const timers = {
    set(fn) { callback = fn; return handle; },
    clear(id) { assert.equal(id, 0); },
  };
  const state = new OfflineCityPickerState(lookup, () => {}, timers);
  state.input('Roma');
  assert.equal(state.status, 'unavailable');
  callback();
  await Promise.resolve();
  assert.equal(searches, 0, 'unknown timer handle must not launch a later lookup');
  handle = undefined;
  state.input('Roma');
  assert.equal(state.status, 'unavailable');
  callback();
  await Promise.resolve();
  assert.equal(searches, 0);
  handle = 0;
  state.input('Firenze');
  assert.equal(state.status, 'typing', 'zero is a valid cancellable handle');
  callback();
  await Promise.resolve();
  assert.equal(state.status, 'ready');
  assert.equal(searches, 1);
  state.dispose();
});

test('synchronous and duplicated scheduler callbacks cannot resurrect timer state', async () => {
  let callback;
  const cleared = [];
  const searched = [];
  const lookup = {clear() {}, async search(query) {searched.push(query); return {kind:'ready',items:[a]};}};
  const timers = {
    set(fn) { callback = fn; fn(); return 4; },
    clear(id) { cleared.push(id); },
  };
  const state = new OfflineCityPickerState(lookup, () => {}, timers);
  state.input('Firenze');
  assert.equal(state.status, 'loading');
  callback(); // broken scheduler invokes the same callback twice
  await Promise.resolve();
  assert.equal(state.status, 'ready');
  assert.deepEqual(searched, ['Firenze']);
  state.dispose();
  assert.deepEqual(cleared, [4], 'only the already-fired handle needs cleanup');
});

test('reentrant timer setup never overwrites the newer query debounce', async () => {
  let state;
  let reentered = false;
  const callbacks = new Map();
  const cleared = [];
  const searched = [];
  const lookup = {clear() {}, async search(query) {searched.push(query); return {kind:'ready',items:[a]};}};
  const timers = {
    set(fn) {
      if (!reentered) {
        reentered = true;
        callbacks.set(1, fn);
        state.input('Firenze');
        return 1;
      }
      callbacks.set(2, fn);
      return 2;
    },
    clear(id) { cleared.push(id); },
  };
  state = new OfflineCityPickerState(lookup, () => {}, timers);
  state.input('Roma');
  assert.equal(state.query, 'Firenze');
  assert.equal(state.status, 'typing');
  callbacks.get(1)(); // first ticket is obsolete
  assert.deepEqual(searched, []);
  callbacks.get(2)();
  await Promise.resolve();
  assert.deepEqual(searched, ['Firenze']);
  state.dispose();
  assert.deepEqual(cleared, [1], 'first handle is canceled; second has fired');
});

test('broken clear callbacks cannot break input, invalidation or disposal', async () => {
  let callback;
  let searches = 0;
  const lookup = {clear() {throw new Error('sensitive local path');}, async search() {
    searches++; return {kind:'ready',items:[a]};
  }};
  const timers = {set(fn) { callback = fn; return 3; }, clear() {throw new Error('sensitive timer');}};
  const state = new OfflineCityPickerState(lookup, () => {}, timers);
  assert.doesNotThrow(() => state.input('Roma'));
  const old = callback;
  assert.doesNotThrow(() => state.input('Firenze'));
  old();
  callback();
  await Promise.resolve();
  assert.equal(searches, 1);
  assert.equal(state.status, 'ready');
  assert.doesNotThrow(() => state.dispose());
  assert.doesNotThrow(() => callback());
});
