import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// Mirror only the Rust migration's SQLite transactional invariants.
// Node uses PLAIN in-memory SQLite and does NOT validate SQLCipher encryption.
const v1 = readFileSync(new URL('../contracts/sqlite/0001_local_outbox.sql', import.meta.url), 'utf8');
const v2 = readFileSync(new URL('../contracts/sqlite/0002_ack_ledger.sql', import.meta.url), 'utf8');
const CATALOG = `SELECT type,name,sql FROM sqlite_master
 WHERE type IN ('table','index','trigger','view') AND name NOT GLOB 'sqlite_*'
 ORDER BY type,name`;
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON;');
  db.exec(v1);
  return db;
}
function version(db) { return db.prepare('PRAGMA user_version').get().user_version; }
function catalog(db) { return db.prepare(CATALOG).all(); }
function verifiedV1(db) {
  const expected = fixture();
  try { return version(db) === 1 && JSON.stringify(catalog(db)) === JSON.stringify(catalog(expected)) && db.prepare('PRAGMA foreign_key_check').all().length===0; }
  finally { expected.close(); }
}
function verifiedV2(db) {
  const expected = fixture();
  try { expected.exec(v2); return version(db) === 2 && JSON.stringify(catalog(db)) === JSON.stringify(catalog(expected)) && db.prepare('PRAGMA foreign_key_check').all().length===0; }
  finally { expected.close(); }
}
function migrate(db, abort = false) {
  if (!verifiedV1(db)) throw Error('Unsupported v1 schema');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(v2);
    if (!verifiedV2(db)) throw Error('Invalid resulting v2 schema');
    if (abort) throw Error('Synthetic failure before commit');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
function seedPending(db) {
  db.exec("INSERT INTO local_profiles(profile_id) VALUES ('synthetic-a')");
  db.prepare(`INSERT INTO local_entities(profile_id,entity_type,entity_id,payload_json,local_revision)
    VALUES ('synthetic-a','subject','synthetic-1','{"label":"Fictional"}',1)`).run();
  db.prepare(`INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,payload_json,created_at_utc)
    VALUES ('synthetic-a','synthetic-m1','subject','synthetic-1','upsert','{"label":"Fictional"}','2026-11-11T00:00:00Z')`).run();
}

test('explicit v1-to-v2 migration preserves unsynced fictional data and FK integrity', () => {
  const db=fixture();try { seedPending(db);migrate(db);assert.equal(verifiedV2(db),true);
    assert.equal(db.prepare('SELECT count(*) AS n FROM local_outbox').get().n,1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM local_ack_ledger').get().n,0);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  } finally { db.close(); }
});
test('injected failure rolls back new ledger and user_version together', () => {
  const db=fixture();try { seedPending(db);assert.throws(()=>migrate(db,true),/Synthetic failure/);
    assert.equal(verifiedV1(db),true);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='local_ack_ledger'").get().n,0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM local_outbox').get().n,1);
  }finally {db.close();}
});
test('second v2 migration is refused rather than replayed', () => {
  const db=fixture();try {migrate(db);assert.throws(()=>migrate(db),/Unsupported v1 schema/);
    assert.equal(verifiedV2(db),true);
  }finally {db.close();}
});
test('v1 with renamed index is rejected even when user_version is still 1', () => {
  const db=fixture();try {db.exec('DROP INDEX local_outbox_profile_fifo; CREATE INDEX local_outbox_profile_fifo ON local_outbox(mutation_id)');
    assert.throws(()=>migrate(db),/Unsupported v1 schema/);assert.equal(version(db),1);
  }finally {db.close();}
});
test('v1 with orphan outbox record is rejected', () => {
  const db=fixture();try {db.exec("PRAGMA foreign_keys=OFF; INSERT INTO local_profiles(profile_id) VALUES ('synthetic-a')");
    db.prepare(`INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,payload_json,created_at_utc)
      VALUES ('synthetic-a','synthetic-m1','subject','synthetic-missing','upsert','{}','2026-11-11T00:00:00Z')`).run();
    assert.throws(()=>migrate(db),/Unsupported v1 schema/);
  }finally {db.close();}
});
