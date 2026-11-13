import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeDesktopRuntimeInfo, probeDesktopRuntime
} from '../src/app/native/runtime-protocol.ts';

const valid = {
  protocolVersion: 1,
  product: 'VirgoStars Desktop',
  applicationVersion: '0.0.1',
  platform: 'windows',
  fixtureKind: 'synthetic_demo',
  accountConnected: false,
  cloudSyncAvailable: false,
  ephemerisReady: false,
};

test('valid native response provides platform and version without fake capabilities', () => {
  const payload = decodeDesktopRuntimeInfo(valid);
  assert.equal(payload.protocolVersion, 1);
  assert.equal(payload.platform, 'windows');
  assert.equal(payload.accountConnected, false);
  assert.equal(payload.cloudSyncAvailable, false);
  assert.equal(payload.ephemerisReady, false);
  assert.equal(Object.keys(payload).length, 8);
});

test('macOS and Linux probe platforms can be recognized for later native testing', () => {
  for (const platform of ['macos', 'linux']) {
    assert.equal(decodeDesktopRuntimeInfo({...valid, platform}).platform, platform);
  }
});

test('rejects malformed, wrong-version or unsupported host protocol', () => {
  for (const value of [
    null, [], '', {},
    {...valid, protocolVersion: 2},
    {...valid, product: 'another-app'},
    {...valid, platform: 'browser'},
    {...valid, applicationVersion: '../bad'},
    {...valid, fixtureKind: 'live_data'},
    {...valid, accountConnected: true},
    {...valid, cloudSyncAvailable: true},
    {...valid, ephemerisReady: true},
  ]) {
    assert.throws(() => decodeDesktopRuntimeInfo(value), /Unsupported or invalid/);
  }
});

test('ignores unrecognized extra fields instead of allowing them into the UI', () => {
  const payload=decodeDesktopRuntimeInfo({...valid, sensitiveData: 'never-return-this'});
  assert.equal(Object.hasOwn(payload,'sensitiveData'),false);
});

test('browser preview never invokes native IPC', async () => {
  let count=0;
  const result=await probeDesktopRuntime({
    isNative:()=>false,
    invoke:async()=>{count++;return valid;},
  });
  assert.equal(result.kind,'browser_preview');
  assert.equal(result.info,null);
  assert.equal(count,0);
});

test('native probe invokes one read-only named command and validates its result', async () => {
  let command='';
  const result=await probeDesktopRuntime({
    isNative:()=>true,
    invoke:async name=>{command=name;return valid;},
  });
  assert.equal(command,'desktop_runtime_info');
  assert.equal(result.kind,'desktop_demo');
  assert.equal(result.info?.platform,'windows');
});

test('IPC exception does not leak internal details to UI', async () => {
  const result=await probeDesktopRuntime({
    isNative:()=>true,
    invoke:async()=>{throw new Error('secret production path C:/hidden/credential');},
  });
  assert.deepEqual(result,{kind:'native_unavailable',info:null});
});

test('invalid native response falls back to unavailable, never to an authenticated state', async () => {
  const result=await probeDesktopRuntime({
    isNative:()=>true,
    invoke:async()=>({...valid,accountConnected:true}),
  });
  assert.deepEqual(result,{kind:'native_unavailable',info:null});
});

test('native detection failure is contained safely', async () => {
  const result=await probeDesktopRuntime({
    isNative:()=>{throw new Error('broken WebView');},
    invoke:async()=>valid,
  });
  assert.deepEqual(result,{kind:'native_unavailable',info:null});
});

test('hung native IPC is bounded and resolves to unavailable without leaking details', async () => {
  let deadline;
  let configuredMs = 0;
  const cleared = [];
  const timers = {
    set(callback, ms) { deadline = callback; configuredMs = ms; return 17; },
    clear(handle) { cleared.push(handle); },
  };
  let lateResolve;
  const neverInitially = new Promise(resolve => { lateResolve = resolve; });
  const request = probeDesktopRuntime({
    isNative: () => true,
    invoke: async () => neverInitially,
  }, {timers});
  assert.equal(configuredMs, 4000);
  deadline();
  assert.deepEqual(await request, {kind:'native_unavailable', info:null});
  assert.deepEqual(cleared,[17]);
  lateResolve({...valid, accountConnected:true});
  await Promise.resolve(); // Late native reply cannot revise the settled UI result.
});

