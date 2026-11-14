import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// All data is fictional. node:sqlite is plaintext: this is NEVER a user DB.
const v1 = readFileSync(new URL('../contracts/sqlite/0001_local_outbox.sql', import.meta.url), 'utf8');
const v2 = readFileSync(new URL('../contracts/sqlite/0002_ack_ledger.sql', import.meta.url), 'utf8');
const A = 'fictional-owner-a';
const B = 'fictional-owner-b';
const TIME = '2026-11-14T12:00:00Z';
const LABEL = JSON.stringify({label: 'Synthetic chart subject'});
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function open(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL;');
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  return db;
}
function transaction(db, action) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = action(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
function migrateV2(db, failBeforeCommit = false) {
  if (db.prepare('PRAGMA user_version').get().user_version !== 1) throw Error('Unknown migration source');
  transaction(db, () => {
    db.exec(v2);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    if (failBeforeCommit) throw Error('Synthetic migration interruption');
  });
}
function fixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'virgostars-fictional-ack-'));
  const file = join(dir, 'synthetic-plaintext.sqlite');
  const db = open(file);
  try {
    db.exec(v1);
    for (const id of [A, B]) db.prepare('INSERT INTO local_profiles(profile_id) VALUES (?)').run(id);
    return fn(db, file);
  } finally {
    try { db.close(); } finally { rmSync(dir, {recursive:true, force:true}); }
  }
}
function queue(db, {profile=A, id='mutation-1', entity='subject-1'} = {}) {
  return transaction(db, () => {
    db.prepare(`INSERT INTO local_entities(profile_id,entity_type,entity_id,payload_json,local_revision)
      VALUES (?,'subject',?,?,1) ON CONFLICT(profile_id,entity_type,entity_id)
      DO UPDATE SET payload_json=excluded.payload_json,local_revision=local_entities.local_revision+1`)
      .run(profile, entity, LABEL);
    db.prepare(`INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,payload_json,created_at_utc)
      VALUES (?,?,'subject',?,'upsert',?,?)`)
      .run(profile, id, entity, LABEL, TIME);
  });
}
function ack(db, {profile=A, id='mutation-1', revision='remote-rev-1', kind='accepted'} = {}) {
  if (!IDENTIFIER.test(id) || !IDENTIFIER.test(revision) || !['accepted','already_applied'].includes(kind)) {
    throw Error('Invalid ACK fixture');
  }
  return transaction(db, () => {
    const mutation = db.prepare(`SELECT sequence,entity_type,entity_id,state FROM local_outbox
      WHERE profile_id=? AND mutation_id=?`).get(profile,id);
    if (!mutation) {
      const prior = db.prepare('SELECT server_revision FROM local_ack_ledger WHERE profile_id=? AND mutation_id=?')
        .get(profile,id);
      if (prior && prior.server_revision === revision) return 'replayed';
      throw Error('Unknown ACK or server revision mismatch');
    }
    if (mutation.state !== 'pending') throw Error('Unresolved conflict');
    const oldest = db.prepare(`SELECT MIN(sequence) AS first FROM local_outbox
      WHERE profile_id=? AND entity_type=? AND entity_id=?`).get(profile,mutation.entity_type,mutation.entity_id).first;
    if (oldest !== mutation.sequence) throw Error('Out-of-order ACK');
    // The revision, permanent idempotency record and outbox deletion commit together.
    db.prepare(`UPDATE local_entities SET server_revision=?
      WHERE profile_id=? AND entity_type=? AND entity_id=?`)
      .run(revision, profile,mutation.entity_type,mutation.entity_id);
    db.prepare('INSERT INTO local_ack_ledger(profile_id,mutation_id,server_revision) VALUES (?,?,?)')
      .run(profile,id,revision);
    db.prepare('DELETE FROM local_outbox WHERE profile_id=? AND mutation_id=?').run(profile,id);
    return 'applied';
  });
}

// The v1 schema is deliberately not modified or re-applied after migration.
test('v1 -> v2 preserves pre-existing edits and foreign-key integrity', () => fixture((db) => {
  queue(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);
  migrateV2(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,2);
  assert.equal(db.prepare('SELECT mutation_id FROM local_outbox').get().mutation_id,'mutation-1');
  assert.equal(db.prepare('PRAGMA cipher_version').all().length,0,'fixture remains plaintext, NOT SQLCipher');
  assert.throws(() => migrateV2(db), /Unknown migration source/);
}));

test('durable ledger makes accepted and already-applied responses idempotent across reopen', () => fixture((db,file) => {
  migrateV2(db);
  queue(db);
  assert.equal(ack(db),'applied');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM local_outbox').get().n,0);
  const reopened = open(file);
  try {
    assert.equal(reopened.prepare('PRAGMA user_version').get().user_version,2);
    assert.equal(ack(reopened,{kind:'already_applied'}),'replayed');
    assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM local_ack_ledger').get().n,1);
    assert.equal(reopened.prepare('SELECT server_revision FROM local_entities WHERE profile_id=? AND entity_id=?').get(A,'subject-1').server_revision,'remote-rev-1');
  } finally {reopened.close();}
}));

