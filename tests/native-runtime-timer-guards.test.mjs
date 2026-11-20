import test from 'node:test';
import assert from 'node:assert/strict';
import { probeDesktopRuntime } from '../src/app/native/runtime-protocol.ts';

const valid = Object.freeze({
  protocolVersion: 1,
  product: 'VirgoStars Desktop',
  applicationVersion: '0.0.1',
  platform: 'windows',
  fixtureKind: 'synthetic_demo',
  accountConnected: false,
  cloudSyncAvailable: false,
  ephemerisReady: false,
});

const unavailable = {kind: 'native_unavailable', info: null};

test('throwing timer-options getter fails closed without dispatching native IPC', async () => {
  let invocations = 0;
  const options = Object.defineProperty({}, 'timers', {
    get() { throw new Error('C:/private/secret.txt'); },
  });
  const result = await probeDesktopRuntime({
    isNative: () => true,
    invoke: async () => { invocations++; return valid; },
  }, options);
  assert.deepEqual(result, unavailable);
  assert.equal(invocations, 0);
});

test('missing timer handles prevent native IPC even if scheduler silently returns', async () => {
  for (const handle of [undefined, null]) {
    let invocations = 0;
    let clears = 0;
    const result = await probeDesktopRuntime({
      isNative: () => true,
      invoke: async () => { invocations++; return valid; },
    }, {timers: {
      set() { return handle; },
      clear() { clears++; },
    }});
    assert.deepEqual(result, unavailable, String(handle));
    assert.equal(invocations, 0, String(handle));
    assert.equal(clears, 0, 'Cannot safely clear an absent handle');
  }
});

test('valid timer handle zero is accepted and cleared after successful probe', async () => {
  let deadline;
  const clears = [];
  let invoked = 0;
  const result = await probeDesktopRuntime({
    isNative: () => true,
    invoke: async () => { invoked++; return valid; },
  }, {timers: {
    set(callback) { deadline = callback; return 0; },
    clear(handle) { clears.push(handle); },
  }});
  assert.equal(result.kind, 'desktop_demo');
  assert.equal(invoked, 1);
  assert.deepEqual(clears, [0]);
  deadline(); // Late timer cannot revise the settled result.
  assert.equal(result.kind, 'desktop_demo');
});

test('browser preview ignores timer options entirely, including throwing accessors', async () => {
  let invoked = 0;
  const options = Object.defineProperty({}, 'timers', {
    get() { throw new Error('Never read options outside native context'); },
  });
  const result = await probeDesktopRuntime({
    isNative: () => false,
    invoke: async () => { invoked++; return valid; },
  }, options);
  assert.deepEqual(result, {kind: 'browser_preview', info: null});
  assert.equal(invoked, 0);
});

test('null options fall back to the standard bounded native timer', async () => {
  const result = await probeDesktopRuntime({
    isNative: () => true,
    invoke: async () => valid,
  }, null);
  assert.equal(result.kind, 'desktop_demo');
  assert.equal(result.info.platform, 'windows');
});
