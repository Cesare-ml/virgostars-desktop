import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOutbox, enqueueMutation, nextSyncBatch, applySyncReceipts, outboxCounts,
  serializeOutboxSnapshot, restoreOutboxSnapshot,
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

test('enforces 256 KiB on serialized UTF-8 payload, not UTF-16 code units', () => {
  // JSON string quotes count toward the limit, including for ASCII.
  const max = 262144;
  const ascii = enqueueMutation(createOutbox('synthetic-owner'),
    change('ascii-exact', 'sample-1', {payload:'x'.repeat(max - 2)}));
  assert.equal(nextSyncBatch(ascii)[0].payload.length, max - 2);
  assert.throws(() => enqueueMutation(createOutbox('synthetic-owner'),
    change('ascii-over', 'sample-1', {payload:'x'.repeat(max - 1)})),
    /Payload exceeds reference-model limit/);

  // A single non-ASCII BMP scalar takes two UTF-8 bytes but one JS code unit.
  const bmpExact = enqueueMutation(createOutbox('synthetic-owner'),
    change('bmp-exact', 'sample-1', {payload:'é'.repeat((max - 2) / 2)}));
  assert.equal(nextSyncBatch(bmpExact)[0].payload.length, (max - 2) / 2);
  assert.throws(() => enqueueMutation(createOutbox('synthetic-owner'),
    change('bmp-over', 'sample-1', {payload:'é'.repeat(max / 2)})),
    /Payload exceeds reference-model limit/);

  // Astral Unicode is two JS code units but four UTF-8 bytes per scalar.
  assert.throws(() => enqueueMutation(createOutbox('synthetic-owner'),
    change('emoji-over', 'sample-1', {payload:'🔭'.repeat(80000)})),
    /Payload exceeds reference-model limit/);
});

test('receipts accept only explicit own data properties for every status', () => {
  const original = enqueueMutation(createOutbox('synthetic-owner'), change('mut-1','sample-1'));
  const retry = Object.assign(Object.create(null), {mutationId:'mut-1', result:'retry'});
  assert.equal(applySyncReceipts(original, [retry]).entries.length, 1);
  assert.equal(applySyncReceipts(original, [
    {mutationId:'mut-1', result:'accepted', serverRevision:'rev2'},
  ]).entries.length, 0);
  assert.equal(applySyncReceipts(original, [
    {mutationId:'mut-1', result:'already_applied', serverRevision:'rev2'},
  ]).entries.length, 0);
  const conflict = applySyncReceipts(original, [
    {mutationId:'mut-1', result:'conflict', serverRevision:null},
  ]);
  assert.equal(conflict.entries[0].state, 'conflict');
  assert.equal(conflict.entries[0].conflictServerRevision, null);
});

test('malformed and accessor-backed receipts cannot acknowledge pending local edits', () => {
  const original = enqueueMutation(createOutbox('synthetic-owner'), change('mut-1', 'sample-1'));
  let getterCalls = 0;
  const withGetter = (key) => {
    const receipt = {mutationId:'mut-1', result:'accepted', serverRevision:'rev2'};
    Object.defineProperty(receipt, key, {
      enumerable:true,
      get() { getterCalls++; return key === 'result' ? 'accepted' : 'mut-1'; },
    });
    return receipt;
  };
  const forged = [
    withGetter('mutationId'), withGetter('result'), withGetter('serverRevision'),
    Object.assign(Object.create({mutationId:'mut-1'}), {result:'accepted',serverRevision:'rev2'}),
    {mutationId:'mut-1',result:'retry',serverRevision:'rev2'},
    {mutationId:'mut-1',result:'accepted'},
    {mutationId:'mut-1',result:'accepted',serverRevision:null},
    {mutationId:'mut-1',result:'accepted',serverRevision:'rev2',unexpected:true},
    [ {mutationId:'mut-1',result:'accepted',serverRevision:'rev2'} ],
    JSON.parse('{"mutationId":"mut-1","result":"retry","__proto__":{}}'),
    Object.defineProperty({mutationId:'mut-1',result:'retry'}, 'hidden', {value:'x'}),
    new (class Receipt { constructor() { this.mutationId='mut-1'; this.result='retry'; } })(),
  ];
  const withSymbol = {mutationId:'mut-1',result:'retry'};
  withSymbol[Symbol('extra')] = 1;
  forged.push(withSymbol);
  for (const receipt of forged) {
    assert.throws(() => applySyncReceipts(original,[receipt]), /Invalid sync receipt/);
    assert.deepEqual(outboxCounts(original), {pending:1, conflicts:0});
  }
  assert.equal(getterCalls,0,'accessor getters must never be invoked');
});