test('successful native IPC cancels its deadline and preserves exact v1 metadata', async () => {
  let deadline;
  let configuredMs = 0;
  const cleared = [];
  const result = await probeDesktopRuntime({
    isNative:()=>true,
    invoke:async()=>valid,
  }, {
    timeoutMs:900,
    timers:{
      set(callback, ms) { deadline=callback; configuredMs=ms; return 23; },
      clear(handle) { cleared.push(handle); },
    },
  });
  assert.equal(result.kind, 'desktop_demo');
  assert.equal(result.info.applicationVersion, '0.0.1');
  assert.equal(configuredMs, 900);
  assert.deepEqual(cleared,[23]);
  // A stale timeout callback cannot alter the already delivered result.
  deadline();
  assert.equal(result.kind, 'desktop_demo');
});

test('browser preview neither schedules timers nor calls the native transport', async () => {
  const result = await probeDesktopRuntime({
    isNative:()=>false,
    invoke:async()=>{ throw new Error('Should not attempt native IPC'); },
  }, {
    timeoutMs:0,
    timers:{
      set() { throw new Error('Should not start a native timeout'); },
      clear() { throw new Error('Should not clear a native timeout'); },
    },
  });
  assert.deepEqual(result,{kind:'browser_preview',info:null});
});

test('invalid timeout options fail closed before the native IPC call', async () => {
  let called = 0;
  for (const timeoutMs of [0, -1, 1.5, Number.POSITIVE_INFINITY, 30001, NaN]) {
    const result = await probeDesktopRuntime({
      isNative:()=>true,
      invoke:async()=>{ called++; return valid; },
    }, {timeoutMs});
    assert.deepEqual(result,{kind:'native_unavailable',info:null},String(timeoutMs));
  }
  assert.equal(called,0);
});

test('deadline scheduler errors are contained and cannot report native readiness', async () => {
  const result = await probeDesktopRuntime({
    isNative:()=>true,
    invoke:async()=>valid,
  }, {
    timers:{
      set() { throw new Error('Sensitive environment error'); },
      clear() {},
    },
  });
  assert.deepEqual(result,{kind:'native_unavailable',info:null});
});

test('deadline registration failure never starts an unbounded native IPC invocation', async () => {
  let calls = 0;
  const result = await probeDesktopRuntime({
    isNative: () => true,
    invoke: async () => { calls++; return valid; },
  }, {
    timers: {
      set() { throw new Error('OS timer registration unavailable'); },
      clear() { throw new Error('A timer was never registered'); },
    },
  });
  // Also inspect after microtasks flush: the native invocation must not
  // have been queued before the scheduler threw.
  await Promise.resolve();
  assert.deepEqual(result, {kind:'native_unavailable', info:null});
  assert.equal(calls, 0);
});

test('a timer firing synchronously prevents dispatch and clears its registered handle', async () => {
  let calls = 0;
  const cleared = [];
  const result = await probeDesktopRuntime({
    isNative: () => true,
    invoke: async () => { calls++; return valid; },
  }, {
    timers: {
      set(callback) { callback(); return 41; },
      clear(handle) { cleared.push(handle); },
    },
  });
  await Promise.resolve();
  assert.deepEqual(result, {kind:'native_unavailable', info:null});
  assert.equal(calls, 0);
  assert.deepEqual(cleared, [41]);
});

test('scheduler that invokes its callback and then throws never dispatches IPC', async () => {
  let calls = 0;
  const result = await probeDesktopRuntime({
    isNative: () => true,
    invoke: async () => { calls++; return valid; },
  }, {
    timers: {
      set(callback) {
        callback();
        throw new Error('Timer partially registered then failed');
      },
      clear() { throw new Error('There is no returned timer handle'); },
    },
  });
  await Promise.resolve();
  assert.deepEqual(result, {kind:'native_unavailable', info:null});
  assert.equal(calls, 0);
});

test('timer cleanup failure is never surfaced to the UI after a successful native probe', async () => {
  const result = await probeDesktopRuntime({
    isNative:()=>true,
    invoke:async()=>valid,
  }, {
    timers:{
      set() { return 5; },
      clear() { throw new Error('Sensitive system details'); },
    },
  });
  assert.equal(result.kind,'desktop_demo');
});
