// Synthetic-only immutable decision history guard; full versioned SQLite DDL.
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {DatabaseSync} from 'node:sqlite';
const A='synthetic-a',E='synthetic-e1',T='2026-11-11T21:30:00Z';
function open(){const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');for(const f of ['0001_local_outbox.sql','0002_ack_ledger.sql','0003_conflict_decisions.sql'])db.exec(readFileSync(new URL('../contracts/sqlite/'+f,import.meta.url),'utf8'));for(const p of [A,'synthetic-b']){db.prepare('INSERT INTO local_profiles(profile_id) VALUES (?)').run(p);db.prepare("INSERT INTO local_entities(profile_id,entity_type,entity_id,payload_json) VALUES (?,'subject',?,'{}')").run(p,E);}return db;}
function insert(db,{profile=A,original='synthetic-old',replacement='synthetic-next',fingerprint='a'.repeat(64),revision='rev-one',upsert=false}={}){
 const sql=`INSERT ${upsert?'OR REPLACE':''} INTO local_conflict_decisions(profile_id,original_mutation_id,original_fingerprint,entity_type,entity_id,original_operation,original_payload_json,original_created_at_utc,replacement_mutation_id,remote_revision,choice,decided_at_utc) VALUES (?,?,?,'subject',?,'upsert','{}',?,?,?,'keep_local',?)`;
 return db.prepare(sql).run(profile,original,fingerprint,E,T,replacement,revision,T);
}
function snapshot(db){return db.prepare('SELECT profile_id,original_mutation_id,replacement_mutation_id,original_fingerprint,remote_revision FROM local_conflict_decisions ORDER BY profile_id,original_mutation_id').all();}
function denied(db,args){const before=snapshot(db);assert.throws(()=>insert(db,{...args,upsert:true}),/conflict decision history is immutable/);assert.deepEqual(snapshot(db),before);}
test('OR REPLACE cannot change archived fingerprint under existing original ID',()=>{const db=open();try{insert(db);denied(db,{fingerprint:'b'.repeat(64)});}finally{db.close();}});
test('OR REPLACE cannot change remote revision under existing original ID',()=>{const db=open();try{insert(db);denied(db,{revision:'rev-forged'});}finally{db.close();}});
test('OR REPLACE cannot hijack a unique replacement ID from a different original',()=>{const db=open();try{insert(db);denied(db,{original:'synthetic-other',replacement:'synthetic-next'});}finally{db.close();}});
test('OR REPLACE with identical archived contents still refuses destructive replacement',()=>{const db=open();try{insert(db);denied(db,{});}finally{db.close();}});
test('independent decisions with different IDs can be added',()=>{const db=open();try{insert(db);insert(db,{original:'synthetic-other',replacement:'synthetic-different'});assert.equal(snapshot(db).length,2);}finally{db.close();}});
test('same fictional IDs under a different profile remain independent',()=>{const db=open();try{insert(db);insert(db,{profile:'synthetic-b'});assert.equal(snapshot(db).length,2);}finally{db.close();}});
test('existing direct UPDATE and DELETE guards still protect history',()=>{const db=open();try{insert(db);assert.throws(()=>db.prepare("UPDATE local_conflict_decisions SET remote_revision='rev-forged'").run(),/conflict decision history is immutable/);assert.throws(()=>db.prepare('DELETE FROM local_conflict_decisions').run(),/conflict decision history is immutable/);}finally{db.close();}});
test('foreign key and version checks remain valid after failed REPLACE',()=>{const db=open();try{insert(db);denied(db,{revision:'rev-forged'});assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('PRAGMA user_version').get().user_version,3);}finally{db.close();}});