test('invalid second receipt cannot partially apply the first acknowledgement', () => {
  let state = createOutbox('synthetic-owner');
  state = enqueueMutation(state, change('mut-1','sample-1'));
  state = enqueueMutation(state, change('mut-2','sample-2'));
  assert.throws(() => applySyncReceipts(state, [
    {mutationId:'mut-1',result:'accepted',serverRevision:'rev2'},
    {mutationId:'mut-2',result:'retry',serverRevision:'unexpected'},
  ]), /Invalid sync receipt/);
  assert.deepEqual(nextSyncBatch(state).map(x => x.mutationId), ['mut-1','mut-2']);
});

test('mutation envelope accepts only a stable own data-only snapshot', () => {
  const normal = change('mut-stable', 'sample-1');
  const nullPrototype = Object.assign(Object.create(null), normal);
  const state = enqueueMutation(createOutbox('synthetic-owner'), nullPrototype);
  assert.equal(state.entries[0].mutation.mutationId, 'mut-stable');
  assert.equal(state.entries[0].mutation.payload.label, 'Fictional sample-1');
  assert.equal(Object.isFrozen(state.entries[0].mutation), true);
  assert.deepEqual(nextSyncBatch(state).map(x => x.mutationId), ['mut-stable']);
});

test('mutation fields with getters cannot alter validated IDs, profile or payload', () => {
  const original = createOutbox('synthetic-owner');
  let invoked = 0;
  for (const key of ['profileId', 'mutationId', 'entityType', 'entityId',
    'operation', 'baseServerRevision', 'createdAtUtc', 'payload']) {
    const mutation = change('mut-getter', 'sample-1');
    Object.defineProperty(mutation, key, {
      enumerable: true,
      get() {
        invoked++;
        return key === 'payload' ? {label:'unexpected'} : 'mut-changed';
      },
    });
    assert.throws(() => enqueueMutation(original, mutation), /Invalid sync mutation/);
    assert.deepEqual(outboxCounts(original), {pending:0, conflicts:0});
  }
  assert.equal(invoked, 0, 'the reference model must never call envelope getters');
});

test('reject unexpected, inherited, symbol and nonenumerable mutation fields', () => {
  const original = createOutbox('synthetic-owner');
  const hidden = change('mut-hidden', 'sample-1');
  Object.defineProperty(hidden, 'secret', {value:'must not be copied'});
  const symbol = change('mut-symbol', 'sample-1');
  symbol[Symbol('private')] = 'hidden';
  const inherited = Object.create({mutationId:'mut-inherited'});
  Object.assign(inherited, change('mut-inherited', 'sample-1'));
  delete inherited.mutationId;
  const nonEnumerable = change('mut-nonenumerable', 'sample-1');
  Object.defineProperty(nonEnumerable, 'mutationId', {
    value:nonEnumerable.mutationId, enumerable:false,
  });
  const missing = change('mut-missing', 'sample-1');
  delete missing.createdAtUtc;
  const extra = {...change('mut-extra', 'sample-1'), unexpected:true};
  for (const unsafe of [hidden, symbol, inherited, nonEnumerable, missing, extra,
    [change('mut-array', 'sample-1')]]) {
    assert.throws(() => enqueueMutation(original, unsafe), /Invalid sync mutation/);
  }
  assert.equal(outboxCounts(original).pending, 0);
});

test('malformed second mutation never changes an already frozen outbox', () => {
  const original = enqueueMutation(createOutbox('synthetic-owner'),
    change('mut-1', 'sample-1'));
  const incoming = change('mut-2', 'sample-2');
  Object.defineProperty(incoming, 'mutationId', {get() {throw new Error('sensitive detail');}});
  assert.throws(() => enqueueMutation(original, incoming), /Invalid sync mutation/);
  assert.deepEqual(nextSyncBatch(original).map(x => x.mutationId), ['mut-1']);
  assert.equal(original.entries[0].mutation.payload.label, 'Fictional sample-1');
});

test('ACK batch accepts dense arrays, frozen arrays and its 500-receipt boundary', () => {
  const original = enqueueMutation(createOutbox('synthetic-owner'), change('mut-1', 'sample-1'));
  assert.equal(applySyncReceipts(original, []), original, 'an empty batch is a no-op');
  assert.equal(applySyncReceipts(original, Object.freeze([
    Object.freeze({mutationId:'mut-1',result:'accepted',serverRevision:'rev1'}),
  ])).entries.length, 0);

  let many = createOutbox('synthetic-owner');
  for (let i = 0; i < 500; i++) {
    many = enqueueMutation(many, change('bulk-' + i, 'sample-' + i));
  }
  const all = nextSyncBatch(many, 500).map(mutation => ({
    mutationId: mutation.mutationId, result:'accepted', serverRevision:'rev-final',
  }));
  assert.equal(all.length, 500);
  assert.deepEqual(outboxCounts(applySyncReceipts(many, all)), {pending:0, conflicts:0});
  assert.deepEqual(outboxCounts(many), {pending:500, conflicts:0});
});

