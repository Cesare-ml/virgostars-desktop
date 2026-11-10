import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// Synthetic-only SQL contract regression. This is NOT a Rust/SQLCipher test.
const schema = readFileSync(new URL('../contracts/sqlite/0001_local_outbox.sql', import.meta.url), 'utf8');
const PROFILE = 'synthetic-owner';
const CLOCK = '2026-11-11T00:00:00Z';
const next = `SELECT o.mutation_id FROM local_outbox o
  INNER JOIN local_entities e ON e.profile_id=o.profile_id
    AND e.entity_type=o.entity_type AND e.entity_id=o.entity_id
  WHERE o.profile_id=? AND o.state='pending'
    AND o.base_server_revision IS e.server_revision
    AND NOT EXISTS (SELECT 1 FROM local_outbox old
      WHERE old.profile_id=o.profile_id AND old.entity_type=o.entity_type
      AND old.entity_id=o.entity_id AND old.sequence<o.sequence)
  ORDER BY o.sequence LIMIT ?`;

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON;');
  db.exec(schema);
  db.prepare('INSERT INTO local_profiles(profile_id) VALUES (?)').run(PROFILE);
  return db;
}
function stage(db, id, mutation, operation = 'upsert') {
  const json = operation === 'delete' ? null : JSON.stringify({ label: 'Fictional ' + mutation });
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO local_entities(profile_id,entity_type,entity_id,payload_json,locally_deleted,local_revision)
      VALUES (?,'subject',?,?,?,1) ON CONFLICT(profile_id,entity_type,entity_id)
      DO UPDATE SET payload_json=excluded.payload_json,locally_deleted=excluded.locally_deleted,
        local_revision=local_entities.local_revision+1`)
      .run(PROFILE, id, json, operation === 'delete' ? 1 : 0);
    const revision = db.prepare(`SELECT server_revision FROM local_entities
      WHERE profile_id=? AND entity_type='subject' AND entity_id=?`).get(PROFILE, id).server_revision;
    db.prepare(`INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,payload_json,
      base_server_revision,created_at_utc) VALUES (?,?,'subject',?,?,?,?,?)`)
      .run(PROFILE, mutation, id, operation, json, revision, CLOCK);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
const batch = db => db.prepare(next).all(PROFILE, 50).map(row => row.mutation_id);

test('one same-entity mutation is eligible, unrelated entities can proceed', () => {
  const db = fixture();
  try {
    stage(db, 'synthetic-a', 'synthetic-first');
    stage(db, 'synthetic-a', 'synthetic-second');
    stage(db, 'synthetic-b', 'synthetic-third');
    assert.deepEqual(batch(db), ['synthetic-first', 'synthetic-third']);
    db.prepare(`UPDATE local_entities SET server_revision='rev-1'
      WHERE profile_id=? AND entity_id='synthetic-a'`).run(PROFILE);
    db.prepare('DELETE FROM local_outbox WHERE mutation_id=?').run('synthetic-first');
    assert.deepEqual(batch(db), ['synthetic-third']);
    assert.equal(db.prepare(`SELECT base_server_revision FROM local_outbox
      WHERE mutation_id='synthetic-second'`).get().base_server_revision, null);
  } finally { db.close(); }
});

test('a fresh mutation after ACK records the advanced server revision', () => {
  const db = fixture();
  try {
    stage(db, 'synthetic-a', 'synthetic-first');
    db.prepare(`UPDATE local_entities SET server_revision='rev-2'
      WHERE profile_id=? AND entity_id='synthetic-a'`).run(PROFILE);
    db.prepare('DELETE FROM local_outbox WHERE mutation_id=?').run('synthetic-first');
    stage(db, 'synthetic-a', 'synthetic-fresh');
    assert.deepEqual(batch(db), ['synthetic-fresh']);
    assert.equal(db.prepare(`SELECT base_server_revision FROM local_outbox
      WHERE mutation_id='synthetic-fresh'`).get().base_server_revision, 'rev-2');
  } finally { db.close(); }
});

test('remote upsert clears an already acknowledged delete tombstone', () => {
  const db = fixture();
  try {
    stage(db, 'synthetic-a', 'synthetic-delete', 'delete');
    db.prepare('DELETE FROM local_outbox WHERE mutation_id=?').run('synthetic-delete');
    assert.equal(db.prepare(`SELECT locally_deleted FROM local_entities WHERE entity_id='synthetic-a'`).get().locally_deleted, 1);
    db.prepare(`INSERT INTO local_entities(profile_id,entity_type,entity_id,payload_json,server_revision)
      VALUES (?,'subject',?,?,'remote-1')
      ON CONFLICT(profile_id,entity_type,entity_id) DO UPDATE SET
      payload_json=excluded.payload_json,locally_deleted=0,server_revision=excluded.server_revision`)
      .run(PROFILE, 'synthetic-a', '{"label":"Synthetic remote"}');
    const row = db.prepare(`SELECT locally_deleted,server_revision FROM local_entities
      WHERE entity_id='synthetic-a'`).get();
    assert.equal(row.locally_deleted, 0);
    assert.equal(row.server_revision, 'remote-1');
  } finally { db.close(); }
});

test('conflict rows and bad base revisions cannot release blocked edits', () => {
  const db = fixture();
  try {
    stage(db, 'synthetic-a', 'synthetic-first');
    stage(db, 'synthetic-a', 'synthetic-second');
    db.prepare(`UPDATE local_outbox SET state='conflict', conflict_server_revision='remote-r1'
      WHERE mutation_id='synthetic-first'`).run();
    assert.deepEqual(batch(db), []);
    db.prepare(`DELETE FROM local_outbox WHERE mutation_id='synthetic-first'`).run();
    db.prepare(`UPDATE local_entities SET server_revision='remote-r1'
      WHERE profile_id=? AND entity_id='synthetic-a'`).run(PROFILE);
    assert.deepEqual(batch(db), []);
  } finally { db.close(); }
});
