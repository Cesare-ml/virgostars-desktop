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