test('ACK batches reject sparse, oversized and non-array containers before mutation', () => {
  const original = enqueueMutation(createOutbox('synthetic-owner'), change('mut-1','sample-1'));
  const receipt = {mutationId:'mut-1',result:'accepted',serverRevision:'rev2'};
  const holes = new Array(2);
  holes[1] = receipt;
  const inherited = [receipt];
  Object.setPrototypeOf(inherited, null);
  const withExtra = [receipt];
  Object.defineProperty(withExtra, 'hidden', {value:'not a receipt'});
  const withSymbol = [receipt];
  withSymbol[Symbol('metadata')] = true;
  const long = new Array(501);
  const replacedIterator = [receipt];
  let iteratorCalls = 0;
  Object.defineProperty(replacedIterator, Symbol.iterator, {
    value() { iteratorCalls++; throw new Error('should not iterate'); },
  });
  const cases = [null, undefined, {}, new Set([receipt]), 'not an array',
    holes, inherited, withExtra, withSymbol, long, replacedIterator];
  for (const malformed of cases) {
    assert.throws(() => applySyncReceipts(original, malformed), /Invalid sync receipt batch/);
    assert.deepEqual(nextSyncBatch(original).map(x => x.mutationId), ['mut-1']);
  }
  assert.equal(iteratorCalls, 0, 'no untrusted iterator may execute');
});

test('ACK batch never invokes indexed getters or applies earlier successful receipts', () => {
  let original = createOutbox('synthetic-owner');
  original = enqueueMutation(original, change('mut-1','sample-1'));
  original = enqueueMutation(original, change('mut-2','sample-2'));
  let calls = 0;
  const batch = [
    {mutationId:'mut-1',result:'accepted',serverRevision:'rev1'},
    {mutationId:'mut-2',result:'accepted',serverRevision:'rev2'},
  ];
  Object.defineProperty(batch, '1', {
    configurable:true,
    enumerable:true,
    get() { calls++; return {mutationId:'mut-2',result:'accepted',serverRevision:'rev2'}; },
  });
  assert.throws(() => applySyncReceipts(original, batch), /Invalid sync receipt batch/);
  assert.equal(calls, 0);
  assert.deepEqual(nextSyncBatch(original).map(x => x.mutationId), ['mut-1','mut-2']);
});

test('synthetic snapshot restores pending, conflicts and FIFO blockers after restart', () => {
  let live = createOutbox('synthetic-owner');
  live = enqueueMutation(live, change('first', 'one'));
  live = enqueueMutation(live, change('second', 'one'));
  live = enqueueMutation(live, change('third', 'two'));
  live = applySyncReceipts(live, [
    {mutationId:'first', result:'conflict', serverRevision:'server9'},
  ]);
  const serialized = serializeOutboxSnapshot(live);
  const restored = restoreOutboxSnapshot(serialized, 'synthetic-owner');
  assert.deepEqual(restored, live);
  assert.notEqual(restored, live);
  assert.equal(Object.isFrozen(restored), true);
  assert.equal(Object.isFrozen(restored.entries[0].mutation.payload), true);
  assert.equal(restored.entries[0].conflictServerRevision, 'server9');
  assert.deepEqual(nextSyncBatch(restored).map(x => x.mutationId), ['third']);
  assert.equal(serializeOutboxSnapshot(restored), serialized);
  // Recovered queue remains persistent across a new pending write in the pure model.
  const after = enqueueMutation(restored, change('fourth', 'three'));
  assert.deepEqual(nextSyncBatch(after).map(x => x.mutationId), ['third','fourth']);
  assert.deepEqual(outboxCounts(live), {pending:2,conflicts:1});
});

