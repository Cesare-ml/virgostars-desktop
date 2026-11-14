import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeOfflineProfileEvidence, assessOfflineProfileAccess,
} from '../src/app/native/offline-profile-gate.ts';

const unlocked = (overrides={}) => ({
  protocolVersion:1, profile:'unlocked', activatedOnlineBefore:true,
  encryptedCachePresent:true, nativeKeyUnlocked:true,
  revocation:'unknown', session:'valid', network:'online',
  syncTransportReady:false, pendingMutations:2, ...overrides,
});
const absent = (overrides={}) => unlocked({
  profile:'absent',activatedOnlineBefore:false,encryptedCachePresent:false,
  nativeKeyUnlocked:false,pendingMutations:0,...overrides,
});
const locked = (overrides={}) => unlocked({
  profile:'locked',nativeKeyUnlocked:false,pendingMutations:0,...overrides,
});

// Invariants: only a previously activated, unlocked, encrypted local profile
// permits offline reads; a valid online session is NOT a substitute.
test('brand-new device offline must not read local data or attempt sync',()=>{
  const result=assessOfflineProfileAccess(absent({network:'offline',session:'none'}));
  assert.deepEqual(result,{
    status:'activation_required',canReadLocal:false,canWriteLocal:false,
    canAttemptSync:false,knownPendingMutations:null,syncNotice:'blocked',
  });
});

test('online session without encrypted snapshot still cannot expose charts',()=>{
  const result=assessOfflineProfileAccess(absent());
  assert.equal(result.status,'snapshot_required');
  assert.equal(result.canReadLocal,false);
  assert.equal(result.canAttemptSync,false);
});

test('locked cache refuses access regardless of a valid session',()=>{
  const result=assessOfflineProfileAccess(locked());
  assert.equal(result.status,'unlock_required');
  assert.equal(result.canReadLocal,false);
  assert.equal(result.knownPendingMutations,null);
});

test('unreadable encrypted cache requires recovery without plaintext fallback',()=>{
  const result=assessOfflineProfileAccess(locked({profile:'unreadable'}));
  assert.equal(result.status,'recovery_required');
  assert.equal(result.canWriteLocal,false);
});

test('prior activated unlocked cache remains usable offline when token expires',()=>{
  const result=assessOfflineProfileAccess(unlocked({network:'offline',session:'expired'}));
  assert.equal(result.status,'ready_offline');
  assert.equal(result.canReadLocal,true);
  assert.equal(result.canWriteLocal,true);
  assert.equal(result.canAttemptSync,false);
  assert.equal(result.syncNotice,'offline');
  assert.equal(result.knownPendingMutations,2);
});

test('online but expired session does not silently attempt sync',()=>{
  const result=assessOfflineProfileAccess(unlocked({session:'expired',syncTransportReady:true}));
  assert.equal(result.canReadLocal,true);
  assert.equal(result.canAttemptSync,false);
  assert.equal(result.syncNotice,'session_required');
});

test('unavailable native sync adapter never advertises a working cloud sync',()=>{
  const result=assessOfflineProfileAccess(unlocked());
  assert.equal(result.status,'ready_online');
  assert.equal(result.canAttemptSync,false);
  assert.equal(result.syncNotice,'transport_unavailable');
});

test('eligible means only an attempt, not a synchronized remote record',()=>{
  const result=assessOfflineProfileAccess(unlocked({syncTransportReady:true,pendingMutations:0}));
  assert.equal(result.canAttemptSync,true);
  assert.equal(result.syncNotice,'eligible_to_attempt');
  assert.equal(result.knownPendingMutations,0);
  assert.ok(!Object.hasOwn(result,'synced'));
});

test('known revocation denies local access even if cache was unlocked',()=>{
  const result=assessOfflineProfileAccess(unlocked({revocation:'known_revoked',syncTransportReady:true}));
  assert.equal(result.status,'known_revoked');
  assert.equal(result.canReadLocal,false);
  assert.equal(result.canAttemptSync,false);
});

test('remote revocation unknown during offline startup is NOT falsely asserted',()=>{
  const result=assessOfflineProfileAccess(unlocked({network:'offline',session:'none'}));
  assert.equal(result.status,'ready_offline');
  assert.equal(result.syncNotice,'offline');
  assert.ok(!Object.hasOwn(result,'remoteAuthorizationVerified'));
});

test('rejects inconsistent evidence and out-of-range pending mutation counts',()=>{
  const invalid=[
    absent({encryptedCachePresent:true}), absent({nativeKeyUnlocked:true}),
    absent({pendingMutations:1}), locked({nativeKeyUnlocked:true}),
    unlocked({nativeKeyUnlocked:false}), unlocked({encryptedCachePresent:false}),
    unlocked({activatedOnlineBefore:false}), unlocked({pendingMutations:-1}),
    unlocked({pendingMutations:1.5}), unlocked({pendingMutations:1000001}),
    unlocked({pendingMutations:NaN}), unlocked({pendingMutations:Infinity}),
    unlocked({protocolVersion:2}), unlocked({profile:'unknown'}),
    unlocked({network:'unknown'}), unlocked({session:'renewed'}),
    unlocked({syncTransportReady:'yes'}), unlocked({revocation:null}),
    unlocked({session:null}),
  ];
  for (const item of invalid) {
    assert.equal(decodeOfflineProfileEvidence(item),null);
    assert.equal(assessOfflineProfileAccess(item).status,'invalid_evidence');
  }
});

test('strictly rejects getters, inherited fields, extra keys, symbols and arrays',()=>{
  const getter=unlocked();
  Object.defineProperty(getter,'nativeKeyUnlocked',{get(){throw Error('secret')}});
  const nonEnumerable=unlocked();
  Object.defineProperty(nonEnumerable,'pendingMutations',{value:0,enumerable:false});
  const symbol=unlocked();symbol[Symbol('extra')]=1;
  const inherited=Object.create(unlocked());
  const values=[getter,nonEnumerable,symbol,inherited,[],null,
    {...unlocked(),extra:'unexpected'}];
  for(const value of values) assert.equal(decodeOfflineProfileEvidence(value),null);
  const proxy=new Proxy(unlocked(),{ownKeys(){throw Error('user path')}});
  assert.equal(assessOfflineProfileAccess(proxy).status,'invalid_evidence');
});

test('accepted evidence is immutable, detached and contains no input extension',()=>{
  const value=unlocked();
  const evidence=decodeOfflineProfileEvidence(value);
  assert.ok(evidence);
  assert.ok(Object.isFrozen(evidence));
  value.pendingMutations=100;
  assert.equal(evidence.pendingMutations,2);
  const decision=assessOfflineProfileAccess(evidence);
  assert.ok(Object.isFrozen(decision));
  assert.equal(decision.knownPendingMutations,2);
});
