// Full v1/v2/v3 DDL, fictional SQLite only. NOT native SQLCipher.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const PROFILE = 'synthetic-profile', ENTITY = 'synthetic-subject';
const TIME = '2026-11-11T21:30:00Z';
const DATA = '{"label":"Fictional"}';
function open(operation='upsert') {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const name of ['0001_local_outbox.sql','0002_ack_ledger.sql','0003_conflict_decisions.sql']) {
    db.exec(readFileSync(new URL('../contracts/sqlite/'+name, import.meta.url), 'utf8'));
  }
  db.prepare('INSERT INTO local_profiles(profile_id) VALUES (?)').run(PROFILE);
  const payload = operation === 'delete' ? null : DATA;
  db.prepare("INSERT INTO local_entities(profile_id,entity_type,entity_id,payload_json,locally_deleted,local_revision) VALUES (?, 'subject', ?, ?, ?, 1)")
    .run(PROFILE, ENTITY, payload, Number(operation === 'delete'));
  db.prepare("INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,payload_json,base_server_revision,created_at_utc) VALUES (?, 'synthetic-m1', 'subject', ?, ?, ?, NULL, ?)")
    .run(PROFILE, ENTITY, operation, payload, TIME);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  return db;
}
function snapshot(db) { return db.prepare('SELECT sequence,profile_id,mutation_id,entity_type,entity_id,operation,payload_json,base_server_revision,created_at_utc,state,conflict_server_revision FROM local_outbox').get(); }
function denied(db, sql, args=[]) {
  const before=snapshot(db);
  assert.throws(()=>db.prepare(sql).run(...args), /queued mutation (request|identity) is immutable/);
  assert.deepEqual(snapshot(db), before);
}
test('upsert payload cannot be modified after enqueue, even if valid JSON',()=>{
 const db=open();try{denied(db,'UPDATE local_outbox SET payload_json=?', ['{"label":"Forged"}']);}finally{db.close();}
});
test('payload JSON formatting cannot be silently rewritten after enqueue',()=>{
 const db=open();try{denied(db,'UPDATE local_outbox SET payload_json=?', ['{ "label":"Fictional" }']);}finally{db.close();}
});
test('request operation cannot be changed from upsert to delete',()=>{
 const db=open();try{denied(db,"UPDATE local_outbox SET operation='delete', payload_json=NULL");}finally{db.close();}
});
test('NULL base revision cannot be silently changed to a remote revision',()=>{
 const db=open();try{denied(db,"UPDATE local_outbox SET base_server_revision='rev-forged'");}finally{db.close();}
});
test('non-NULL base revision cannot silently become NULL',()=>{
 const db=open();try{db.prepare('DELETE FROM local_outbox').run();db.prepare("INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,payload_json,base_server_revision,created_at_utc) VALUES (?, 'synthetic-m2', 'subject', ?, 'upsert', ?, 'rev-original', ?)").run(PROFILE, ENTITY, DATA, TIME);denied(db,'UPDATE local_outbox SET base_server_revision=NULL');}finally{db.close();}
});
test('creation timestamp cannot be changed without a new mutation',()=>{
 const db=open();try{denied(db,"UPDATE local_outbox SET created_at_utc='2026-11-11T21:31:00Z'");}finally{db.close();}
});
test('FIFO sequence cannot be reindexed to change keyset ordering',()=>{
 const db=open();try{denied(db,'UPDATE local_outbox SET sequence=sequence+100');}finally{db.close();}
});
test('SQLite rowid alias cannot move a persisted FIFO sequence',()=>{
 const db=open();try{denied(db,'UPDATE local_outbox SET rowid=rowid+100');}finally{db.close();}
});
test('SQLite _rowid_ alias cannot bypass the FIFO identity trigger',()=>{
 const db=open();try{denied(db,'UPDATE local_outbox SET _rowid_=_rowid_+100');}finally{db.close();}
});
test('SQLite oid alias cannot bypass the FIFO identity trigger',()=>{
 const db=open();try{denied(db,'UPDATE local_outbox SET oid=oid+100');}finally{db.close();}
});
test('delete tombstone payload cannot become a fabricated upsert',()=>{
 const db=open('delete');try{denied(db,"UPDATE local_outbox SET operation='upsert',payload_json='{}'");}finally{db.close();}
});
test('NULL-safe request guard protects a delete payload against direct modification',()=>{
 const db=open('delete');try{denied(db,"UPDATE local_outbox SET payload_json='{}'");}finally{db.close();}
});
test('identical request-field updates are allowed as no-op',()=>{
 const db=open();try{db.prepare('UPDATE local_outbox SET operation=operation,payload_json=payload_json,base_server_revision=base_server_revision,created_at_utc=created_at_utc').run();assert.equal(snapshot(db).payload_json,DATA);}finally{db.close();}
});
test('legitimate conflict state and remote conflict revision changes still work',()=>{
 const db=open();try{db.prepare("UPDATE local_outbox SET state='conflict',conflict_server_revision='rev-remote'").run();assert.equal(snapshot(db).state,'conflict');db.prepare("UPDATE local_outbox SET state='pending',conflict_server_revision=NULL").run();assert.equal(snapshot(db).state,'pending');}finally{db.close();}
});
test('v3 keep-local DELETE and fresh INSERT remain legal',()=>{
 const db=open();try{
 db.prepare("UPDATE local_outbox SET state='conflict',conflict_server_revision='rev-remote'").run();
 db.prepare('DELETE FROM local_outbox WHERE mutation_id=?').run('synthetic-m1');
 db.prepare("INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,payload_json,base_server_revision,created_at_utc) VALUES (?, 'synthetic-replacement', 'subject', ?, 'upsert', ?, 'rev-remote', ?)").run(PROFILE,ENTITY,DATA,TIME);
 assert.equal(snapshot(db).mutation_id,'synthetic-replacement');
 }finally{db.close();}
});
test('identity immutability remains enforced alongside request guard',()=>{
 const db=open();try{denied(db,"UPDATE local_outbox SET mutation_id='synthetic-new'");}finally{db.close();}
});
test('new trigger is present and foreign keys remain valid',()=>{
 const db=open();try{assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name='local_outbox_v3_request_snapshot_immutable'").get().n,1);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);}finally{db.close();}
});