test('synthetic snapshot restores deletion tombstones and null conflict revisions', () => {
  const deleted = change('gone', 'sample-1', {operation:'delete'});
  delete deleted.payload;
  let live = enqueueMutation(createOutbox('synthetic-owner'), deleted);
  live = enqueueMutation(live, change('other','sample-2'));
  live = applySyncReceipts(live, [{mutationId:'other',result:'conflict',serverRevision:null}]);
  const restored = restoreOutboxSnapshot(serializeOutboxSnapshot(live), 'synthetic-owner');
  assert.equal(Object.hasOwn(restored.entries[0].mutation, 'payload'), false);
  assert.equal(restored.entries[1].conflictServerRevision, null);
  assert.deepEqual(nextSyncBatch(restored).map(x=>x.mutationId), ['gone']);
});

test('snapshot decoder rejects bad schema, cross-profile and forged entry shapes', () => {
  let state = enqueueMutation(createOutbox('synthetic-owner'),change('mut-1','sample-1'));
  state = enqueueMutation(state,change('mut-2','sample-1'));
  const json = serializeOutboxSnapshot(state);
  assert.throws(() => restoreOutboxSnapshot('{', 'synthetic-owner'), /Invalid outbox snapshot/);
  assert.throws(() => restoreOutboxSnapshot(json, 'another-owner'), /Cross-profile/);
  const parsed = JSON.parse(json);
  const mutate = (fn) => {
    const clone = JSON.parse(json);
    fn(clone);
    return JSON.stringify(clone);
  };
  assert.throws(() => restoreOutboxSnapshot(mutate(x => {x.schemaVersion=2;}), 'synthetic-owner'), /Unsupported outbox snapshot version/);
  assert.throws(() => restoreOutboxSnapshot(mutate(x => {x.extra='not allowed';}), 'synthetic-owner'), /Invalid outbox snapshot/);
  assert.throws(() => restoreOutboxSnapshot(mutate(x => {x.entries[0].extra='not allowed';}), 'synthetic-owner'), /Invalid outbox snapshot entry/);
  assert.throws(() => restoreOutboxSnapshot(mutate(x => {x.entries[0].state='unknown';}), 'synthetic-owner'), /Invalid outbox snapshot entry/);
  assert.throws(() => restoreOutboxSnapshot(mutate(x => {x.entries[0].conflictServerRevision='server2';}), 'synthetic-owner'), /Invalid outbox snapshot entry/);
  assert.throws(() => restoreOutboxSnapshot(mutate(x => {delete x.entries[0].mutation.mutationId;}), 'synthetic-owner'), /Invalid outbox snapshot entry/);
  assert.throws(() => restoreOutboxSnapshot(mutate(x => {x.entries[0].mutation.profileId='another-owner';}), 'synthetic-owner'), /Invalid outbox snapshot entry/);
  assert.throws(() => restoreOutboxSnapshot(mutate(x => {x.entries[1].mutation.mutationId='mut-1';}), 'synthetic-owner'), /Duplicate outbox snapshot mutation ID/);
  assert.throws(() => restoreOutboxSnapshot(mutate(x => {
    x.entries[1].state='conflict'; x.entries[1].conflictServerRevision='server2';
  }), 'synthetic-owner'), /Invalid outbox snapshot conflict order/);
  assert.throws(() => restoreOutboxSnapshot(mutate(x => {
    x.entries[0].state='conflict'; x.entries[0].conflictServerRevision='';
  }), 'synthetic-owner'), /Invalid outbox snapshot conflict revision/);
  assert.throws(() => restoreOutboxSnapshot(mutate(x => {
    x.entries[0].mutation.payload = JSON.parse('{"__proto__":{"unsafe":true}}');
  }), 'synthetic-owner'), /Invalid outbox snapshot entry/);
  assert.deepEqual(outboxCounts(state), {pending:2,conflicts:0});
  assert.deepEqual(JSON.parse(json), parsed);
});

test('snapshot decoding refuses excessive entry counts and UTF-8 byte length', () => {
  const empty = serializeOutboxSnapshot(createOutbox('synthetic-owner'));
  assert.deepEqual(outboxCounts(restoreOutboxSnapshot(empty,'synthetic-owner')), {pending:0, conflicts:0});
  assert.throws(() => restoreOutboxSnapshot(
    JSON.stringify({schemaVersion:1, profileId:'synthetic-owner', entries:Array(1001).fill(null)}),
    'synthetic-owner',
  ), /Invalid outbox snapshot/);
  assert.throws(() => serializeOutboxSnapshot({
    profileId:'synthetic-owner', entries:Array(1001).fill(null),
  }), /Outbox snapshot exceeds reference-model limit/);
  // Under the UTF-16 code unit cap but over 8 MiB of serialized UTF-8 bytes.
  assert.throws(() => restoreOutboxSnapshot('é'.repeat(4_194_305), 'synthetic-owner'),
    /Outbox snapshot exceeds reference-model limit/);
});
