import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOutbox, enqueueMutation, nextSyncBatch, applySyncReceipts, outboxCounts,
} from '../contracts/offline-outbox-reference.ts';

const change = (mutationId, entityId, extra = {}) => ({
  profileId: 'synthetic-owner', mutationId, entityType: 'subject', entityId,
  operation: 'upsert', baseServerRevision: 'rev0',
  createdAtUtc: '2026-11-10T19:00:00Z', payload: { label: 'Fictional ' + entityId }, ...extra,
});

test('empty owner-scoped outbox has no requests', () => {
  const state = createOutbox('synthetic-owner');
  assert.deepEqual(outboxCounts(state), { pending: 0, conflicts: 0 });
  assert.deepEqual(nextSyncBatch(state), []);
  assert.equal(Object.isFrozen(state), true);
  assert.throws(() => createOutbox(''), /Invalid sync identifier/);
});

test('append preserves insertion order and snapshots mutable input', () => {
  const a = change('mut-1', 'sample-1');
  const initial = createOutbox('synthetic-owner');
  const first = enqueueMutation(initial, a);
  a.payload.label = 'changed after enqueue';
  assert.deepEqual(outboxCounts(initial), { pending: 0, conflicts: 0 });
  assert.equal(first.entries[0].mutation.payload.label, 'Fictional sample-1');
  assert.ok(Object.isFrozen(first.entries[0].mutation.payload));
  const second = enqueueMutation(first, change('mut-2', 'sample-2'));
  assert.deepEqual(nextSyncBatch(second).map(x => x.mutationId), ['mut-1', 'mut-2']);
});

test('duplicate mutation ID is idempotent only for semantically identical data', () => {
  const base = enqueueMutation(createOutbox('synthetic-owner'), change('mut-1', 'sample-1', { payload: {a: 1,b:2} }));
  assert.equal(enqueueMutation(base, change('mut-1', 'sample-1', { payload: {b:2,a:1} })), base);
  assert.throws(() => enqueueMutation(base, change('mut-1','sample-2')), /reused/);
});

test('two pending edits to one entity are sent sequentially, never in same batch', () => {
  let s = createOutbox('synthetic-owner');
  s = enqueueMutation(s, change('mut-1', 'sample-1'));
  s = enqueueMutation(s, change('mut-2', 'sample-1'));
  s = enqueueMutation(s, change('mut-3', 'sample-2'));
  assert.deepEqual(nextSyncBatch(s).map(x=>x.mutationId), ['mut-1', 'mut-3']);
  assert.deepEqual(nextSyncBatch(s,1).map(x=>x.mutationId), ['mut-1']);
  assert.throws(() => nextSyncBatch(s,0), RangeError);
  assert.throws(() => nextSyncBatch(s,501), RangeError);
});

test('acceptance and already-applied acknowledgements remove only exact mutation IDs', () => {
  let s = createOutbox('synthetic-owner');
  s = enqueueMutation(s, change('mut-1', 'sample-1'));
  s = enqueueMutation(s, change('mut-2', 'sample-2'));
  s = applySyncReceipts(s,[{mutationId:'mut-1',result:'accepted',serverRevision:'rev1'}, {mutationId:'mut-2',result:'already_applied',serverRevision:'rev2'}]);
  assert.deepEqual(outboxCounts(s), { pending:0,conflicts:0 });
});

test('conflicts persist and prevent newer edits to same record from syncing', () => {
  let s = createOutbox('synthetic-owner');
  s = enqueueMutation(s, change('mut-1', 'sample-1'));
  s = enqueueMutation(s, change('mut-2', 'sample-1'));
  s = enqueueMutation(s, change('mut-3', 'sample-2'));
  s = applySyncReceipts(s,[{mutationId:'mut-1',result:'conflict',serverRevision:'rev9'}]);
  assert.deepEqual(outboxCounts(s), { pending:2,conflicts:1 });
  assert.deepEqual(nextSyncBatch(s).map(x=>x.mutationId), ['mut-3']);
  assert.equal(s.entries[0].conflictServerRevision,'rev9');
  assert.equal(s.entries[0].mutation.payload.label,'Fictional sample-1');
});

