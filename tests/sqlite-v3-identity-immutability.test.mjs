// Synthetic-only full-schema SQLite v3 identity regression; NOT SQLCipher.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const A='synthetic-a', B='synthetic-b', FIRST='synthetic-first', SECOND='synthetic-second';
const TIME='2026-11-11T21:30:00Z';
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for(const filename of ['0001_local_outbox.sql','0002_ack_ledger.sql','0003_conflict_decisions.sql']) {
    db.exec(readFileSync(new URL('../contracts/sqlite/'+filename,import.meta.url),'utf8'));
  }
  for(const id of [A,B]) db.prepare('INSERT INTO local_profiles(profile_id) VALUES (?)').run(id);
  for(const [profile,entity] of [[A,'synthetic-e1'],[A,'synthetic-e2'],[B,'synthetic-e1']]) {
    db.prepare("INSERT INTO local_entities(profile_id,entity_type,entity_id,payload_json,local_revision) VALUES (?,'subject',?,'{\"label\":\"Fictional\"}',1)").run(profile,entity);
  }
  db.prepare("INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,payload_json,created_at_utc) VALUES (?,?,'subject','synthetic-e1','upsert','{\"label\":\"Fictional\"}',?)").run(A,FIRST,TIME);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,3);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  return db;
}
function row(db) {return db.prepare('SELECT profile_id,mutation_id,entity_type,entity_id,state,conflict_server_revision FROM local_outbox WHERE mutation_id=?').get(FIRST);}

test('v3 refuses a direct change of queued mutation ID',()=>{const db=setup();try{
  assert.throws(()=>db.prepare('UPDATE local_outbox SET mutation_id=? WHERE mutation_id=?').run(SECOND,FIRST),/queued mutation identity is immutable/);
  assert.equal(row(db).mutation_id,FIRST);
}finally{db.close();}});
test('v3 refuses moving a queued intent to a different entity',()=>{const db=setup();try{
  assert.throws(()=>db.prepare('UPDATE local_outbox SET entity_id=? WHERE mutation_id=?').run('synthetic-e2',FIRST),/queued mutation identity is immutable/);
  assert.equal(row(db).entity_id,'synthetic-e1');
}finally{db.close();}});
test('v3 refuses moving a queued intent across profiles even with matching entity',()=>{const db=setup();try{
  assert.throws(()=>db.prepare('UPDATE local_outbox SET profile_id=? WHERE mutation_id=?').run(B,FIRST),/queued mutation identity is immutable/);
  assert.equal(row(db).profile_id,A);
}finally{db.close();}});
test('v3 refuses changing entity type even when the replacement type is valid',()=>{const db=setup();try{
  assert.throws(()=>db.prepare('UPDATE local_outbox SET entity_type=? WHERE mutation_id=?').run('note',FIRST),/queued mutation identity is immutable/);
  assert.equal(row(db).entity_type,'subject');
}finally{db.close();}});
test('a no-op identity update remains legal and produces no schema error',()=>{const db=setup();try{
  const result=db.prepare('UPDATE local_outbox SET mutation_id=mutation_id, profile_id=profile_id WHERE mutation_id=?').run(FIRST);
  assert.equal(Number(result.changes),1);assert.equal(row(db).mutation_id,FIRST);
}finally{db.close();}});
test('normal conflict state and remote revision updates remain permitted',()=>{const db=setup();try{
  db.prepare("UPDATE local_outbox SET state='conflict', conflict_server_revision='rev-new' WHERE mutation_id=?").run(FIRST);
  assert.equal(row(db).state,'conflict');assert.equal(row(db).conflict_server_revision,'rev-new');
  db.prepare("UPDATE local_outbox SET state='pending', conflict_server_revision=NULL WHERE mutation_id=?").run(FIRST);
  assert.equal(row(db).state,'pending');assert.equal(row(db).conflict_server_revision,null);
}finally{db.close();}});
test('queued mutation ID cannot be replaced with an existing ACK ID',()=>{const db=setup();try{
  db.prepare("INSERT INTO local_ack_ledger(profile_id,mutation_id,entity_type,entity_id,request_fingerprint,result,server_revision,acknowledged_at_utc) VALUES (?,?,'subject','synthetic-e1',?,'accepted','rev-new',?)").run(A,SECOND,'a'.repeat(64),TIME);
  assert.throws(()=>db.prepare('UPDATE local_outbox SET mutation_id=? WHERE mutation_id=?').run(SECOND,FIRST),/queued mutation identity is immutable/);
  assert.equal(row(db).mutation_id,FIRST);
}finally{db.close();}});
test('historical original mutation ID cannot be resurrected by UPDATE or INSERT',()=>{const db=setup();try{
  db.prepare('DELETE FROM local_outbox WHERE mutation_id=?').run(FIRST);
  db.prepare("INSERT INTO local_conflict_decisions(profile_id,original_mutation_id,original_fingerprint,entity_type,entity_id,original_operation,original_payload_json,original_created_at_utc,replacement_mutation_id,remote_revision,choice,decided_at_utc) VALUES (?,?,?,'subject','synthetic-e1','upsert','{\"label\":\"Fictional\"}',?,?,'rev-new','keep_local',?)").run(A,FIRST,'a'.repeat(64),TIME,'synthetic-replacement',TIME);
  db.prepare("INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,payload_json,created_at_utc) VALUES (?,?,'subject','synthetic-e1','upsert','{\"label\":\"Fictional\"}',?)").run(A,SECOND,TIME);
  assert.throws(()=>db.prepare('UPDATE local_outbox SET mutation_id=? WHERE mutation_id=?').run(FIRST,SECOND),/queued mutation identity is immutable/);
  assert.throws(()=>db.prepare("INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,payload_json,created_at_utc) VALUES (?,?,'subject','synthetic-e1','upsert','{\"label\":\"Fictional\"}',?)").run(A,FIRST,TIME),/already used mutation id/);
  assert.equal(db.prepare('SELECT mutation_id FROM local_outbox').get().mutation_id,SECOND);
}finally{db.close();}});
test('schema integrity and FK checks still pass after legal state change',()=>{const db=setup();try{
  db.prepare("UPDATE local_outbox SET state='conflict',conflict_server_revision='rev-new'").run();
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name='local_outbox_v3_identity_immutable'").get().n,1);
}finally{db.close();}});
