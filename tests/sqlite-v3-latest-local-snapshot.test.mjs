import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const P = 'synthetic-profile-a', E = 'synthetic-entity-a';
const initial = '{"label":"Original fictional"}';
const next = '{"label":"New fictional"}';
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE local_profiles(profile_id TEXT PRIMARY KEY);
    CREATE TABLE local_entities(
      profile_id TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL, payload_json TEXT,
      locally_deleted INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(profile_id,entity_type,entity_id),
      FOREIGN KEY(profile_id) REFERENCES local_profiles(profile_id)
    );
    CREATE TABLE local_outbox(
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL, mutation_id TEXT NOT NULL,
      entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      operation TEXT NOT NULL, payload_json TEXT,
      UNIQUE(profile_id,mutation_id),
      FOREIGN KEY(profile_id,entity_type,entity_id)
       REFERENCES local_entities(profile_id,entity_type,entity_id)
    );`);
  db.prepare('INSERT INTO local_profiles VALUES (?)').run(P);
  db.prepare('INSERT INTO local_entities VALUES (?,?,?,?,0)').run(P,'subject',E,initial);
  db.prepare('INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,payload_json) VALUES (?,?,?,?,?,?)')
    .run(P,'synthetic-m1','subject',E,'upsert',initial);
  return db;
}
function stage(db,id,operation,payload,entity=E,profile=P) {
  db.prepare('INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,payload_json) VALUES (?,?,?,?,?,?)')
    .run(profile,id,'subject',entity,operation,payload);
  db.prepare('UPDATE local_entities SET payload_json=?,locally_deleted=? WHERE profile_id=? AND entity_type=? AND entity_id=?')
    .run(payload,Number(operation==='delete'),profile,'subject',entity);
}
function audit(db) {
  // Mirrors the native v3 audit addition without claiming native encryption.
  const rows = db.prepare('SELECT * FROM local_outbox ORDER BY sequence').all();
  for(const row of rows) {
    const newest = db.prepare('SELECT mutation_id FROM local_outbox WHERE profile_id=? AND entity_type=? AND entity_id=? ORDER BY sequence DESC LIMIT 1')
      .get(row.profile_id,row.entity_type,row.entity_id).mutation_id;
    if(newest===row.mutation_id){
      const local = db.prepare('SELECT payload_json,locally_deleted FROM local_entities WHERE profile_id=? AND entity_type=? AND entity_id=?')
        .get(row.profile_id,row.entity_type,row.entity_id);
      if(local.payload_json!==row.payload_json || local.locally_deleted!==Number(row.operation==='delete')){
        throw Error('latest outbox/local snapshot differs');
      }
    }
  }
  return rows.length;
}
test('one valid pending edit matches materialized subject',()=>{const db=fixture();try{assert.equal(audit(db),1);}finally{db.close();}});
test('unrecorded local payload edit is rejected',()=>{const db=fixture();try{db.prepare('UPDATE local_entities SET payload_json=?').run(next);assert.throws(()=>audit(db),/snapshot differs/);}finally{db.close();}});
test('unrecorded deletion/tombstone flip is rejected',()=>{const db=fixture();try{db.prepare('UPDATE local_entities SET locally_deleted=1').run();assert.throws(()=>audit(db),/snapshot differs/);}finally{db.close();}});
test('old FIFO payload may differ if latest queued edit matches local',()=>{const db=fixture();try{stage(db,'synthetic-m2','upsert',next);assert.equal(audit(db),2);}finally{db.close();}});
test('outdated materialized subject is rejected after newer pending edit',()=>{const db=fixture();try{stage(db,'synthetic-m2','upsert',next);db.prepare('UPDATE local_entities SET payload_json=?').run(initial);assert.throws(()=>audit(db),/snapshot differs/);}finally{db.close();}});
test('queued deletion with null payload matches a local tombstone',()=>{const db=fixture();try{stage(db,'synthetic-m2','delete',null);assert.equal(audit(db),2);}finally{db.close();}});
test('checks are scoped independently for each profile and entity',()=>{const db=fixture();try{
  db.prepare('INSERT INTO local_profiles VALUES (?)').run('synthetic-profile-b');
  db.prepare('INSERT INTO local_entities VALUES (?,?,?,?,0)').run('synthetic-profile-b','subject',E,next);
  db.prepare('INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,payload_json) VALUES (?,?,?,?,?,?)')
    .run('synthetic-profile-b','synthetic-m1','subject',E,'upsert',next);
  assert.equal(audit(db),2);
  db.prepare('UPDATE local_entities SET payload_json=? WHERE profile_id=?').run(initial,'synthetic-profile-b');
  assert.throws(()=>audit(db),/snapshot differs/);
}finally{db.close();}});