test('old ACK replay cannot overwrite a subsequent local edit or revision', () => fixture(db => {
  migrateV2(db); queue(db); ack(db);
  queue(db,{id:'mutation-2'});
  assert.equal(ack(db),'replayed');
  assert.equal(db.prepare('SELECT mutation_id FROM local_outbox').get().mutation_id,'mutation-2');
  assert.equal(db.prepare('SELECT server_revision FROM local_entities WHERE profile_id=? AND entity_id=?').get(A,'subject-1').server_revision,'remote-rev-1');
}));

test('mismatched or unknown replay rejects without changing ledger or local outbox', () => fixture(db => {
  migrateV2(db); queue(db); ack(db);
  assert.throws(() => ack(db,{revision:'remote-rev-2'}),/mismatch/);
  assert.throws(() => ack(db,{id:'never-enqueued'}),/Unknown ACK/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM local_ack_ledger').get().n,1);
}));

test('acked ID cannot be requeued in same profile, including through UPDATE', () => fixture(db => {
  migrateV2(db); queue(db); ack(db);
  assert.throws(() => queue(db), /Previously acknowledged mutation ID/);
  assert.equal(db.prepare('SELECT local_revision FROM local_entities WHERE profile_id=? AND entity_id=?').get(A,'subject-1').local_revision,1,
    'entity edit must roll back when outbox insert fails');
  queue(db,{id:'mutation-2'});
  assert.throws(() => db.prepare('UPDATE local_outbox SET mutation_id=? WHERE profile_id=? AND mutation_id=?')
    .run('mutation-1', A, 'mutation-2'), /Previously acknowledged mutation ID/);
  assert.equal(db.prepare('SELECT mutation_id FROM local_outbox').get().mutation_id,'mutation-2');
}));

test('same ID in independent profile is permitted, with independent revisions', () => fixture(db => {
  migrateV2(db); queue(db,{profile:A}); queue(db,{profile:B});
  assert.equal(ack(db,{profile:A}),'applied');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM local_outbox WHERE profile_id=?').get(B).n,1);
  assert.equal(ack(db,{profile:B,revision:'other-rev'}),'applied');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM local_ack_ledger').get().n,2);
  assert.equal(db.prepare('SELECT server_revision FROM local_ack_ledger WHERE profile_id=?').get(B).server_revision,'other-rev');
}));

test('simulated crash before ACK COMMIT restores outbox, revision and ledger together', () => fixture((db,file) => {
  migrateV2(db); queue(db);
  assert.throws(() => transaction(db, () => {
    db.prepare('UPDATE local_entities SET server_revision=? WHERE profile_id=? AND entity_id=?')
      .run('rev-before-crash', A, 'subject-1');
    db.prepare('INSERT INTO local_ack_ledger(profile_id,mutation_id,server_revision) VALUES (?,?,?)')
      .run(A,'mutation-1','rev-before-crash');
    db.prepare('DELETE FROM local_outbox WHERE profile_id=? AND mutation_id=?').run(A,'mutation-1');
    throw Error('Synthetic crash before COMMIT');
  }), /Synthetic crash/);
  const reopened = open(file);
  try {
    assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM local_outbox').get().n,1);
    assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM local_ack_ledger').get().n,0);
    assert.equal(reopened.prepare('SELECT server_revision FROM local_entities WHERE profile_id=? AND entity_id=?').get(A,'subject-1').server_revision,null);
  } finally {reopened.close();}
}));

test('second same-entity mutation cannot be acknowledged out of order', () => fixture(db => {
  migrateV2(db); queue(db); queue(db,{id:'mutation-2'});
  assert.throws(() => ack(db,{id:'mutation-2'}), /Out-of-order ACK/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM local_ack_ledger').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM local_outbox').get().n,2);
}));

test('v2 migration rollback preserves v1 schema/version; retry succeeds', () => fixture(db => {
  queue(db);
  assert.throws(() => migrateV2(db,true), /Synthetic migration interruption/);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name='local_ack_ledger'").get().n,0);
  migrateV2(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,2);
}));

test('unknown profile and empty revision are rejected by strict ledger constraints', () => fixture(db => {
  migrateV2(db);
  const sql = 'INSERT INTO local_ack_ledger(profile_id,mutation_id,server_revision) VALUES (?,?,?)';
  assert.throws(() => db.prepare(sql).run('unowned','mutation-1','rev'), /constraint/i);
  assert.throws(() => db.prepare(sql).run(A,'mutation-1',''), /constraint/i);
  assert.doesNotThrow(() => db.prepare(sql).run(A,'mutation-1','rev'));
  assert.throws(() => db.prepare(sql).run(A,'mutation-1','rev'), /constraint/i);
}));
