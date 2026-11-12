// Fictional full-v3 reference: INSERT OR REPLACE must never rewrite queued intents.
// This is plaintext SQLite, not a SQLCipher native test or production migration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const A='synthetic-a', B='synthetic-b', E='synthetic-e1', M='synthetic-m1';
const TIME='2026-11-11T21:30:00Z';
const OLD='{"label":"Original fictional"}', FORGED='{"label":"Forged"}';
function open(){
 const db=new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON');
 for(const name of ['0001_local_outbox.sql','0002_ack_ledger.sql','0003_conflict_decisions.sql'])
  db.exec(readFileSync(new URL('../contracts/sqlite/'+name,import.meta.url),'utf8'));
 for(const p of [A,B]){
  db.prepare('INSERT INTO local_profiles(profile_id) VALUES (?)').run(p);
  db.prepare("INSERT INTO local_entities(profile_id,entity_type,entity_id,payload_json,local_revision) VALUES (?,'subject',?,?,1)").run(p,E,OLD);
 }
 enqueue(db,A,M,OLD);return db;
}
function enqueue(db,profile,mutation,payload){
 return db.prepare("INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,payload_json,created_at_utc) VALUES (?,?,'subject',?,'upsert',?,?)")
  .run(profile,mutation,E,payload,TIME);
}
const replaceSql="INSERT OR REPLACE INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,payload_json,created_at_utc) VALUES (?,?,'subject',?,'upsert',?,?)";
const replaceSeqSql="INSERT OR REPLACE INTO local_outbox(sequence,profile_id,mutation_id,entity_type,entity_id,operation,payload_json,created_at_utc) VALUES (?,?,?,'subject',?,'upsert',?,?)";
const select="SELECT sequence,profile_id,mutation_id,entity_type,entity_id,operation,payload_json,base_server_revision,created_at_utc,state,conflict_server_revision FROM local_outbox ORDER BY sequence";
function protectedRewrite(db,sql,params){const before=db.prepare(select).all();assert.throws(()=>db.prepare(sql).run(...params),/already used mutation id/);assert.deepEqual(db.prepare(select).all(),before);}
test('OR REPLACE cannot overwrite active mutation ID with a changed payload',()=>{const db=open();try{protectedRewrite(db,replaceSql,[A,M,E,FORGED,TIME]);}finally{db.close();}});
test('OR REPLACE cannot overwrite active mutation ID even with same payload',()=>{const db=open();try{protectedRewrite(db,replaceSql,[A,M,E,OLD,TIME]);}finally{db.close();}});
test('OR REPLACE cannot overwrite a queued FIFO sequence under new mutation ID',()=>{const db=open();try{const seq=db.prepare(select).get().sequence;protectedRewrite(db,replaceSeqSql,[seq,A,'synthetic-new',E,FORGED,TIME]);}finally{db.close();}});
test('UPSERT cannot bypass immutable queued request using duplicate ID',()=>{const db=open();try{const sql="INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,payload_json,created_at_utc) VALUES (?,?,'subject',?,'upsert',?,?) ON CONFLICT(profile_id,mutation_id) DO UPDATE SET payload_json=excluded.payload_json";protectedRewrite(db,sql,[A,M,E,FORGED,TIME]);}finally{db.close();}});
test('new mutation ID on same entity is legitimately appended at new FIFO sequence',()=>{const db=open();try{const first=db.prepare(select).get().sequence;enqueue(db,A,'synthetic-new',FORGED);const all=db.prepare(select).all();assert.equal(all.length,2);assert.ok(all[1].sequence>first);assert.equal(all[1].payload_json,FORGED);}finally{db.close();}});
test('mutation ID uniqueness stays per profile, not global',()=>{const db=open();try{enqueue(db,B,M,OLD);assert.equal(db.prepare(select).all().length,2);}finally{db.close();}});
test('old retired mutation ID remains rejected after keep-local history',()=>{const db=open();try{db.prepare('DELETE FROM local_outbox WHERE profile_id=? AND mutation_id=?').run(A,M);db.prepare("INSERT INTO local_conflict_decisions(profile_id,original_mutation_id,original_fingerprint,entity_type,entity_id,original_operation,original_payload_json,original_created_at_utc,replacement_mutation_id,remote_revision,choice,decided_at_utc) VALUES (?,?,?,'subject',?,'upsert',?,?,?,'rev-remote','keep_local',?)").run(A,M,'a'.repeat(64),E,OLD,TIME,'synthetic-new',TIME);assert.throws(()=>enqueue(db,A,M,FORGED),/already used mutation id/);}finally{db.close();}});
test('ordinary conflict-state UPDATE and DELETE plus distinct replacement remain legal',()=>{const db=open();try{db.prepare("UPDATE local_outbox SET state='conflict',conflict_server_revision='rev-remote' WHERE mutation_id=?").run(M);assert.equal(db.prepare(select).get().state,'conflict');db.prepare('DELETE FROM local_outbox WHERE mutation_id=?').run(M);enqueue(db,A,'synthetic-new',OLD);assert.equal(db.prepare(select).get().mutation_id,'synthetic-new');}finally{db.close();}});
test('foreign keys and schema version remain valid after failed replacements',()=>{const db=open();try{protectedRewrite(db,replaceSql,[A,M,E,FORGED,TIME]);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('PRAGMA user_version').get().user_version,3);}finally{db.close();}});

test('explicitly recycling a deleted FIFO sequence is rejected',()=>{const db=open();try{
 const seq=db.prepare(select).get().sequence;
 db.prepare('DELETE FROM local_outbox WHERE mutation_id=?').run(M);
 assert.throws(()=>db.prepare(replaceSeqSql).run(seq,A,'synthetic-recycled',E,OLD,TIME),/queued FIFO sequence must advance/);
 assert.equal(db.prepare(select).all().length,0);
}finally{db.close();}});
test('explicit nonpositive FIFO sequence is rejected',()=>{const db=open();try{
 for(const seq of [-1,0])assert.throws(()=>db.prepare(replaceSeqSql).run(seq,A,'synthetic-negative',E,OLD,TIME),/queued FIFO sequence must advance/);
}finally{db.close();}});
test('automatic FIFO sequence advances past deleted highest row',()=>{const db=open();try{
 const seq=db.prepare(select).get().sequence;
 db.prepare('DELETE FROM local_outbox WHERE mutation_id=?').run(M);
 enqueue(db,A,'synthetic-fresh',OLD);
 assert.ok(db.prepare(select).get().sequence>seq);
}finally{db.close();}});
test('explicit future FIFO sequence is accepted when greater than previous high-water',()=>{const db=open();try{
 const seq=db.prepare(select).get().sequence;
 db.prepare(replaceSeqSql).run(seq+10,A,'synthetic-new',E,OLD,TIME);
 assert.equal(db.prepare('SELECT MAX(sequence) AS n FROM local_outbox').get().n,seq+10);
}finally{db.close();}});