test('retry or lost response never silently marks a mutation as synced', () => {
  let s = enqueueMutation(createOutbox('synthetic-owner'),change('mut-1','sample-1'));
  const original = s;
  s = applySyncReceipts(s,[]);
  assert.equal(s,original);
  s = applySyncReceipts(s,[{mutationId:'mut-1',result:'retry'}]);
  assert.deepEqual(outboxCounts(s), { pending:1,conflicts:0 });
  assert.equal(nextSyncBatch(s)[0].mutationId,'mut-1');
});

test('malformed, unknown, duplicate, out-of-order and cross-profile input fail closed', () => {
  let s = enqueueMutation(createOutbox('synthetic-owner'),change('mut-1','sample-1'));
  s = enqueueMutation(s,change('mut-2','sample-1'));
  assert.throws(() => enqueueMutation(s,{...change('mut-3','sample-3'),profileId:'someone-else'}), /Cross-profile/);
  assert.throws(() => applySyncReceipts(s,[{mutationId:'unknown',result:'retry'}]), /Unexpected/);
  assert.throws(() => applySyncReceipts(s,[{mutationId:'mut-2',result:'accepted',serverRevision:'rev2'}]), /Out-of-order/);
  assert.throws(() => applySyncReceipts(s,[{mutationId:'mut-1',result:'retry'},{mutationId:'mut-1',result:'retry'}]), /Duplicated/);
  assert.deepEqual(outboxCounts(s), { pending:2,conflicts:0 });
});

test('delete tombstone contains no payload, remains queued until acknowledged', () => {
  const deletion = change('mut-del','sample-1',{ operation:'delete', payload: undefined });
  delete deletion.payload;
  let s = enqueueMutation(createOutbox('synthetic-owner'),deletion);
  assert.equal(nextSyncBatch(s)[0].operation,'delete');
  assert.equal(Object.hasOwn(nextSyncBatch(s)[0],'payload'),false);
  s = applySyncReceipts(s,[{mutationId:'mut-del',result:'accepted',serverRevision:'rev10'}]);
  assert.deepEqual(nextSyncBatch(s), []);
});

test('reject non-JSON payloads including cycles and prototype-poisoning keys', () => {
  const cyclic = {}; cyclic.self = cyclic;
  for(const payload of [cyclic, new Date(), {x:NaN}, {x:Infinity}, {x:undefined}, JSON.parse('{"__proto__":{"polluted":true}}')]) {
    assert.throws(() => enqueueMutation(createOutbox('synthetic-owner'),change('bad-1','sample-1',{payload})),/Invalid JSON payload/);
  }
  assert.throws(() => enqueueMutation(createOutbox('synthetic-owner'),change('bad-del','sample-1',{operation:'delete'})),/Delete cannot carry payload/);
});


test('serialization is fail-closed for accessors, symbols, non-index array properties and impossible dates', () => {
  const getter = {};
  Object.defineProperty(getter, 'sensitive', { enumerable: true, get() { throw new Error('getter should never execute'); } });
  const extras = [1, 2]; extras.additional = 'not represented by JSON';
  const withSymbol = { a: 1 }; withSymbol[Symbol('hidden')] = 'ignored';
  for (const payload of [getter, extras, withSymbol]) {
    assert.throws(() => enqueueMutation(createOutbox('synthetic-owner'),change('bad-2','sample-1',{payload})), /Invalid JSON payload/);
  }
  assert.throws(() => enqueueMutation(createOutbox('synthetic-owner'),change('bad-3','sample-1', {createdAtUtc:'2026-02-30T12:00:00Z'})),/Invalid UTC timestamp/);
  assert.throws(() => enqueueMutation(createOutbox('synthetic-owner'),change('bad-4','sample-1', {payload:'x'.repeat(262145)})), /Payload exceeds reference-model limit/);
});
