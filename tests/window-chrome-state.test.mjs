import test from 'node:test';
import assert from 'node:assert/strict';
import {WindowChromeStateCoordinator} from '../src/app/window-chrome-state.ts';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes,no) => { resolve=yes; reject=no; });
  return {promise, resolve, reject};
};
const flush = async () => { for (let i=0;i<8;i++) await Promise.resolve(); };

test('publishes a successful native state read without further requests', async () => {
  const values=[];let reads=0;
  const state=new WindowChromeStateCoordinator(async () => {reads++;return true;},v=>values.push(v));
  state.refresh();
  await flush();
  assert.deepEqual(values,[true]);
  assert.equal(reads,1);
});

test('hundreds of events during an in-flight query coalesce into one final refresh', async () => {
  const first=deferred();const second=deferred();
  const queue=[first,second];let reads=0;const values=[];
  const state=new WindowChromeStateCoordinator(() => {reads++;return queue.shift().promise;},v=>values.push(v));
  state.refresh();
  for (let i=0;i<250;i++) state.refresh();
  assert.equal(reads,1);
  first.resolve(false);
  await flush();
  assert.equal(reads,2);
  second.resolve(true);
  await flush();
  assert.equal(reads,2);
  assert.deepEqual(values,[false,true]);
});

test('an event queued while the catch-up read runs schedules exactly one more catch-up', async () => {
  const queue=[deferred(),deferred(),deferred()];
  let reads=0;const values=[];
  const state=new WindowChromeStateCoordinator(() => queue[reads++].promise,v=>values.push(v));
  state.refresh();state.refresh();
  queue[0].resolve(false);await flush();
  state.refresh();state.refresh();
  queue[1].resolve(true);await flush();
  queue[2].resolve(false);await flush();
  assert.equal(reads,3);
  assert.deepEqual(values,[false,true,false]);
});

test('disposal suppresses late state updates and queued refreshes', async () => {
  const pending=deferred();const values=[];let reads=0;
  const state=new WindowChromeStateCoordinator(()=>{reads++;return pending.promise;},v=>values.push(v));
  state.refresh();state.refresh();state.dispose();
  pending.resolve(true);await flush();
  state.refresh();await flush();
  assert.equal(reads,1);
  assert.deepEqual(values,[]);
});

test('a rejected native read does not wedge the coordinator', async () => {
  let reads=0;const values=[];
  const state=new WindowChromeStateCoordinator(async()=>{
    reads++;
    if(reads===1) throw Error('temporary IPC failure');
    return false;
  },v=>values.push(v));
  state.refresh();await flush();
  state.refresh();await flush();
  assert.equal(reads,2);
  assert.deepEqual(values,[false]);
});

test('a pending catch-up runs after a rejected native read', async () => {
  const first=deferred();const values=[];let reads=0;
  const state=new WindowChromeStateCoordinator(()=>++reads===1 ? first.promise : Promise.resolve(true),v=>values.push(v));
  state.refresh();state.refresh();
  first.reject(Error('transient IPC error'));
  await flush();
  assert.equal(reads,2);
  assert.deepEqual(values,[true]);
});
