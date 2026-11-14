import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeDesktopRuntimeInfo, probeDesktopRuntime,
} from '../src/app/native/runtime-protocol.ts';

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

const invalid = value => assert.throws(
  () => decodeDesktopRuntimeInfo(value),
  error => error.message === 'Unsupported or invalid desktop runtime protocol',
);

test('plain, frozen and null-prototype JSON-like replies decode with exact v1 fields', () => {
  for (const payload of [valid, {...valid}, Object.assign(Object.create(null), valid)]) {
    const decoded = decodeDesktopRuntimeInfo(payload);
    assert.deepEqual(decoded, valid);
    assert.equal(Object.keys(decoded).length, 8);
  }
});

test('required fields must be own enumerable data properties', () => {
  for (const key of Object.keys(valid)) {
    const inherited = Object.create({...valid});
    invalid(inherited);
    const missing = {...valid};
    delete missing[key];
    invalid(missing);
    const nonEnumerable = {...valid};
    Object.defineProperty(nonEnumerable, key, {value:valid[key], enumerable:false});
    invalid(nonEnumerable);
  }
});

test('accessor-backed required fields are rejected without calling the getter', () => {
  for (const key of Object.keys(valid)) {
    let reads = 0;
    const accessor = {...valid};
    Object.defineProperty(accessor, key, {
      enumerable:true,
      get() { reads++; throw new Error('secret native path'); },
    });
    invalid(accessor);
    assert.equal(reads, 0, key);
  }
});

test('a version property cannot change between validation and returned snapshot', () => {
  let reads = 0;
  const dynamic = {...valid};
  Object.defineProperty(dynamic, 'applicationVersion', {
    enumerable:true,
    get() { reads++; return reads === 1 ? '0.0.1' : '<script>'; },
  });
  invalid(dynamic);
  assert.equal(reads, 0);
});

test('revoked proxies, malicious traps and special object prototypes fail closed', () => {
  const {proxy, revoke} = Proxy.revocable({...valid}, {});
  revoke();
  invalid(proxy);
  invalid(new Proxy({...valid}, {
    getOwnPropertyDescriptor() { throw new Error('private IPC data'); },
  }));
  invalid(new Date());
  invalid(Object.assign(Object.create({custom:1}), valid));
});

test('bounded versions and capability flags prevent misleading native readiness', () => {
  invalid({...valid, applicationVersion:'1.0.0+'+'a'.repeat(128)});
  invalid({...valid, accountConnected:true});
  invalid({...valid, ephemerisReady:true});
  invalid({...valid, cloudSyncAvailable:true});
  assert.equal(decodeDesktopRuntimeInfo({...valid, applicationVersion:'1.2.3+win64'}).applicationVersion,'1.2.3+win64');
});

test('extra untrusted fields are ignored and not accessed or propagated', () => {
  const extra = {...valid};
  Object.defineProperty(extra, 'privateBirthData', {
    enumerable:true,
    get() { throw new Error('must not read unrelated data'); },
  });
  const decoded = decodeDesktopRuntimeInfo(extra);
  assert.equal(Object.hasOwn(decoded,'privateBirthData'),false);
});

test('native IPC malformed payload is classified unavailable without leaking details', async () => {
  const malicious = {...valid};
  Object.defineProperty(malicious, 'applicationVersion', {
    enumerable:true,
    get() { throw new Error('C:/private/credentials'); },
  });
  const result = await probeDesktopRuntime({
    isNative:()=>true,
    invoke:async()=>malicious,
  });
  assert.deepEqual(result, {kind:'native_unavailable', info:null});
});
