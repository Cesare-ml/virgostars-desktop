import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeDesktopRuntimeInfo, probeDesktopRuntime } from '../src/app/native/runtime-protocol.ts';

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

test('each approved IPC field is read once and copied into a frozen detached response', () => {
  const reads = {};
  const reply = {};
  for (const [key, value] of Object.entries(valid)) {
    reads[key] = 0;
    Object.defineProperty(reply, key, {
      enumerable: true,
      get() { reads[key]++; return value; },
    });
  }
  const info = decodeDesktopRuntimeInfo(reply);
  assert.deepEqual(Object.values(reads), Array(8).fill(1));
  assert.deepEqual(info, valid);
  assert.equal(Object.isFrozen(info), true);
  assert.throws(() => { info.platform = 'browser'; }, TypeError);
});

test('time-varying version and platform getters cannot swap validated UI content', () => {
  let versionReads = 0;
  let platformReads = 0;
  const reply = {
    ...valid,
    get applicationVersion() { return ++versionReads === 1 ? '0.0.1' : '../private'; },
    get platform() { return ++platformReads === 1 ? 'windows' : 'browser'; },
  };
  const info = decodeDesktopRuntimeInfo(reply);
  assert.equal(info.applicationVersion, '0.0.1');
  assert.equal(info.platform, 'windows');
  assert.equal(versionReads, 1);
  assert.equal(platformReads, 1);
});

test('first invalid value cannot become accepted through a later accessor read', () => {
  let reads = 0;
  const reply = {...valid, get platform() { return ++reads === 1 ? 'browser' : 'windows'; }};
  assert.throws(() => decodeDesktopRuntimeInfo(reply), /^Error: Unsupported or invalid desktop runtime protocol$/);
  assert.equal(reads, 1);
});

test('throwing accessors are redacted by direct decoding and the asynchronous probe', async () => {
  const reply = {...valid, get applicationVersion() { throw new Error('C:/private/token.txt'); }};
  assert.throws(() => decodeDesktopRuntimeInfo(reply), error =>
    error.message === 'Unsupported or invalid desktop runtime protocol' && !error.message.includes('private'));
  const result = await probeDesktopRuntime({isNative: () => true, invoke: async () => reply});
  assert.deepEqual(result, {kind: 'native_unavailable', info: null});
});

test('oversized semver-like replies fail closed without changing normal versions', () => {
  const oversized = {...valid, applicationVersion: '1.2.3+' + 'a'.repeat(60)};
  assert.throws(() => decodeDesktopRuntimeInfo(oversized), /Unsupported or invalid/);
  assert.equal(decodeDesktopRuntimeInfo({...valid, applicationVersion: '2.1.0-beta.3'}).applicationVersion, '2.1.0-beta.3');
});

test('mutating the original reply after validation cannot change accepted capability flags', () => {
  const reply = {...valid};
  const info = decodeDesktopRuntimeInfo(reply);
  reply.platform = 'browser';
  reply.accountConnected = true;
  reply.applicationVersion = '9.9.9';
  assert.equal(info.platform, 'windows');
  assert.equal(info.accountConnected, false);
  assert.equal(info.applicationVersion, '0.0.1');
});
