// Fictional SQLite v3 ACK receipt immutability. NOT native SQLCipher or server authentication.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
const A='synthetic-a', B='synthetic-b', MUT='synthetic-acked', ENTITY='synthetic-e1';
const TIME='2026-11-11T21:30:00Z';
function open(){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 for(const name of ['0001_local_outbox.sql','0002_ack_ledger.sql','0003_conflict_decisions.sql'])
  db.exec(readFileSync(new URL('../contracts/sqlite/'+name,import.meta.url),'utf8'));
 for(const profile of [A,B])db.prepare('INSERT INTO local_profiles(profile_id) VALUES (?)').run(profile);
 return db;
}
function ack(db, {profile=A,mutation=MUT,hash='a'.repeat(64),revision='rev-original',result='accepted',mode='INSERT'}={}) {
 return db.prepare(`${mode} INTO local_ack_ledger(profile_id,mutation_id,entity_type,entity_id,request_fingerprint,result,server_revision,acknowledged_at_utc) VALUES (?,?,'subject',?,?,?,?,?)`)
 .run(profile,mutation,ENTITY,hash,result,revision,TIME);
}
const read=db=>db.prepare('SELECT * FROM local_ack_ledger ORDER BY profile_id,mutation_id').all();
function denies(db,fn){const before=read(db);assert.throws(fn,/acknowledgement ledger is immutable/);assert.deepEqual(read(db),before);}
test('v3 rejects modification of accepted ACK fingerprint',()=>{const db=open();try{ack(db);denies(db,()=>db.prepare("UPDATE local_ack_ledger SET request_fingerprint=?").run('b'.repeat(64)));}finally{db.close();}});
test('v3 rejects modification of server revision',()=>{const db=open();try{ack(db);denies(db,()=>db.prepare("UPDATE local_ack_ledger SET server_revision='rev-forged'").run());}finally{db.close();}});
test('v3 refuses ACK deletion even if it is the last row',()=>{const db=open();try{ack(db);denies(db,()=>db.prepare('DELETE FROM local_ack_ledger').run());}finally{db.close();}});
test('v3 refuses ACK reassignment to another profile/ID',()=>{const db=open();try{ack(db);denies(db,()=>db.prepare('UPDATE local_ack_ledger SET profile_id=?,mutation_id=?').run(B,'synthetic-new'));}finally{db.close();}});
test('v3 blocks OR REPLACE overwrite with forged hash and server revision',()=>{const db=open();try{ack(db);denies(db,()=>ack(db,{hash:'b'.repeat(64),revision:'rev-forged',mode:'INSERT OR REPLACE'}));}finally{db.close();}});
test('v3 blocks identical OR REPLACE replay; replay should be a no-op',()=>{const db=open();try{ack(db);denies(db,()=>ack(db,{mode:'INSERT OR REPLACE'}));}finally{db.close();}});
test('v3 blocks INSERT ON CONFLICT DO UPDATE, even a matching row',()=>{const db=open();try{ack(db);denies(db,()=>db.prepare("INSERT INTO local_ack_ledger(profile_id,mutation_id,entity_type,entity_id,request_fingerprint,result,server_revision,acknowledged_at_utc) VALUES (?,?,'subject',?,?,?,?,?) ON CONFLICT(profile_id,mutation_id) DO UPDATE SET server_revision=excluded.server_revision").run(A,MUT,ENTITY,'b'.repeat(64),'accepted','rev-forged',TIME));}finally{db.close();}});
test('v3 permits a new ACK ID in the same profile',()=>{const db=open();try{ack(db);ack(db,{mutation:'synthetic-acked2'});assert.equal(read(db).length,2);}finally{db.close();}});
test('v3 keeps ACK namespaces independent by profile',()=>{const db=open();try{ack(db);ack(db,{profile:B});assert.equal(read(db).length,2);}finally{db.close();}});
test('v3 blocks reuse of ACKed ID in outbox without touching the existing receipt',()=>{const db=open();try{ack(db);db.prepare("INSERT INTO local_entities(profile_id,entity_type,entity_id,payload_json) VALUES (?,'subject',?,'{}')").run(A,ENTITY);const before=read(db);assert.throws(()=>db.prepare("INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,payload_json,created_at_utc) VALUES (?,?,'subject',?,'upsert','{}',?)").run(A,MUT,ENTITY,TIME),/already used mutation id/);assert.deepEqual(read(db),before);}finally{db.close();}});
test('v3 ACK guards do not affect v2-only schema',()=>{const db=new DatabaseSync(':memory:');try{db.exec('PRAGMA foreign_keys=ON');for(const name of ['0001_local_outbox.sql','0002_ack_ledger.sql'])db.exec(readFileSync(new URL('../contracts/sqlite/'+name,import.meta.url),'utf8'));db.prepare('INSERT INTO local_profiles VALUES (?)').run(A);ack(db);db.prepare('DELETE FROM local_ack_ledger').run();assert.equal(read(db).length,0);}finally{db.close();}});
test('v3 schema and foreign keys remain intact after blocked rewrites',()=>{const db=open();try{ack(db);denies(db,()=>db.prepare('DELETE FROM local_ack_ledger').run());assert.equal(db.prepare('PRAGMA user_version').get().user_version,3);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);}finally{db.close();}});
