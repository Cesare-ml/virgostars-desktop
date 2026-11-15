import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RuntimeCheckController} from '../src/app/native/runtime-check-controller.ts';

const native = {
  kind:'desktop_demo',
  info:{
    protocolVersion:1,product:'VirgoStars Desktop',applicationVersion:'0.0.1',
    platform:'windows',fixtureKind:'synthetic_demo',
    accountConnected:false,cloudSyncAvailable:false,ephemerisReady:false,
  },
};
const browser = {kind:'browser_preview', info:null};
const unavailable = {kind:'native_unavailable', info:null};

test('native check is visibly pending then reports only demo readiness', async () => {
  const seen = [];
  const controller = new RuntimeCheckController(async()=>native,
    ()=>seen.push([controller.status,controller.checking]));
  await controller.check();
  assert.equal(controller.status,'native');
  assert.equal(controller.checking,false);
  assert.deepEqual(seen,[['checking',true],['native',false]]);
});

test('explicit retry can recover a previous unavailable result', async () => {
  let attempts = 0;
  const controller = new RuntimeCheckController(async()=>++attempts===1 ? unavailable : native,()=>{});
  await controller.check();
  assert.equal(controller.status,'unavailable');
  await controller.check();
  assert.equal(controller.status,'native');
  assert.equal(attempts,2);
});

test('browser preview is not misrepresented as a native or authenticated environment', async () => {
  const controller = new RuntimeCheckController(async()=>browser,()=>{});
  await controller.check();
  assert.equal(controller.status,'browser');
});

test('a repeated request while IPC is pending cannot dispatch another probe', async () => {
  let resolve;
  let calls=0;
  const pending = new Promise(done=>{resolve=done;});
  const controller = new RuntimeCheckController(()=>{calls++;return pending;},()=>{});
  const first = controller.check();
  await controller.check();
  assert.equal(controller.checking,true);
  assert.equal(calls,1);
  resolve(native);
  await first;
  assert.equal(controller.status,'native');
  assert.equal(controller.checking,false);
});

test('late native results cannot update a component after dispose', async () => {
  let resolve;
  const pending = new Promise(done=>{resolve=done;});
  const seen=[];
  const controller = new RuntimeCheckController(()=>pending,()=>seen.push(controller.status));
  const task=controller.check();
  controller.dispose();
  resolve(native);
  await task;
  assert.deepEqual(seen,['checking']);
  assert.equal(controller.checking,false);
  await controller.check();
  assert.deepEqual(seen,['checking']);
});

test('sync rejection and observer errors cannot leak OS paths or poison future retries', async () => {
  let calls=0;
  const controller = new RuntimeCheckController(()=>{
    calls++;
    if(calls===1) throw new Error('C:/secret/device-token');
    return Promise.resolve(native);
  },()=>{throw new Error('UI observer failed');});
  await assert.doesNotReject(controller.check());
  assert.equal(controller.status,'unavailable');
  assert.equal(controller.checking,false);
  await assert.doesNotReject(controller.check());
  assert.equal(controller.status,'native');
});

test('Desktop template exposes a localized keyboard-accessible manual retry', () => {
  const app = readFileSync(new URL('../src/app/desktop-app.component.ts',import.meta.url),'utf8');
  const template = readFileSync(new URL('../src/app/desktop-app.component.html',import.meta.url),'utf8');
  const translations = readFileSync(new URL('../src/app/translations.ts',import.meta.url),'utf8');
  assert.match(app,/new RuntimeCheckController\(/);
  assert.match(app,/this\.runtimeCheck\.dispose\(\)/);
  assert.match(app,/this\.runtimeCheck\.check\(\)/);
  assert.match(template,/\[disabled\]="runtimeChecking"/);
  assert.match(template,/\(click\)="checkRuntime\(\)"/);
  assert.match(template,/\[attr\.aria-label\]="t\('runtime\.retry'\)"/);
  assert.equal((translations.match(/"runtime\.retry":/g)||[]).length,2);
  assert.equal((translations.match(/"runtime\.label":/g)||[]).length,2);
});
